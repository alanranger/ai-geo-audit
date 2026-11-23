/** One short step of the weekly AI-answer run. The snapshot is written only when the plan is finished. */
import { createClient } from '@supabase/supabase-js';
import { cleanRivalDomains } from '../acquisition/ai-picture.js';
import { loadFlaggedPromptBank } from './collect-core.js';
import {
  WEEKLY_CAP_USD, buildCallPlan, emptyState, enginesFromState, progressOf,
  runBudget, snapshotIsComplete, stampUtc, weekStartUtc
} from './run-plan.js';

const PROPERTY = 'https://www.alanranger.com';

async function post(auth, path, body) {
  const res = await fetch(`https://api.dataforseo.com/v3/${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  const task = json?.tasks?.[0];
  return {
    ok: task?.status_code === 20000 || json?.status_code === 20000,
    cost: Number(task?.cost ?? json?.cost ?? 0) || 0,
    msg: task?.status_message || json?.status_message,
    result: task?.result ?? null
  };
}

function authHeader() {
  const login = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error('Missing DFS creds');
  return Buffer.from(`${login}:${password}`).toString('base64');
}

async function askLive(auth, item) {
  const body = { user_prompt: item.prompt, model_name: item.model, max_output_tokens: 1024, web_search: true };
  if (item.country) body.web_search_country_iso_code = 'GB';
  const r = await post(auth, `ai_optimization/${item.engine}/llm_responses/live`, [body]);
  const text = JSON.stringify(r.result || {});
  const named = r.ok && /alanranger\.com|alan\s*ranger/i.test(text);
  return {
    prompt: item.prompt, named, cited: named && /alanranger\.com/i.test(text),
    rivals: cleanRivalDomains(r.result), ok: r.ok, cost: r.cost, msg: r.msg
  };
}

async function setupLive(auth, seeds) {
  const mentions = await post(auth, 'ai_optimization/llm_mentions/search_mentions/live', [{
    language_code: 'en', location_code: 2826, platform: 'google',
    target: [{ domain: 'alanranger.com', search_filter: 'include', include_subdomains: true }], limit: 50
  }]);
  const topics = [];
  for (const seed of seeds || []) {
    const r = await post(auth, 'ai_optimization/llm_mentions/top_mentioned_domains/live', [{
      language_code: 'en', location_code: 2826, platform: 'google',
      target: [{ keyword: seed, search_filter: 'include' }], limit: 10
    }]);
    topics.push({ seed, ok: r.ok, cost: r.cost, items: r.result?.[0]?.items || r.result || null });
  }
  const items = mentions.result?.[0]?.items || [];
  return {
    cost: (mentions.cost || 0) + topics.reduce((s, t) => s + (t.cost || 0), 0),
    mentions: mentions.result?.[0]?.items_count ?? items.length,
    topics
  };
}

function reused(row) {
  return {
    ok: true, done: true, reused: true,
    message: `AI answers already collected this week (${stampUtc(row.run_at)})`,
    cost_usd: row.cost_usd, run_at: row.run_at, id: row.id,
    named: row.meta?.named_of_prompts || null
  };
}

function stateFrom(row) {
  const s = row?.state || {};
  return { cursor: s.cursor || 0, spend: Number(s.spend) || 0, calls: s.calls || {}, setup: s.setup || null, done: !!s.done };
}

async function finish(sb, run, bank, state) {
  const week = run.week_start || weekStartUtc(new Date().toISOString());
  const prior = await sb.from('llm_visibility_snapshots')
    .select('id, run_at, cost_usd, meta')
    .gte('run_at', week)
    .order('run_at', { ascending: false })
    .limit(4);
  const already = (prior.data || []).find((row) => snapshotIsComplete(row, bank.version));
  if (already) {
    await sb.from('llm_visibility_runs').update({
      status: 'complete', snapshot_id: already.id, spend_usd: state.spend, updated_at: new Date().toISOString()
    }).eq('id', run.id);
    return { ok: true, done: true, reused: true, id: already.id, run_at: already.run_at, cost_usd: already.cost_usd, named: already.meta?.named_of_prompts || null };
  }
  const engines = enginesFromState(bank.prompts, state.calls);
  const chat = engines.chat_gpt?.prompts || [];
  const named = chat.filter((p) => p.named).length;
  const snapshot = {
    property_url: PROPERTY,
    cadence: 'weekly',
    domain_mentions: { items_count: state.setup?.mentions ?? null },
    prompt_results: chat,
    topic_competitors: state.setup?.topics || [],
    cost_usd: state.spend,
    meta: {
      domain: 'alanranger.com',
      prompt_bank_version: bank.version,
      prompt_source: bank.source,
      named_of_prompts: `${named}/${chat.length}`,
      engines,
      extra_cost_usd: state.spend
    }
  };
  const { data, error } = await sb.from('llm_visibility_snapshots').insert(snapshot).select('id, run_at').single();
  if (error) throw new Error(error.message);
  await sb.from('llm_visibility_runs').update({
    status: 'complete', snapshot_id: data.id, cursor: state.cursor, spend_usd: state.spend, state, updated_at: new Date().toISOString()
  }).eq('id', run.id);
  return { ok: true, done: true, reused: false, id: data.id, run_at: data.run_at, cost_usd: state.spend, named: snapshot.meta.named_of_prompts };
}

export async function tickLlmVisibility(opts = {}) {
  const sb = opts.supabase || createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const bank = await loadFlaggedPromptBank();
  const now = opts.now || new Date();
  const week = weekStartUtc(now.toISOString());
  const { data: snaps, error } = await sb.from('llm_visibility_snapshots')
    .select('id, run_at, cost_usd, meta')
    .gte('run_at', week)
    .order('run_at', { ascending: false })
    .limit(8);
  if (error) throw new Error(error.message);
  const complete = (snaps || []).find((row) => snapshotIsComplete(row, bank.version));
  if (complete && !opts.force) return reused(complete);

  let run = (await sb.from('llm_visibility_runs').select('*').eq('week_start', week).eq('bank_version', bank.version).eq('status', 'running').order('id', { ascending: false }).limit(1)).data?.[0];
  if (!run || opts.fresh) {
    const inserted = await sb.from('llm_visibility_runs').insert({
      week_start: week, bank_version: bank.version, status: 'running', cursor: 0, spend_usd: 0, state: emptyState()
    }).select('*').single();
    if (inserted.error) throw new Error(inserted.error.message);
    run = inserted.data;
  }
  const plan = buildCallPlan(bank.prompts);
  const auth = opts.auth || authHeader();
  const save = async (state) => {
    await sb.from('llm_visibility_runs').update({
      cursor: state.cursor, spend_usd: state.spend, state, updated_at: new Date().toISOString()
    }).eq('id', run.id);
  };
  const state = await runBudget(stateFrom(run), plan, {
    budgetMs: opts.budgetMs ?? 240000,
    maxCalls: opts.maxCalls,
    cap: WEEKLY_CAP_USD,
    save,
    setup: () => (opts.setup ? opts.setup() : setupLive(auth, bank.topic_seeds)),
    ask: (item) => (opts.ask ? opts.ask(item) : askLive(auth, item))
  });
  if (!state.done) return { ok: true, done: false, reused: false, ...progressOf(state, plan) };
  return finish(sb, run, bank, state);
}
