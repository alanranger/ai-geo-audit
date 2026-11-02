/**
 * Our page titles → canonical URL (from page_entities). Google redirect items whose breadcrumb only shows
 * our host ("https://www.alanranger.com") carry no path; the result title then identifies the real page.
 */

const TTL_MS = 10 * 60 * 1000;
const cache = new Map();

export const normTitle = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();

async function fetchTitles(targetRoot, supabaseUrl, supabaseKey, fetchImpl) {
  const q = `${supabaseUrl}/rest/v1/page_entities?select=url,title&url=like.*${encodeURIComponent(targetRoot)}*&limit=5000`;
  const r = await fetchImpl(q, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
  if (!r.ok) return new Map();
  const map = new Map();
  for (const row of await r.json()) {
    const key = normTitle(row?.title);
    if (key && row?.url && !map.has(key)) map.set(key, String(row.url).split(/[?#]/)[0]);
  }
  return map;
}

/** Title map for a target root; empty on any error (resolution then keeps the host-only URL). */
export async function loadOurPageTitles(targetRoot, {
  supabaseUrl = process.env.SUPABASE_URL,
  supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  if (!targetRoot || !supabaseUrl || !supabaseKey) return new Map();
  const hit = cache.get(targetRoot);
  if (hit && now - hit.at < TTL_MS) return hit.map;
  try {
    const map = await fetchTitles(targetRoot, supabaseUrl, supabaseKey, fetchImpl);
    cache.set(targetRoot, { at: now, map });
    return map;
  } catch {
    return new Map();
  }
}

const isHostOnly = (url) => { try { return new URL(url).pathname === '/'; } catch { return false; } };

/** Resolved redirect items on our host with no path get the page matching their title. */
export function applyOurPageTitles(items, targetRoot, titles) {
  if (!Array.isArray(items) || !titles?.size) return items;
  return items.map((it) => {
    if (!it?.redirect_resolved || !String(it.domain || '').endsWith(targetRoot) || !isHostOnly(it.url)) return it;
    const url = titles.get(normTitle(it.title));
    return url ? { ...it, url, redirect_resolved: `${it.redirect_resolved}+title` } : it;
  });
}
