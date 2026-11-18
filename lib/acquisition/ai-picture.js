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

export function engineLine(engine) {
  if (!engine || engine.ok === false || engine.named == null) return { text: 'no data this week', ok: false, trend: '' };
  return { text: `${engine.named} of ${engine.of}`, ok: true, trend: engine.trend || '' };
}

export function engineRows(picture) {
  const engines = picture?.engines || {};
  const prompts = engines.chat_gpt?.prompts || [];
  return prompts.map((p) => {
    const cells = {};
    const rivals = new Set(p.rivals || []);
    for (const key of ENGINE_KEYS) {
      const hit = (engines[key]?.prompts || []).find((x) => x.prompt === p.prompt);
      cells[key] = hit ? { named: !!hit.named, cited: !!hit.cited } : null;
      for (const domain of hit?.rivals || []) rivals.add(domain);
    }
    return { prompt: p.prompt, cells, rivals: [...rivals].slice(0, 6) };
  });
}

export function pictureFrom(snaps, rankRows, rankAt) {
  const latest = snaps?.[0] || null;
  const prev = snaps?.[1] || null;
  const engines = { ...(latest?.meta?.engines || {}) };
  const chat = chatFrom(latest);
  if (chat) engines.chat_gpt = { ...chat, at: latest?.run_at || null };
  for (const key of Object.keys(engines)) {
    const old = prev?.meta?.engines?.[key];
    if (old && old.named != null) engines[key] = { ...engines[key], trend: `was ${old.named} of ${old.of}` };
    if (!engines[key].at) engines[key] = { ...engines[key], at: latest?.run_at || null };
  }
  const t = tally(rankRows);
  return {
    engines,
    google_aio: { ok: t.aioShown > 0, named: t.aioCited, of: t.aioShown, at: rankAt || null },
    google_ai_mode: { ok: t.modeOf > 0, named: t.modeCited, of: t.modeOf, at: rankAt || null },
    gaps: gapLines(engines),
    rivals: rivalLines(engines)
  };
}
