/**
 * "Social channels" tiles + "Recent posts across channels" (Marketing & Campaigns). Read-only: builds the five tiles
 * (Facebook · Instagram · LinkedIn · YouTube · Google Business) from stored data, never writes.
 * Rules: last 28 days vs the 28 before; green up / red down / grey flat within ±2%; a channel without data says what is
 * needed and never shows 0 or an invented figure; "vs channel avg" compares a post only with its own channel.
 */
import { connectionStatus } from './oauth.mjs';
import { evidencedRows } from './evidence.mjs';

const DAY = 864e5;
export const WIN = 28;
const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso, n) => isoDate(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) + n * DAY);
const fmt = (v) => Number(v).toLocaleString('en-GB');
const hasAny = (rows, f) => rows.some((r) => r[f] != null);
const sum = (rows, f) => rows.reduce((t, r) => t + (Number(r[f]) || 0), 0);
const sumOrNull = (rows, f) => (hasAny(rows, f) ? sum(rows, f) : null);

function dirOf(abs, pct) {
  if (pct == null) return abs > 0 ? 'up' : (abs < 0 ? 'down' : 'flat');
  if (pct > 2) return 'up';
  return pct < -2 ? 'down' : 'flat';
}
export function deltaOf(cur, prev) {
  if (cur == null || prev == null) return null;
  const abs = cur - prev;
  const pct = prev ? Math.round((abs / prev) * 10000) / 100 : null;
  return { abs, pct, dir: dirOf(abs, pct) };
}

/** Rows whose `field` date falls in (end - to days, end - from days]. */
const inWindow = (rows, field, endIso, from, to) => rows.filter((r) => {
  const d = String(r[field]).slice(0, 10);
  return d > addDays(endIso, -to) && d <= addDays(endIso, -from);
});
const nearestOnOrBefore = (rows, field, iso) => rows.filter((r) => String(r[field]).slice(0, 10) <= iso).sort((a, b) => String(b[field]).localeCompare(String(a[field])))[0] || null;

/* ---------- "not comparable yet": a change needs ≥ 90% of the earlier period covered by non-null data ---------- */

export const COVER_MIN = 0.9;
export const notComparable = (note) => ({ not_comparable: true, note });
/** Days of the earlier window with a non-null `field` (a weekly row covers 7 days). */
export function windowCoverage(rows, field, endIso, from, to) {
  const days = to - from;
  const covered = Math.min(days, inWindow(rows, 'date', endIso, from, to).filter((r) => r[field] != null).reduce((t, r) => t + (Number(r.period_days) || 1), 0));
  return { covered, of: days, ok: covered >= COVER_MIN * days };
}
const coverNote = (c) => `earlier ${c.of} days: ${c.covered} have data (needs ${Math.ceil(COVER_MIN * c.of)})`;
export function compare(cur, prev, cov) {
  if (cur == null) return null;
  if (!cov.ok || prev == null) return notComparable(coverNote(cov));
  return deltaOf(cur, prev);
}
/** Point figures (followers, subscribers, a 28-day total): the earlier reading must be within `tol` days of 28 days back. */
export function pointCompare(cur, rows, field, dateField, lastIso, tol) {
  if (cur == null) return null;
  const target = addDays(lastIso, -WIN);
  const gap = (r) => Math.abs(Date.parse(`${String(r[dateField]).slice(0, 10)}T00:00:00Z`) - Date.parse(`${target}T00:00:00Z`)) / DAY;
  const near = rows.filter((r) => r[field] != null && String(r[dateField]).slice(0, 10) < String(lastIso).slice(0, 10) && gap(r) <= tol)
    .sort((a, b) => gap(a) - gap(b) || String(a[dateField]).localeCompare(String(b[dateField])));
  const first = rows.filter((r) => r[field] != null).map((r) => String(r[dateField]).slice(0, 10)).sort()[0];
  if (!near.length) return notComparable(`no reading near ${target} (first reading ${first || '—'})`);
  return deltaOf(cur, near[0][field]);
}

/* ---------- GA4 visits to the website, per channel ---------- */

const GA4_RULES = [
  ['facebook', /(^|\.)facebook\.com$|^(fb|facebook)$/i],
  ['instagram', /(^|\.)instagram\.com$|^(ig|instagram)$/i],
  ['linkedin', /(^|\.)linkedin\.com$|^lnkd\.in$|^linkedin$/i],
  ['youtube', /(^|\.)youtube\.com$|^youtu\.be$|^youtube$/i]
];
export function ga4ChannelOf(r) {
  if (/gbp|gmb|google.?business/i.test(r.source || '') || /^(gbp|gmb)$/i.test(r.medium || '')) return 'gbp';
  return GA4_RULES.find(([, re]) => re.test(String(r.source || '').trim()))?.[0] || null;
}
/** Sessions by source/medium, 28 days to GA4's latest day vs the 28 before (`days` = dates GA4 has data for). */
export function ga4Visits(rows, latestIso, days = null) {
  const out = { window: latestIso ? { start: addDays(latestIso, -27), end: latestIso } : null };
  if (latestIso) {
    const set = new Set(days || []);
    const covered = days ? [...set].filter((d) => d > addDays(latestIso, -2 * WIN) && d <= addDays(latestIso, -WIN)).length : 0;
    out.prev_coverage = { covered, of: WIN, ok: covered >= COVER_MIN * WIN };
  }
  for (const ch of ['facebook', 'instagram', 'linkedin', 'youtube', 'gbp']) out[ch] = latestIso ? { cur: 0, prev: 0, tagged: false } : null;
  if (!latestIso) return out;
  for (const r of rows) {
    const ch = ga4ChannelOf(r);
    if (!ch) continue;
    out[ch].tagged = true;
    const d = String(r.date).slice(0, 10);
    if (d > addDays(latestIso, -WIN)) out[ch].cur += Number(r.sessions) || 0;
    else if (d > addDays(latestIso, -2 * WIN)) out[ch].prev += Number(r.sessions) || 0;
  }
  return out;
}
function ga4Row(ga4, key) {
  const v = ga4[key];
  if (!v) return { label: 'Visits to website (GA4)', text: '—', note: 'GA4 not read yet' };
  if (key === 'gbp' && !v.tagged) return { label: 'Visits to website (GA4)', text: '—', note: 'not tagged', title: 'GA4 has no session tagged utm_source=gbp (or gmb) in the last 56 days; Google Business website clicks are shown above' };
  return { label: 'Visits to website (GA4)', value: v.cur, delta: compare(v.cur, v.prev, ga4.prev_coverage || { covered: 0, of: WIN, ok: false }) };
}

/* ---------- posts, compared within their own channel ---------- */

const METRIC_LABEL = { facebook: 'reach', instagram: 'reach', linkedin: 'impr.', youtube: 'views' };
export function normalisePost(p) {
  const metric = p.channel === 'linkedin' ? p.impressions : p.reach;
  return {
    channel: p.channel, post_id: p.post_id, posted_at: p.posted_at, title: p.title, permalink: p.permalink, source: p.source,
    reach: metric ?? null, reach_label: METRIC_LABEL[p.channel], likes: p.likes ?? null, comments: p.comments ?? null,
    shares: p.channel === 'instagram' ? (p.saves ?? null) : (p.shares ?? null)
  };
}
export const videoPost = (v) => ({
  channel: 'youtube', post_id: v.video_id, posted_at: v.published_at, title: v.title, permalink: `https://youtu.be/${v.video_id}`, source: 'api',
  reach: v.views ?? null, reach_label: 'views', likes: v.likes ?? null, comments: v.comments ?? null, shares: null
});

/** The post's reach / views vs the mean of its channel's posts in the 28 days up to it (itself included); null under 2 posts. */
export function vsChannelAvg(post, channelPosts) {
  if (post.reach == null) return null;
  const t = Date.parse(post.posted_at);
  const base = channelPosts.filter((p) => p.reach != null && Date.parse(p.posted_at) <= t && Date.parse(p.posted_at) > t - WIN * DAY);
  if (base.length < 2) return null;
  const avg = base.reduce((s, p) => s + p.reach, 0) / base.length;
  if (!avg) return null;
  const pct = Math.round(((post.reach - avg) / avg) * 100);
  return { pct, badge: pct > 10 ? 'above' : (pct < -10 ? 'below' : 'average'), avg: Math.round(avg), n: base.length };
}

const ageDays = (fromIso, toIso) => Math.round((Date.parse(`${String(toIso).slice(0, 10)}T00:00:00Z`) - Date.parse(`${String(fromIso).slice(0, 10)}T00:00:00Z`)) / DAY);
/**
 * YouTube views keep growing, so a video is compared with its channel's other videos at the SAME age, read from the
 * daily youtube_video_stats snapshots (e.g. a 10-day-old video against the earlier videos' views on their day 10).
 */
export function youtubeVs(post, vids, snapshots, latestIso) {
  const idx = new Map((snapshots || []).map((s) => [`${s.video_id}|${s.captured_date}`, Number(s.views)]));
  const age = ageDays(post.posted_at, latestIso);
  const peers = vids.map((v) => ({ ...v, reach: v.post_id === post.post_id ? post.reach : idx.get(`${v.post_id}|${addDays(v.posted_at, age)}`) ?? null }));
  const r = vsChannelAvg(post, peers);
  return r ? { ...r, basis: `views at ${age} days old` } : null;
}

/** Facebook / Instagram / LinkedIn at equal age from social_post_snapshots (one row per post per day). */
export function sameAgeVs(post, channelPosts, snapshots, todayIso) {
  const field = post.channel === 'linkedin' ? 'impressions' : 'reach';
  const idx = new Map((snapshots || []).filter((s) => s.channel === post.channel).map((s) => [`${s.post_id}|${String(s.captured_date).slice(0, 10)}`, s[field]]));
  const age = ageDays(post.posted_at, todayIso);
  const peers = channelPosts.filter((p) => p.source !== 'evidence').map((p) => ({ ...p, reach: p.post_id === post.post_id ? post.reach : idx.get(`${p.post_id}|${addDays(p.posted_at, age)}`) ?? null }));
  const r = vsChannelAvg(post, peers);
  return r ? { ...r, basis: `${field} at ${age} day${age === 1 ? '' : 's'} old` } : null;
}

export function recentPosts(all, limit = 10, vsFor = vsChannelAvg) {
  const byCh = all.reduce((m, p) => m.set(p.channel, [...(m.get(p.channel) || []), p]), new Map());
  return [...all].sort((a, b) => String(b.posted_at).localeCompare(String(a.posted_at))).slice(0, limit)
    .map((p) => ({ ...p, vs: vsFor(p, byCh.get(p.channel)) }));
}

const newestFirst = (posts) => [...posts].sort((a, b) => String(b.posted_at).localeCompare(String(a.posted_at)));
function latestBox(posts, verb, vsFor = vsChannelAvg) {
  const p = newestFirst(posts)[0];
  if (!p) return null;
  const bits = [p.likes != null ? `${fmt(p.likes)} ${verb}` : null, p.comments != null ? `${fmt(p.comments)} comments` : null, p.reach != null ? `${fmt(p.reach)} ${p.reach_label}` : null].filter(Boolean);
  return { date: p.posted_at, title: p.title || '(no text)', line: bits.join(' · '), vs: vsFor(p, posts), permalink: p.permalink };
}
const triple = (posts, c) => (posts.length ? `${fmt(sum(posts, 'likes'))} · ${fmt(sum(posts, 'comments'))} · ${fmt(sum(posts, c))}` : null);
function engagement(posts, reach) {
  if (!posts.length || !reach) return null;
  return Math.round(((sum(posts, 'likes') + sum(posts, 'comments') + sum(posts, 'shares')) / reach) * 1000) / 10;
}
const lastCollected = (rows) => rows.map((r) => r.collected_at).filter(Boolean).sort().slice(-1)[0] || null;
const followersHeadline = (rows, unit, tol) => {
  const withF = rows.filter((r) => r.followers != null).sort((a, b) => a.date.localeCompare(b.date));
  const last = withF[withF.length - 1];
  if (!last) return null;
  return { value: last.followers, unit, delta: pointCompare(last.followers, withF, 'followers', 'date', last.date, tol), as_of: last.date };
};

/* ---------- Facebook / Instagram ---------- */

const META_NAME = { facebook: 'Facebook', instagram: 'Instagram' };
function metaNeeds(key, conn) {
  if (conn.state === 'not_configured') return `Needs the Meta app first: Alan adds ${conn.missing.join(', ')} in Vercel, then presses "Connect Facebook & Instagram".`;
  if (conn.state === 'not_connected') return 'Needs: press "Connect Facebook & Instagram" and approve read-only access (Page + linked Instagram business account).';
  if (conn.state === 'expired') return 'The Meta connection has expired: reconnect.';
  if (key === 'instagram' && !conn.ig_linked) return `No Instagram business account is linked to the Page${conn.page_name ? ` "${conn.page_name}"` : ''}: link it in Meta Business Suite, then reconnect.`;
  return 'Connected: the first collection has not run yet (press "Collect now").';
}
function metaState(conn, hasData) {
  if (!hasData) return conn.state === 'connected' ? 'connected_no_data' : conn.state;
  return conn.state === 'connected' ? 'live' : 'stale';
}
export function metaTile(key, { conn, daily, posts, ga4, todayIso, vsFor = vsChannelAvg }) {
  const own = daily.filter((r) => r.channel === key);
  const mine = posts.filter((p) => p.channel === key);
  const base = { key, name: META_NAME[key], state: metaState(conn, own.length || mine.length), connection: conn };
  if (!own.length && !mine.length) return { ...base, needs: metaNeeds(key, conn), rows: [ga4Row(ga4, key)] };
  const cur = inWindow(own, 'date', todayIso, 0, WIN);
  const prev = inWindow(own, 'date', todayIso, WIN, 2 * WIN);
  const reach = sumOrNull(cur, 'reach');
  const winPosts = inWindow(mine, 'posted_at', todayIso, 0, WIN);
  const fb = key === 'facebook';
  return {
    ...base,
    headline: followersHeadline(own, 'followers', 3),
    rows: [
      { label: 'Reach (28 days)', value: reach, delta: compare(reach, sumOrNull(prev, 'reach'), windowCoverage(own, 'reach', todayIso, WIN, 2 * WIN)) },
      { label: fb ? 'Reactions · comments · shares' : 'Likes · comments · saves', text: triple(winPosts, 'shares') || '—' },
      { label: 'Engagement rate', value: engagement(winPosts, sumOrNull(winPosts, 'reach')), unit: 'pct1' },
      { label: 'Posts', value: winPosts.length },
      ga4Row(ga4, key)
    ],
    latest: latestBox(mine, fb ? 'reactions' : 'likes', vsFor),
    source: { tone: conn.state === 'connected' ? 'live' : 'warn', text: `Meta Graph API (${fb ? 'Page' : 'IG business'})`, read_at: lastCollected([...own, ...mine]) }
  };
}

/* ---------- LinkedIn (manual weekly entry) ---------- */

export const LINKEDIN_STALE_DAYS = 10;
/** "GPT · entered 8 Nov" or "manual · last entered 8 Nov": from the most recently entered week row. */
function enteredLine(rows, now) {
  const latest = [...rows].sort((a, b) => String(a.collected_at).localeCompare(String(b.collected_at))).pop();
  const stale = now - Date.parse(latest.collected_at) > LINKEDIN_STALE_DAYS * DAY;
  const who = latest.source === 'gpt' ? 'GPT · entered' : 'manual · last entered';
  return { stale, text: `${who} ${latest.collected_at.slice(0, 10)}${stale ? ` (over ${LINKEDIN_STALE_DAYS} days ago)` : ''}`, entered_at: latest.collected_at, entered_source: latest.source };
}
export function linkedinTile({ daily, posts, ga4, now, vsFor = vsChannelAvg }) {
  const rows = daily.filter((r) => r.channel === 'linkedin' && ['manual', 'gpt'].includes(r.source)).sort((a, b) => a.date.localeCompare(b.date));
  const mine = posts.filter((p) => p.channel === 'linkedin');
  const base = { key: 'linkedin', name: 'LinkedIn' };
  if (!rows.length) return { ...base, state: 'not_entered', needs: 'Personal profiles have no analytics API: press "Enter this week" (or GPT sends the week through the API) with followers, 7-day impressions, reactions, comments, reposts.', rows: [ga4Row(ga4, 'linkedin')], source: { tone: 'muted', text: 'manual · not entered yet' } };
  const last = rows[rows.length - 1];
  const line = enteredLine(rows, now);
  const cur = inWindow(rows, 'date', last.date, 0, WIN);
  const prev = inWindow(rows, 'date', last.date, WIN, 2 * WIN);
  const impr = sumOrNull(cur, 'impressions');
  return {
    ...base, state: line.stale ? 'manual_stale' : 'manual',
    headline: followersHeadline(rows, 'followers', 7),
    rows: [
      { label: `Impressions (${cur.length} wk${cur.length === 1 ? '' : 's'})`, value: impr, delta: compare(impr, sumOrNull(prev, 'impressions'), windowCoverage(rows, 'impressions', last.date, WIN, 2 * WIN)) },
      { label: 'Reactions · comments · reposts', text: hasAny(cur, 'reactions') ? `${fmt(sum(cur, 'reactions'))} · ${fmt(sum(cur, 'comments'))} · ${fmt(sum(cur, 'shares'))}` : '—' },
      { label: 'Engagement rate', value: impr ? Math.round(((sum(cur, 'reactions') + sum(cur, 'comments') + sum(cur, 'shares')) / impr) * 1000) / 10 : null, unit: 'pct1' },
      { label: 'Posts', value: sumOrNull(cur, 'posts') },
      ga4Row(ga4, 'linkedin')
    ],
    latest: latestBox(mine, 'reactions', vsFor),
    source: { tone: line.stale ? 'warn' : 'manual', text: line.text, entered_at: line.entered_at, entered_source: line.entered_source, week_ending: last.date }
  };
}

/* ---------- YouTube (youtube_channel_stats / youtube_video_stats) ---------- */

export function youtubeTile({ channel, videos, snapshots }, ga4) {
  const cur = channel[0];
  if (!cur) return { key: 'youtube', name: 'YouTube', state: 'no_data', needs: 'The YouTube collector (youtube-stats-sync) has not saved a day yet.', rows: [ga4Row(ga4, 'youtube')] };
  const vids = videos.map(videoPost);
  const fresh = inWindow(vids, 'posted_at', cur.captured_date, 0, WIN);
  const point = (f) => pointCompare(cur[f], channel, f, 'captured_date', cur.captured_date, 3);
  return {
    key: 'youtube', name: 'YouTube', state: 'live',
    headline: { value: cur.subscribers, unit: 'subscribers', delta: point('subscribers'), as_of: cur.captured_date },
    rows: [
      { label: 'Views (28 days)', value: cur.views_window, delta: point('views_window') },
      { label: 'Watch time', value: cur.watch_time_minutes_window == null ? null : Math.round(cur.watch_time_minutes_window / 60), unit: 'hrs' },
      { label: 'Thumbnail click rate', value: cur.impressions_ctr_window == null ? null : Math.round(Number(cur.impressions_ctr_window) * 10) / 10, unit: 'pct1' },
      { label: 'Videos · new in 28 days', text: `${fmt(cur.total_videos)} · ${fmt(fresh.length)}` },
      ga4Row(ga4, 'youtube')
    ],
    latest: latestBox(vids, 'likes', (p, all) => youtubeVs(p, all, snapshots, cur.captured_date)),
    latest_label: 'Latest video',
    source: { tone: 'live', text: 'YouTube APIs', read_at: cur.created_at }
  };
}

/* ---------- Google Business (gbp_performance_monthly, monthly) ---------- */

const gbpViews = (m) => (m ? ['impressions_search_mobile', 'impressions_search_desktop', 'impressions_maps_mobile', 'impressions_maps_desktop'].reduce((t, k) => t + (Number(m[k]) || 0), 0) : null);
const monLabel = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
function gbpPosts(st) {
  if (!st?.reachable) return { label: 'Posts (Viking Local)', text: '—', note: 'not visible from here' };
  return { label: 'Posts (Viking Local)', text: `${fmt(st.posts_28d)} in 28 days` };
}
function gbpReviews(st) {
  const r = st?.reviews;
  if (!r?.available || r.total == null) return { label: 'Reviews', text: '—' };
  return { label: 'Reviews', text: `${fmt(r.total)} · ${r.average ?? '—'} ★` };
}
function gbpPartialRow(partial) {
  if (!partial) return null;
  return { label: `${monLabel(partial.month)} to date`, wide: true, text: `${fmt(gbpViews(partial))} views · ${fmt(partial.interactions ?? 0)} interactions · ${fmt(partial.website_clicks ?? 0)} clicks` };
}
/** Headline month = the latest complete month; the current month shows as "{Mon} to date". */
function gbpMonths(months, todayIso) {
  const partial = months[0].month.slice(0, 7) === todayIso.slice(0, 7) ? months[0] : null;
  const [full, before] = partial ? [months[1], months[2]] : [months[0], months[1]];
  return { partial, full, before: before || null, head: full || partial };
}
/** A month is a complete figure: comparable when the month before is saved. */
const monthCompare = (cur, before, k) => (before && before[k] != null ? deltaOf(cur, before[k]) : (cur == null ? null : notComparable('no earlier month saved')));
function gbpRows({ partial, full, before, head }, st, ga4) {
  return [
    { label: 'Interactions', value: head.interactions, delta: monthCompare(head.interactions, before, 'interactions') },
    { label: 'Website clicks', value: head.website_clicks, delta: monthCompare(head.website_clicks, before, 'website_clicks') },
    { label: 'Directions · calls', text: `${fmt(head.direction_requests ?? 0)} · ${fmt(head.call_clicks ?? 0)}` },
    full ? gbpPartialRow(partial) : null, gbpPosts(st), gbpReviews(st), ga4Row(ga4, 'gbp')
  ].filter(Boolean);
}
const gbpLatest = (st) => (st?.reachable && st.last_post_at ? { date: st.last_post_at, title: 'Viking Local auto post', line: 'Google doesn\'t report per-post response', vs: null } : null);
export function gbpTile(months, st, ga4, todayIso) {
  if (!months.length) return { key: 'gbp', name: 'Google Business', state: 'no_data', needs: 'No Google Business Profile month saved yet (gbp-brand-demand-sync).', rows: [] };
  const m = gbpMonths(months, todayIso);
  return {
    key: 'gbp', name: 'Google Business', state: 'live',
    headline: { value: gbpViews(m.head), unit: `views (${monLabel(m.head.month)})`, delta: m.before ? deltaOf(gbpViews(m.head), gbpViews(m.before)) : notComparable('no earlier month saved'), vs_label: m.before ? `vs ${monLabel(m.before.month)}` : null },
    rows: gbpRows(m, st, ga4), latest: gbpLatest(st), latest_label: 'Latest post',
    source: { tone: 'live', text: `Business Profile API · monthly${m.partial ? ` (${monLabel(m.partial.month)} partial)` : ''}`, read_at: st?.reachable ? st.read_at || null : null }
  };
}

/* ---------- everything ---------- */

const withTimeout = (p, ms, fallback) => Promise.race([p.catch(() => fallback), new Promise((ok) => setTimeout(() => ok(fallback), ms))]);

export async function buildSummary({ repo, env = process.env, now = Date.now(), gbpStatus = async () => null }) {
  const nowIso = new Date(now).toISOString();
  const todayIso = nowIso.slice(0, 10);
  const [connRow, daily, rawPosts, yt, months, ga4Latest, st] = await Promise.all([
    repo.getConnectionStatus(), repo.readDaily(['facebook', 'instagram', 'linkedin'], addDays(todayIso, -2 * WIN - 7)),
    repo.readPosts(['facebook', 'instagram', 'linkedin'], new Date(now - 130 * DAY).toISOString()), repo.readYoutube(), repo.readGbpMonths(),
    repo.ga4LatestDate(), withTimeout(gbpStatus(), 8000, { reachable: false, error: 'timeout' })
  ]);
  const [ga4Rows, ga4Days, snapshots, ev] = await Promise.all([
    ga4Latest ? repo.readGa4Social(addDays(ga4Latest, -2 * WIN + 1)) : [], ga4Latest ? repo.ga4Days(addDays(ga4Latest, -2 * WIN + 1), ga4Latest) : [],
    repo.readSnapshots(['facebook', 'instagram', 'linkedin'], addDays(todayIso, -130)), readEvidence(repo, todayIso)
  ]);
  const ga4 = ga4Visits(ga4Rows, ga4Latest, ga4Days);
  const conn = connectionStatus(connRow, env);
  const posts = rawPosts.map(normalisePost);
  const stRead = st ? { ...st, read_at: st.reachable ? nowIso : null } : null;
  const ytDay = yt.channel[0]?.captured_date;
  const vsFor = (p, same) => (p.channel === 'youtube' ? youtubeVs(p, same, yt.snapshots, ytDay) : sameAgeVs(p, same, snapshots, todayIso));
  const evidenced = evidencedRows({ ...ev, posts });
  const listed = [...posts.filter((p) => !evidenced.replaced.has(`${p.channel}|${p.post_id}`)), ...evidenced.rows, ...yt.videos.map(videoPost)];
  return {
    ok: true, as_of: nowIso, connection: conn, ga4_window: ga4.window,
    channels: [
      metaTile('facebook', { conn, daily, posts, ga4, todayIso, vsFor }), metaTile('instagram', { conn, daily, posts, ga4, todayIso, vsFor }),
      linkedinTile({ daily, posts, ga4, now, vsFor }), youtubeTile(yt, ga4), gbpTile(months, stRead, ga4, todayIso)
    ],
    posts: recentPosts(listed, Math.max(10, evidenced.rows.length), vsFor)
  };
}

/** Today's evidenced campaign steps (social channels only) with their step records and stored purpose tags. */
async function readEvidence(repo, todayIso) {
  const ticks = (await repo.readEvidence(`${todayIso}T00:00:00Z`)).filter((t) => /\|(Facebook|Instagram|LinkedIn)/i.test(t.tick_key));
  const bases = [...new Set(ticks.map((t) => t.tick_key.replace(/\|(fb|ig)$/, '')))];
  const [steps, tags] = await Promise.all([repo.readSteps(bases), repo.readDeliveryPurposes([...bases, ...ticks.map((t) => t.tick_key)])]);
  return { ticks, steps, tags };
}
