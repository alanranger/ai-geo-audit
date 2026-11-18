/** Turn stored LLM snapshots and the ranking scan into the AI visibility tiles. */
import { LLM_CLUSTER_TAXONOMY } from '../llm-visibility/cluster-taxonomy.js';

const GROUNDING_HOSTS = new Set([
  'google.com', 'google.co.uk', 'vertexaisearch.cloud.google.com', 'bing.com',
  'gstatic.com', 'googleusercontent.com'
]);

function bareHost(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '');
}

export function keepRival(domain) {
  const host = bareHost(domain);
  if (!host || host === 'alanranger.com' || host.endsWith('.alanranger.com')) return false;
  if (host === 'alan-ranger.squarespace.com' || (host.endsWith('.squarespace.com') && host.includes('alan'))) return false;
  if (GROUNDING_HOSTS.has(host) || [...GROUNDING_HOSTS].some((g) => host.endsWith('.' + g))) return false;
  return true;
}

export function cleanRivalDomains(result) {
  const blob = typeof result === 'string' ? result : JSON.stringify(result || {});
  const set = new Set();
  const re = /https?:\/\/[^\s"'<>\\]+/gi;
  let m;
  while ((m = re.exec(blob)) !== null) {
    const host = resolvedHost(m[0].replace(/\\u0026/g, '&'));
    if (host && keepRival(host)) set.add(host);
  }
  return [...set].slice(0, 10);
}

function resolvedHost(raw) {
  let url;
  try { url = new URL(raw); } catch { return ''; }
  const host = bareHost(url.hostname);
  if (!GROUNDING_HOSTS.has(host) && ![...GROUNDING_HOSTS].some((g) => host.endsWith('.' + g))) return host;
  const target = url.searchParams.get('url') || url.searchParams.get('q') || '';
  if (/^https?:/i.test(target)) return resolvedHost(target);
  return '';
}
function tally(rows) {
  let aioShown = 0;
  let aioCited = 0;
  let modeOf = 0;
  let modeCited = 0;
  for (const row of rows || []) {
    const aio = row?.ai_engines?.google_aio;
    const mode = row?.ai_engines?.google_ai_mode;
    if (aio?.present) {
      aioShown += 1;
      if (Number(aio.alan_citations_count) > 0) aioCited += 1;
    }
    if (mode) {
      modeOf += 1;
      if (Number(mode.alan_citations_count) > 0) modeCited += 1;
    }
  }
  return { aioShown, aioCited, modeOf, modeCited };
}

function chatFrom(snap) {
  const stored = snap?.meta?.engines?.chat_gpt;
  if (stored) return stored;
  const prompts = snap?.prompt_results || [];
  if (!prompts.length) return null;
  return {
    ok: true,
    named: prompts.filter((p) => p.named).length,
    of: prompts.length,
    cited: prompts.filter((p) => p.cited).length,
    prompts
  };
}

export function gapLines(engines) {
  const keys = Object.keys(engines || {});
  const prompts = engines?.chat_gpt?.prompts || [];
  const lines = [];
  for (const p of prompts) {
    const namedBy = keys.filter((k) => (engines[k].prompts || []).some((x) => x.prompt === p.prompt && x.named));
    if (namedBy.length === keys.length) continue;
    lines.push(`${p.prompt} — named by ${namedBy.join(', ') || 'nobody'}`);
  }
  return lines;
}

export function rivalLines(engines) {
  const counts = new Map();
  for (const engine of Object.values(engines || {})) {
    for (const p of engine.prompts || []) {
      for (const domain of p.rivals || []) if (keepRival(domain)) counts.set(domain, (counts.get(domain) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([domain, n]) => `${domain} (${n})`);
}

export const ENGINE_KEYS = ['chat_gpt', 'gemini', 'perplexity', 'claude'];

export function pairClass(flags) {
  const hits = (flags || []).filter(Boolean).length;
  if (hits >= 2) return 'named';
  if (hits === 1) return 'sometimes';
  return 'not named';
}

export function groupTotals(prompts) {
  const totals = { local: { named: 0, of: 0 }, regional: { named: 0, of: 0 }, national: { named: 0, of: 0 } };
  for (const p of prompts || []) {
    const bucket = totals[String(p.group || '').toLowerCase()];
    if (!bucket) continue;
    bucket.of += 1;
    if (p.named) bucket.named += 1;
  }
  return totals;
}

export function groupLine(totals) {
  if (!totals) return '';
  const of = totals.local.of + totals.regional.of + totals.national.of;
  if (!of) return '';
  const bit = (label, key) => `${label} ${totals[key].named}/${totals[key].of}`;
  return `${bit('Local', 'local')} · ${bit('Regional', 'regional')} · ${bit('National', 'national')}`;
}

function bankBreak(latest, prev) {
  const next = latest?.meta?.prompt_bank_version;
  const old = prev?.meta?.prompt_bank_version;
  if (next == null || old == null || String(next) === String(old)) return '';
  const d = new Date(latest.run_at || '');
  if (Number.isNaN(d.getTime())) return 'new question set';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `new question set, from ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

export function engineLine(engine) {
  if (!engine || engine.ok === false || engine.named == null) {
    return { text: 'no data this week', ok: false, trend: '', sometimes: '', groups: '' };
  }
  return {
    text: `named in ${engine.named} of ${engine.of}`,
    ok: true,
    trend: engine.trend || '',
    sometimes: engine.sometimes ? `+${engine.sometimes} sometimes` : '',
    groups: engine.groups || ''
  };
}

export function engineRows(picture) {
  const engines = picture?.engines || {};
  const prompts = engines.chat_gpt?.prompts || [];
  return prompts.map((p) => {
    const cells = {};
    const rivals = new Set((p.rivals || []).filter(keepRival));
    for (const key of ENGINE_KEYS) {
      const hit = (engines[key]?.prompts || []).find((x) => x.prompt === p.prompt);
      cells[key] = hit ? { named: !!hit.named, sometimes: !!hit.sometimes, cited: !!hit.cited } : null;
      for (const domain of hit?.rivals || []) if (keepRival(domain)) rivals.add(domain);
    }
    return { prompt: p.prompt, group: p.group || '', service: p.service || '', cells, rivals: [...rivals].slice(0, 6) };
  });
}

const CLUSTER_LABELS = { chat_gpt: 'ChatGPT', gemini: 'Gemini', perplexity: 'Perplexity', claude: 'Claude' };

export function clusterLines(engines, taxonomy = LLM_CLUSTER_TAXONOMY) {
  return (taxonomy || []).map((c) => {
    const parts = [];
    const rivals = new Set();
    let questions = 0;
    for (const key of ENGINE_KEYS) {
      const prompts = (engines?.[key]?.prompts || []).filter((p) => p.cluster_id === c.cluster_id);
      if (!prompts.length) continue;
      questions = prompts.length;
      const named = prompts.filter((p) => p.named).length;
      const sometimes = prompts.filter((p) => p.sometimes).length;
      parts.push(`${CLUSTER_LABELS[key] || key} ${named}/${prompts.length}` + (sometimes ? ` +${sometimes} sometimes` : ''));
      for (const p of prompts) for (const domain of p.rivals || []) if (keepRival(domain)) rivals.add(domain);
    }
    return {
      cluster_id: c.cluster_id,
      empty: questions === 0,
      summary: questions ? parts.join(' · ') : 'no question in set',
      rivals: [...rivals].slice(0, 6)
    };
  });
}

export function pictureFrom(snaps, rankRows, rankAt) {
  const latest = snaps?.[0] || null;
  const prev = snaps?.[1] || null;
  const engines = { ...(latest?.meta?.engines || {}) };
  const chat = chatFrom(latest);
  if (chat) engines.chat_gpt = { ...chat, at: latest?.run_at || null };
  const breakNote = bankBreak(latest, prev);
  for (const key of Object.keys(engines)) {
    if (!breakNote) {
      const stored = prev?.meta?.engines?.[key];
      const old = stored && stored.named != null ? stored : (key === 'chat_gpt' ? chatFrom(prev) : null);
      if (old && old.named != null) engines[key] = { ...engines[key], trend: `was ${old.named} of ${old.of}` };
    }
    const groups = groupLine(groupTotals(engines[key].prompts));
    if (groups) engines[key] = { ...engines[key], groups };
    if (!engines[key].at) engines[key] = { ...engines[key], at: latest?.run_at || null };
  }
  const t = tally(rankRows);
  return {
    engines,
    google_aio: { ok: t.aioShown > 0, named: t.aioCited, of: t.aioShown, at: rankAt || null },
    google_ai_mode: { ok: t.modeOf > 0, named: t.modeCited, of: t.modeOf, at: rankAt || null },
    gaps: gapLines(engines),
    rivals: rivalLines(engines),
    breakNote,
    clusterRows: clusterLines(engines)
  };
}
