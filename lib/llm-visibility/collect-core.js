/**
 * Shared LLM visibility collection (domain mentions + prompt bank + topic seeds).
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PROPERTY = 'https://www.alanranger.com';

function loadBank() {
  const raw = readFileSync(join(ROOT, 'config/llm-visibility-prompt-bank-LOCKED.json'), 'utf8');
  return JSON.parse(raw);
}

function citesAlan(text) {
  return /alanranger\.com|alan\s*ranger/i.test(String(text || ''));
}

function rivalDomains(result) {
  const blob = JSON.stringify(result || {});
  const set = new Set();
  const re = /https?:\/\/(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})/gi;
  let m;
  while ((m = re.exec(blob)) !== null) {
    const d = m[1].toLowerCase();
    if (/alanranger|dataforseo|openai|gstatic|googleusercontent/i.test(d)) continue;
    set.add(d);
  }
  return [...set].slice(0, 10);
}

async function post(auth, path, body) {
  const res = await fetch(`https://api.dataforseo.com/v3/${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const task = json?.tasks?.[0];
  return {
    ok: task?.status_code === 20000 || json?.status_code === 20000,
    cost: Number(task?.cost ?? json?.cost ?? 0) || 0,
    msg: task?.status_message || json?.status_message,
    result: task?.result ?? null,
  };
}

/**
 * @param {{ cadence?: string, persist?: boolean }} opts
 */
export async function collectLlmVisibilitySnapshot(opts = {}) {
  const bank = loadBank();
  const login = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error('Missing DFS creds');
  const auth = Buffer.from(`${login}:${password}`).toString('base64');
  const DOMAIN = bank.domain || 'alanranger.com';
  let cost = 0;

  const mentions = await post(auth, 'ai_optimization/llm_mentions/search_mentions/live', [{
    language_code: 'en',
    location_code: 2826,
    platform: 'google',
    target: [{ domain: DOMAIN, search_filter: 'include', include_subdomains: true }],
    limit: 50,
  }]);
  cost += mentions.cost;

  const aggregated = await post(auth, 'ai_optimization/llm_mentions/aggregated_metrics/live', [{
    language_code: 'en',
    target: [{ domain: DOMAIN, search_filter: 'include', include_subdomains: true }],
    platform: 'google',
  }]);
  cost += aggregated.cost;

  const historical = await post(auth, 'ai_optimization/llm_mentions/historical/live', [{
    language_code: 'en',
    target: [{ domain: DOMAIN, search_filter: 'include', include_subdomains: true }],
    platform: 'google',
  }]);
  cost += historical.cost;

  const mentionItems = mentions.result?.[0]?.items || [];
  const mentionCount = mentions.result?.[0]?.items_count ?? mentionItems.length;
  let citationCount = 0;
  for (const it of mentionItems) {
    if (/alanranger\.com/i.test(JSON.stringify(it.sources || it.references || it))) citationCount += 1;
  }

  const promptResults = [];
  for (const row of bank.prompts || []) {
    const r = await post(auth, 'ai_optimization/chat_gpt/llm_responses/live', [{
      user_prompt: row.prompt,
      model_name: 'gpt-4o-mini',
      max_output_tokens: 1024,
      web_search: true,
      web_search_country_iso_code: 'GB',
    }]);
    cost += r.cost;
    const text = JSON.stringify(r.result || {});
    const named = citesAlan(text);
    promptResults.push({
      prompt: row.prompt,
      class: row.class,
      intent: row.intent,
      named,
      cited: named && /alanranger\.com/i.test(text),
      rivals: rivalDomains(r.result),
      ok: r.ok,
      cost: r.cost,
      msg: r.msg,
    });
  }

  const topicCompetitors = [];
  for (const seed of bank.topic_seeds || []) {
    const r = await post(auth, 'ai_optimization/llm_mentions/top_mentioned_domains/live', [{
      language_code: 'en',
      location_code: 2826,
      platform: 'google',
      target: [{ keyword: seed, search_filter: 'include' }],
      limit: 10,
    }]);
    cost += r.cost;
    topicCompetitors.push({
      seed,
      ok: r.ok,
      cost: r.cost,
      items: r.result?.[0]?.items || r.result || null,
    });
  }

  const namedCount = promptResults.filter((p) => p.named).length;
  const snapshot = {
    property_url: PROPERTY,
    cadence: opts.cadence || 'weekly',
    domain_mentions: {
      platform: 'google',
      location_code: 2826,
      items_count: mentionCount,
      citation_sample_count: citationCount,
      citation_to_mention_ratio: mentionCount > 0 ? Math.round((citationCount / mentionCount) * 1000) / 1000 : null,
      sample_items: mentionItems.slice(0, 5),
    },
    historical: historical.result || null,
    aggregated: aggregated.result || null,
    prompt_results: promptResults,
    topic_competitors: topicCompetitors,
    cost_usd: Math.round(cost * 1000) / 1000,
    meta: {
      domain: DOMAIN,
      prompt_bank_version: bank.version,
      named_of_prompts: `${namedCount}/${promptResults.length}`,
      endpoints: ['search_mentions', 'aggregated_metrics', 'historical', 'chat_gpt/llm_responses', 'top_mentioned_domains'],
    },
  };

  if (opts.persist === false) return { snapshot, bank };

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase');
  const sb = createClient(url, key);
  const { data, error } = await sb.from('llm_visibility_snapshots').insert(snapshot).select('id, run_at').single();
  if (error) throw new Error(error.message);
  return { id: data.id, run_at: data.run_at, snapshot, bank };
}
