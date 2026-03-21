/**
 * Canonical page URLs for dfs_page_backlinks_cache + DB query variants (www vs bare host).
 * Keeps browser table URLs, API request URLs, and Supabase page_url aligned.
 */

export function normalizeDfsPageUrl(raw) {
  const s = String(raw || '').trim();
  if (!s || !/^https?:\/\//i.test(s)) return '';
  try {
    const u = new URL(s);
    const host = String(u.hostname || '').toLowerCase().replace(/^www\./, '');
    const path = String(u.pathname || '/').replace(/\/+$/, '') || '/';
    return `${u.protocol}//${host}${path}`;
  } catch {
    return '';
  }
}

/** Literal alternate stored by older jobs: same path, hostname prefixed with www. */
export function dfsPageUrlWwwLiteralForQuery(canonicalNorm) {
  const c = normalizeDfsPageUrl(canonicalNorm);
  if (!c) return '';
  try {
    const u = new URL(c);
    const h = String(u.hostname || '').toLowerCase();
    if (h.startsWith('www.')) return '';
    u.hostname = `www.${h}`;
    const path = String(u.pathname || '/').replace(/\/+$/, '') || '/';
    return `${u.protocol}//${u.hostname}${path}`;
  } catch {
    return '';
  }
}

export function dfsPageUrlDbQueryVariants(canonicalOrRaw) {
  const c = normalizeDfsPageUrl(canonicalOrRaw);
  if (!c) return [];
  const out = new Set([c]);
  const w = dfsPageUrlWwwLiteralForQuery(c);
  if (w) out.add(w);
  return [...out];
}

export function expandUrlListForBacklinkCacheQuery(urls) {
  const out = new Set();
  for (const u of urls || []) {
    for (const v of dfsPageUrlDbQueryVariants(u)) out.add(v);
  }
  return [...out];
}

export function indexDfsCacheRowsByCanonical(rows) {
  const m = new Map();
  const score = (row) => (Array.isArray(row?.backlink_rows) ? row.backlink_rows.length : 0);
  const t = (row) => {
    const x = Date.parse(String(row?.fetched_at || ''));
    return Number.isFinite(x) ? x : 0;
  };
  for (const r of rows || []) {
    if (!r || typeof r !== 'object') continue;
    const key = normalizeDfsPageUrl(r.page_url) || String(r.page_url || '').trim();
    if (!key) continue;
    const prev = m.get(key);
    if (!prev) {
      m.set(key, r);
      continue;
    }
    if (score(r) > score(prev) || (score(r) === score(prev) && t(r) > t(prev))) m.set(key, r);
  }
  return m;
}
