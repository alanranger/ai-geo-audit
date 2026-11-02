/**
 * Lookups that finish Google-redirect resolution (see serp-redirect-owner.js) when the item itself is not enough:
 * - our page titles → URL (page_entities): our results whose breadcrumb shows only the host carry no path;
 * - local-pack place id (cid) → domain (v_local_pack_cid_domain): local-pack items carry no breadcrumb at all.
 * Both are cached per instance for 10 minutes and are empty on any error (resolution then keeps what it had).
 */

const TTL_MS = 10 * 60 * 1000;
const cache = new Map();

export const normTitle = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
const GOOGLE_HOST = /^(www\.)?google\.[a-z.]+$/i;

const SOURCES = {
  titles: {
    path: (root) => `page_entities?select=url,title&url=like.*${encodeURIComponent(root)}*&limit=5000`,
    entry: (row) => [normTitle(row?.title), row?.url ? String(row.url).split(/[?#]/)[0] : ''],
  },
  cids: {
    path: () => 'v_local_pack_cid_domain?select=cid,domain&limit=10000',
    entry: (row) => [String(row?.cid || ''), String(row?.domain || '')],
  },
};

async function fetchMap(kind, root, supabaseUrl, supabaseKey, fetchImpl) {
  const src = SOURCES[kind];
  const r = await fetchImpl(`${supabaseUrl}/rest/v1/${src.path(root)}`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
  if (!r.ok) return new Map();
  const map = new Map();
  for (const row of await r.json()) {
    const [key, value] = src.entry(row);
    if (key && value && !map.has(key)) map.set(key, value);
  }
  return map;
}

async function loadLookup(kind, root, {
  supabaseUrl = process.env.SUPABASE_URL,
  supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  if (!root || !supabaseUrl || !supabaseKey) return new Map();
  const cacheKey = `${kind}:${root}`;
  const hit = cache.get(cacheKey);
  if (hit && now - hit.at < TTL_MS) return hit.map;
  try {
    const map = await fetchMap(kind, root, supabaseUrl, supabaseKey, fetchImpl);
    cache.set(cacheKey, { at: now, map });
    return map;
  } catch {
    return new Map();
  }
}

/** Both lookups for one target root. */
export async function loadRedirectLookups(targetRoot, opts = {}) {
  const [titles, cids] = await Promise.all([loadLookup('titles', targetRoot, opts), loadLookup('cids', targetRoot, opts)]);
  return { titles, cids };
}

const isHostOnly = (url) => { try { return new URL(url).pathname === '/'; } catch { return false; } };

function withTitle(it, targetRoot, titles) {
  if (!it?.redirect_resolved || !String(it.domain || '').endsWith(targetRoot) || !isHostOnly(it.url)) return it;
  const url = titles.get(normTitle(it.title));
  return url ? { ...it, url, redirect_resolved: `${it.redirect_resolved}+title` } : it;
}

function withCid(it, cids) {
  if (it?.type !== 'local_pack' || !GOOGLE_HOST.test(String(it.domain || '')) || !it.cid) return it;
  const domain = cids.get(String(it.cid));
  return domain ? { ...it, domain, url: `https://${domain}/`, redirect_resolved: 'cid', redirect_url: it.url } : it;
}

/** Top-level items after resolveSerpRedirects: local-pack place ids, then our host-only results by title. */
export function applyRedirectLookups(items, targetRoot, { titles, cids } = {}) {
  if (!Array.isArray(items)) return items;
  return items.map((it) => {
    const byCid = cids?.size ? withCid(it, cids) : it;
    return titles?.size ? withTitle(byCid, targetRoot, titles) : byCid;
  });
}
