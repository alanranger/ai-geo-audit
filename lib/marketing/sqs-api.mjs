/**
 * Squarespace public API reads for the Marketing tab (GET only: profiles + commerce orders). Every list is paged by
 * cursor to the end; a run that can't reach the last page reports `complete: false` so callers never treat a partial
 * read as the whole list.
 */
const BASE = 'https://api.squarespace.com/1.0';
const MAX_PAGES = 400;

function headers() {
  const key = process.env.SQUARESPACE_API_KEY;
  if (!key) throw new Error('missing_env:SQUARESPACE_API_KEY');
  return { Authorization: `Bearer ${key}`, 'User-Agent': process.env.SQUARESPACE_USER_AGENT || 'AlanRanger-AIGEOAudit/1.0 (marketing-sync)' };
}

async function getJson(url, fetchFn) {
  const r = await fetchFn(url, { headers: headers() });
  if (!r.ok) throw new Error(`squarespace_http_${r.status}`);
  return r.json();
}

/** Pages `path` to the end. `listKey` is the array field (profiles / result). */
export async function fetchAllPages(path, listKey, { params = {}, fetchFn = fetch } = {}) {
  const items = [];
  let cursor = null;
  let pages = 0;
  do {
    const q = new URLSearchParams(cursor ? { cursor } : params);
    const j = await getJson(`${BASE}/${path}?${q}`, fetchFn);
    items.push(...(j[listKey] || []));
    cursor = j.pagination?.hasNextPage ? j.pagination.nextPageCursor : null;
    pages += 1;
  } while (cursor && pages < MAX_PAGES);
  return { items, pages, complete: !cursor };
}

export const fetchProfiles = (opts) => fetchAllPages('profiles', 'profiles', opts);

/** Orders modified inside [after, before]; both bounds are required by Squarespace when either is given. */
export function fetchOrders({ modifiedAfter, modifiedBefore, fetchFn } = {}) {
  const params = modifiedAfter ? { modifiedAfter, modifiedBefore: modifiedBefore || new Date().toISOString() } : {};
  return fetchAllPages('commerce/orders', 'result', { params, fetchFn });
}
