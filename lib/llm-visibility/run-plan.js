/** Pure plan for the weekly AI-answer run. One call index, so ticks cannot skip or repeat. */
import { pairClass } from '../acquisition/ai-picture.js';

export const WEEKLY_CAP_USD = 6;
export const LLM_ENGINES = [
  { key: 'chat_gpt', model: 'gpt-4o-mini', country: true },
  { key: 'gemini', model: 'gemini-3.6-flash', country: false },
  { key: 'perplexity', model: 'sonar', country: true },
  { key: 'claude', model: 'claude-sonnet-4-6', country: true }
];

const LABELS = { chat_gpt: 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity', claude: 'Claude' };

export function callKey(item) {
  return `${item.engine}|${item.prompt}|${item.run}`;
}

export function buildCallPlan(prompts) {
  const plan = [{ kind: 'setup' }];
  for (const engine of LLM_ENGINES) {
    for (const row of prompts || []) {
      plan.push({ kind: 'ask', engine: engine.key, model: engine.model, country: engine.country, prompt: row.prompt, run: 0, row });
      plan.push({ kind: 'ask', engine: engine.key, model: engine.model, country: engine.country, prompt: row.prompt, run: 1, row });
    }
  }
  return plan;
}

export function emptyState() {
  return { cursor: 0, spend: 0, calls: {}, setup: null, done: false };
}

export function foldRuns(row, runs) {
  const namedClass = pairClass(runs.map((r) => r.named));
  const citedClass = pairClass(runs.map((r) => r.cited));
  return {
    prompt: row.prompt,
    keyword: row.keyword || row.prompt,
    group: row.group || null,
    service: row.service || null,
    cluster_id: row.cluster_id || null,
    class: row.class || null,
    named: namedClass === 'named',
    sometimes: namedClass === 'sometimes',
    cited: citedClass === 'named',
    rivals: [...new Set(runs.flatMap((r) => r.rivals || []))].slice(0, 10),
    runs: runs.map(({ cost: _c, msg: _m, ...rest }) => rest),
    ok: runs.length === 2 && runs.every((r) => r.ok)
  };
}

/** Record one plan step. A failed answer skips the rest of that engine. The cap ends the run. */
export function reduceCall(state, item, result, plan, cap = WEEKLY_CAP_USD) {
  const calls = { ...state.calls };
  if (item.kind === 'ask') calls[callKey(item)] = result;
  let cursor = state.cursor + 1;
  const spend = Math.round((state.spend + (Number(result?.cost) || 0)) * 1000) / 1000;
  if (item.kind === 'ask' && result && result.ok === false) {
    while (cursor < plan.length && plan[cursor].engine === item.engine) cursor += 1;
  }
  if (spend >= cap) cursor = plan.length;
  return {
    cursor,
    spend,
    calls,
    setup: item.kind === 'setup' ? result : state.setup,
    done: cursor >= plan.length
  };
}

export async function runBudget(state, plan, deps) {
  const start = Date.now();
  const limit = deps.maxCalls || 1000;
  let made = 0;
  let current = state;
  while (!current.done && current.cursor < plan.length && made < limit && Date.now() - start < deps.budgetMs) {
    const item = plan[current.cursor];
    const result = item.kind === 'setup' ? await deps.setup() : await deps.ask(item);
    current = reduceCall(current, item, result, plan, deps.cap || WEEKLY_CAP_USD);
    made += 1;
    if (deps.save) await deps.save(current);
  }
  return current;
}

export function enginesFromState(prompts, calls) {
  const out = {};
  for (const engine of LLM_ENGINES) {
    const rows = [];
    let failed = false;
    for (const row of prompts || []) {
      const a = calls[callKey({ engine: engine.key, prompt: row.prompt, run: 0 })];
      const b = calls[callKey({ engine: engine.key, prompt: row.prompt, run: 1 })];
      if (!a || !b || !a.ok || !b.ok) { failed = true; break; }
      rows.push(foldRuns(row, [a, b]));
    }
    const named = rows.filter((r) => r.named).length;
    out[engine.key] = failed || rows.length !== (prompts || []).length
      ? { ok: false, model: engine.model, msg: 'no data this week' }
      : { ok: true, model: engine.model, named, sometimes: rows.filter((r) => r.sometimes).length, of: rows.length, cited: rows.filter((r) => r.cited).length, prompts: rows };
  }
  return out;
}

export function progressOf(state, plan) {
  const total = plan.length || 1;
  const cursor = Math.min(state.cursor || 0, total);
  const item = plan[Math.min(cursor, total - 1)] || {};
  const left = Math.max(0, total - cursor);
  return {
    cursor,
    total,
    pct: Math.round((cursor / total) * 100),
    engine: item.engine || (item.kind === 'setup' ? 'setup' : ''),
    question: item.prompt || '',
    eta_sec: left * 6,
    spend_usd: state.spend || 0,
    alive: true,
    done: !!state.done
  };
}

export function weekStartUtc(iso) {
  const d = new Date(iso);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function stampUtc(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${hh}:${mm}`;
}

export function snapshotIsComplete(row, version) {
  const engines = row?.meta?.engines;
  if (!engines || Number(row?.meta?.prompt_bank_version) !== Number(version)) return false;
  return LLM_ENGINES.every((e) => engines[e.key]);
}

export function previousWeekSnapshot(snaps, latest) {
  const start = Date.parse(weekStartUtc(latest?.run_at));
  return (snaps || [])
    .filter((s) => s !== latest && Date.parse(s.run_at) < start)
    .sort((a, b) => Date.parse(b.run_at) - Date.parse(a.run_at))[0] || null;
}

export function briefAnswers(latest, previous) {
  const same = latest?.meta?.prompt_bank_version != null
    && Number(latest.meta.prompt_bank_version) === Number(previous?.meta?.prompt_bank_version);
  const engines = latest?.meta?.engines || {};
  const prev = previous?.meta?.engines || {};
  const parts = LLM_ENGINES.map((engine) => {
    const row = engines[engine.key];
    const label = LABELS[engine.key];
    if (!row || row.ok === false || row.named == null) return `${label}: no data this week`;
    const sometimes = row.sometimes ? ` +${row.sometimes} sometimes` : '';
    let arrow = '';
    if (same && prev[engine.key]?.named != null) {
      const d = row.named - prev[engine.key].named;
      arrow = d === 0 ? ' →0' : (d > 0 ? ` ▲${d}` : ` ▼${Math.abs(d)}`);
    }
    return `${label} named in ${row.named} of ${row.of}${sometimes}${arrow}`;
  });
  const note = same ? '' : 'new question set (from 18 Nov)';
  return { text: `${parts.join('. ')}.${note ? ' ' + note : ''}`, arrow: same, note };
}
