/**
 * Google Business Profile evidence for the Marketing channel line, read-only.
 * Source: the Business Profile API through this repo's GBP OAuth (lib/gbp/performance.js, scope business.manage):
 *   v4 accounts/{a}/locations/{l}/localPosts (createTime, topicType, state) and …/reviews (totalReviewCount,
 *   averageRating, newest createTime). The API does not say who made a post; Viking Local (LocalViking) is the
 *   automated poster, fed by the upload-sites CSV app, which keeps no records of its own.
 * Nothing is posted or replied to. Unreachable = { reachable: false } so the line says "not visible from here".
 */
import { resolveGbpLocation, withGbpToken } from './gbp/performance.js';

const V4 = 'https://mybusiness.googleapis.com/v4';
const CACHE_MS = 10 * 60 * 1000;
let cache = null;

async function getJson(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${r.status} ${j?.error?.message || 'request failed'}`);
  return j || {};
}

/** Posts newest first; a second page only when the first one is entirely inside the 28 days. */
async function recentPosts(base, token, since) {
  const first = await getJson(`${base}/localPosts?pageSize=100`, token);
  const posts = first.localPosts || [];
  const allRecent = posts.length && posts.every((p) => p.createTime >= since);
  if (allRecent && first.nextPageToken) posts.push(...((await getJson(`${base}/localPosts?pageSize=100&pageToken=${encodeURIComponent(first.nextPageToken)}`, token)).localPosts || []));
  return posts;
}

/** Counts and dates only (no post text, no reviewer names). */
export function summarisePosts(posts, reviews, nowMs = Date.now()) {
  const since = new Date(nowMs - 28 * 864e5).toISOString();
  const live = (posts || []).filter((p) => !p.state || p.state === 'LIVE');
  const recent = live.filter((p) => p.createTime >= since);
  const byType = recent.reduce((o, p) => ({ ...o, [p.topicType || 'STANDARD']: (o[p.topicType || 'STANDARD'] || 0) + 1 }), {});
  return {
    reachable: true, last_post_at: live.map((p) => p.createTime).sort().slice(-1)[0] || null, posts_28d: recent.length, posts_28d_by_type: byType,
    reviews: reviews ? { available: true, total: reviews.totalReviewCount ?? null, average: reviews.averageRating != null ? Math.round(reviews.averageRating * 10) / 10 : null, latest_at: reviews.reviews?.[0]?.createTime || null } : { available: false },
    source: 'Google Business Profile API (read-only, v4 localPosts + reviews via this dashboard\'s GBP connection); author of a post is not exposed, so posts are counted whatever made them'
  };
}

export async function loadGbpStatus({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let value;
  try {
    value = await withGbpToken(async (token) => {
      const loc = await resolveGbpLocation(token);
      const base = `${V4}/${loc.account_name}/locations/${loc.location_id}`;
      const posts = await recentPosts(base, token, new Date(Date.now() - 28 * 864e5).toISOString());
      const reviews = await getJson(`${base}/reviews?pageSize=1`, token).catch(() => null);
      return summarisePosts(posts, reviews);
    });
  } catch (e) {
    value = { reachable: false, error: e?.message || String(e), reviews: { available: false }, source: 'Google Business Profile API (not reachable from here)' };
  }
  cache = { at: Date.now(), value };
  return value;
}
