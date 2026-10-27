/** Text + JSON-LD helpers shared by the page checks. Pure functions. */

export function normWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9'\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function wordCount(text) {
  return normWords(text).length;
}

/** True when the first `n` words of `needleText` appear, in order, within the first `windowWords` of `haystackText`. */
export function bodyStartsInPage(needleText, haystackText, n, windowWords) {
  const b = normWords(needleText).slice(0, n);
  if (!b.length) return false;
  const p = normWords(haystackText).slice(0, windowWords + n);
  return ` ${p.join(' ')} `.includes(` ${b.join(' ')} `);
}

export function sameText(a, b) {
  const clean = (s) => String(s || '').trim().replace(/[.\s]+$/, '').replace(/\s+/g, ' ').toLowerCase();
  return !!clean(a) && clean(a) === clean(b);
}

export function typesOf(node) {
  return [].concat(node?.['@type'] || []).map((t) => String(t));
}

export function hasType(node, type) {
  return typesOf(node).some((t) => t.toLowerCase() === type.toLowerCase());
}

/** Parse every ld+json script; flatten arrays and @graph. */
export function parseJsonLd(texts) {
  const nodes = [];
  let parseErrors = 0;
  const push = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(push); return; }
    nodes.push(o);
    if (Array.isArray(o['@graph'])) o['@graph'].forEach(push);
  };
  for (const t of texts || []) {
    try { push(JSON.parse(t)); } catch { parseErrors += 1; }
  }
  return { nodes, parseErrors };
}

/** Count nodes of a type anywhere under `node` (offers inside course instances etc.). */
export function countDeep(node, type, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return 0;
  seen.add(node);
  let n = !Array.isArray(node) && hasType(node, type) ? 1 : 0;
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') n += countDeep(v, type, seen);
  }
  return n;
}

/** Question-style accordion labels: "How long … ? +" → counted; "1Pack the night before+" → not. */
export function questionLabels(labels) {
  const seen = new Set();
  for (const raw of labels || []) {
    const t = String(raw || '').replace(/[^\p{L}\p{N}?)"'\u2019]+$/u, '').replace(/^\d{1,2}[.)]?\s*/, '').trim();
    if (t.endsWith('?')) seen.add(t.toLowerCase());
  }
  return seen.size;
}

export function truncate(s, n = 140) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
