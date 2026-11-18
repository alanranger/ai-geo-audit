/** Turn stored LLM snapshots and the ranking scan into the AI visibility tiles. */
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
      for (const domain of p.rivals || []) counts.set(domain, (counts.get(domain) || 0) + 1);
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
    const rivals = new Set(p.rivals || []);
    for (const key of ENGINE_KEYS) {
      const hit = (engines[key]?.prompts || []).find((x) => x.prompt === p.prompt);
      cells[key] = hit ? { named: !!hit.named, sometimes: !!hit.sometimes, cited: !!hit.cited } : null;
      for (const domain of hit?.rivals || []) rivals.add(domain);
    }
    return { prompt: p.prompt, group: p.group || '', service: p.service || '', cells, rivals: [...rivals].slice(0, 6) };
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
    breakNote
  };
}
