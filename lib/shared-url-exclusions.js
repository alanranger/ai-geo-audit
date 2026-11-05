/**
 * Pages no tool may track or audit: alan-shared-resources config/url-exclusions.json (the one shared rule),
 * read from raw GitHub because Vercel cannot see the PC copy. Same matching as alan-shared-resources/scripts/url-exclusions.mjs.
 */
export const EXCLUSIONS_RAW_URL = 'https://raw.githubusercontent.com/alanranger/alan-shared-resources/main/config/url-exclusions.json';
const TTL_MS = 10 * 60 * 1000;
let cache = { at: 0, prefixes: [] };

export function prefixesFrom(config) {
  return (Array.isArray(config?.pathPrefixes) ? config.pathPrefixes : [])
    .map((p) => String(typeof p === 'string' ? p : p?.prefix || '').trim().toLowerCase().replace(/\/+$/, ''))
    .filter((p) => p.startsWith('/') && p.length > 1);
}

/** Cached 10 minutes; a failed read keeps the last good list. */
export async function loadExclusionPrefixes({ fetchFn = fetch, now = Date.now() } = {}) {
  if (cache.at && now - cache.at < TTL_MS) return cache.prefixes;
  try {
    const res = await fetchFn(`${EXCLUSIONS_RAW_URL}?_ts=${now}`, { cache: 'no-store' });
    if (res.ok) cache = { at: now, prefixes: prefixesFrom(await res.json()) };
  } catch {
    // keep the last good list
  }
  return cache.prefixes;
}

export function resetExclusionCache() {
  cache = { at: 0, prefixes: [] };
}

export function pathOf(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  let full = raw;
  if (raw.startsWith('/')) full = `https://x${raw}`;
  else if (!/^[a-z]+:\/\//i.test(raw)) full = `https://${raw}`;
  try {
    return new URL(full).pathname.toLowerCase();
  } catch {
    return raw.split(/[?#]/)[0].toLowerCase();
  }
}

export function isExcludedUrl(url, prefixes) {
  const p = pathOf(url).replace(/\/+$/, '');
  return (prefixes || []).some((pre) => p === pre || p.startsWith(`${pre}/`));
}

export async function withoutExcludedUrls(items, pick = (u) => u, opts = {}) {
  const prefixes = await loadExclusionPrefixes(opts);
  if (!prefixes.length) return Array.isArray(items) ? items : [];
  return (Array.isArray(items) ? items : []).filter((item) => !isExcludedUrl(pick(item), prefixes));
}
