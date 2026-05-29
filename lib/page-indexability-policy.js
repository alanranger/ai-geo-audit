/** Page indexability policy resolver — mirrors policy_for_url() SQL semantics. */

function normStoredPath(path) {
  return String(path ?? '').toLowerCase().replace(/\/+$/, '');
}

/** Normalise any URL input to path shape (leading slash, lowercase, no query/fragment/trailing slash). */
export function normalizePath(url) {
  if (url == null || url === '') return '';
  let path = String(url).trim().toLowerCase();
  path = path.replace(/^https?:\/\/[^/]+/, '');
  path = path.replace(/[?#].*$/, '');
  path = path.replace(/\/+$/, '');
  return path;
}

function rowMatches(path, row) {
  const rule = normStoredPath(row.url_or_prefix);
  if (row.match_type === 'exact') return path === rule;
  if (row.match_type === 'prefix') return path === rule || path.startsWith(`${rule}/`);
  return false;
}

function rowRank(row) {
  const exact = row.match_type === 'exact' ? 1 : 0;
  return [exact, normStoredPath(row.url_or_prefix).length];
}

/** Return the single best-matching policy row, or null. */
export function resolvePolicy(url, policies) {
  const path = normalizePath(url);
  if (!path || !Array.isArray(policies) || !policies.length) return null;
  const matches = policies.filter((row) => rowMatches(path, row));
  if (!matches.length) return null;
  matches.sort((a, b) => {
    const [aExact, aLen] = rowRank(a);
    const [bExact, bLen] = rowRank(b);
    if (bExact !== aExact) return bExact - aExact;
    return bLen - aLen;
  });
  return matches[0];
}

function toDateOnly(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/** Active only when effective_date is set and asOfDate is on/after that date. */
export function isPolicyActive(row, asOfDate = new Date()) {
  if (!row || row.effective_date == null) return false;
  return toDateOnly(asOfDate) >= toDateOnly(row.effective_date);
}
