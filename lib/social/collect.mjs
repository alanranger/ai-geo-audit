/**
 * Meta collector (Facebook Page + linked Instagram business account), read-only, run nightly and on demand.
 * Each step reads first and writes only after every read in it succeeded, and merges with what is stored so a missing
 * figure never overwrites a good one (upsert only, never delete). No connection = nothing read, nothing written.
 * Token health is checked on every run; a rejected token marks the connection "expired" and stops the run.
 */
import { decryptToken } from './crypto.mjs';
import { GraphError, graphGet, insightsWithFallback, metaConfig, pagedList, tokenHealth } from './meta.mjs';

const DAY = 864e5;
export const POST_DAYS = 90;
export const STEPS = [
  { id: 'health', label: 'Checking the Meta connection' },
  { id: 'facebook_account', label: 'Facebook Page followers and reach' },
  { id: 'facebook_posts', label: 'Facebook posts (last 90 days)' },
  { id: 'instagram_account', label: 'Instagram followers and reach' },
  { id: 'instagram_media', label: 'Instagram posts (last 90 days)' }
];
const DAILY_FIELDS = ['followers', 'reach', 'impressions', 'reactions', 'comments', 'shares', 'posts'];
const POST_FIELDS = ['title', 'permalink', 'media_type', 'reach', 'impressions', 'likes', 'comments', 'shares', 'saves'];

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
const unix = (ms) => Math.floor(ms / 1000);
const firstLine = (t) => (t ? String(t).split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 140) || null : null);
const int = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v))));

/** A stored figure survives when the new read has nothing for it. Every row carries every column (uniform upsert). */
export function keepGood(existing, incoming, keyOf, fields) {
  const old = new Map((existing || []).map((r) => [keyOf(r), r]));
  return incoming.map((r) => {
    const o = old.get(keyOf(r)) || {};
    const out = { ...r };
    for (const f of fields) out[f] = r[f] ?? o[f] ?? null;
    return out;
  });
}

export function metricValue(item) {
  const v = item?.values?.[0]?.value ?? item?.total_value?.value;
  return int(v);
}
const metricOf = (ins, name) => (ins?.data || []).find((d) => d.name === name);

/** Daily insights → { date: { field: value } }; Meta's end_time is the end of the day it measures. */
export function dailyFromInsights(channel, ins, fieldByIndex, nowIso) {
  const byDate = new Map();
  (ins?.data || []).forEach((m) => {
    const field = fieldByIndex[ins.metrics.indexOf(m.name)];
    if (!field) return;
    (m.values || []).forEach((v) => {
      const date = isoDate(Date.parse(v.end_time) - DAY);
      byDate.set(date, { ...(byDate.get(date) || { channel, date, period_days: 1, source: 'api', collected_at: nowIso }), [field]: int(v.value) });
    });
  });
  return [...byDate.values()];
}

async function saveDaily(ctx, channel, rows) {
  const since = rows.map((r) => r.date).sort()[0];
  const existing = since ? await ctx.repo.readDaily([channel], since) : [];
  const merged = keepGood(existing, rows, (r) => `${r.channel}|${r.date}`, DAILY_FIELDS);
  await ctx.repo.upsertDaily(merged);
  return merged.length;
}
async function savePosts(ctx, channel, rows) {
  const since = rows.map((r) => r.posted_at).sort()[0];
  const existing = since ? await ctx.repo.readPosts([channel], since) : [];
  const merged = keepGood(existing, rows, (r) => `${r.channel}|${r.post_id}`, POST_FIELDS);
  await ctx.repo.upsertPosts(merged);
  return merged.length;
}
const todayRow = (ctx, channel, followers) => ({ channel, date: isoDate(ctx.now), followers: int(followers), period_days: 1, source: 'api', collected_at: ctx.nowIso });
function withToday(rows, today) {
  const hit = rows.find((r) => r.date === today.date);
  if (hit) { hit.followers = today.followers; return rows; }
  return [...rows, today];
}

async function chunked(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/* ---------- steps ---------- */

async function health(ctx) {
  const h = await tokenHealth(ctx.cfg, ctx.token, ctx.fetchImpl);
  if (!h.valid) throw new GraphError(190, 0, 'token not valid');
  await ctx.repo.updateConnection({ expires_at: h.expires_at });
  return 0;
}

async function facebookAccount(ctx) {
  const id = ctx.conn.page_id;
  const page = await graphGet(ctx.cfg, id, { fields: 'followers_count,fan_count' }, ctx.opts);
  const ins = await insightsWithFallback(ctx.cfg, id, [['page_impressions_unique', 'page_impressions'], ['page_total_media_view_unique', 'page_media_view']], { period: 'day', since: unix(ctx.now - 56 * DAY), until: unix(ctx.now) }, ctx.opts);
  const rows = dailyFromInsights('facebook', ins, ['reach', 'impressions'], ctx.nowIso);
  return saveDaily(ctx, 'facebook', withToday(rows, todayRow(ctx, 'facebook', page.followers_count ?? page.fan_count)));
}

async function postInsights(ctx, id, sets) {
  const ins = await insightsWithFallback(ctx.cfg, id, sets, {}, ctx.opts);
  const get = (i) => (ins && ins.metrics[i] ? metricValue(metricOf(ins, ins.metrics[i])) : null);
  return { ins, get };
}

async function facebookPosts(ctx) {
  const fields = 'id,created_time,message,permalink_url,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)';
  const posts = await pagedList(ctx.cfg, `${ctx.conn.page_id}/posts`, { fields, since: unix(ctx.now - POST_DAYS * DAY), limit: 50 }, ctx.opts, { max: 150 });
  const rows = await chunked(posts, 5, async (p) => {
    const { get } = await postInsights(ctx, p.id, [['post_impressions_unique', 'post_impressions'], ['post_total_media_view_unique', 'post_media_view']]);
    return {
      channel: 'facebook', post_id: p.id, posted_at: p.created_time, title: firstLine(p.message), permalink: p.permalink_url || null, media_type: null,
      reach: get(0), impressions: get(1), likes: int(p.reactions?.summary?.total_count), comments: int(p.comments?.summary?.total_count),
      shares: int(p.shares?.count ?? 0), saves: null, source: 'api', collected_at: ctx.nowIso
    };
  });
  return savePosts(ctx, 'facebook', rows);
}

async function instagramAccount(ctx) {
  const id = ctx.conn.ig_user_id;
  if (!id) return 0;
  const ig = await graphGet(ctx.cfg, id, { fields: 'username,followers_count,media_count' }, ctx.opts);
  const windows = [[56, 28], [28, 0]].map(([a, b]) => ({ period: 'day', since: unix(ctx.now - a * DAY), until: unix(ctx.now - b * DAY) }));
  const parts = await Promise.all(windows.map((w) => insightsWithFallback(ctx.cfg, id, [['reach']], w, ctx.opts)));
  const rows = parts.flatMap((ins) => dailyFromInsights('instagram', ins, ['reach'], ctx.nowIso));
  return saveDaily(ctx, 'instagram', withToday(rows, todayRow(ctx, 'instagram', ig.followers_count)));
}

async function instagramMedia(ctx) {
  const id = ctx.conn.ig_user_id;
  if (!id) return 0;
  const cutoff = ctx.now - POST_DAYS * DAY;
  const media = await pagedList(ctx.cfg, `${id}/media`, { fields: 'id,caption,timestamp,permalink,media_type,like_count,comments_count', limit: 50 }, ctx.opts, { stop: (m) => Date.parse(m.timestamp) < cutoff, max: 150 });
  const rows = await chunked(media, 5, async (m) => {
    const { ins } = await postInsights(ctx, m.id, [['reach', 'saved', 'shares'], ['reach', 'saved'], ['reach']]);
    const v = (name) => metricValue(metricOf(ins, name));
    return {
      channel: 'instagram', post_id: m.id, posted_at: m.timestamp, title: firstLine(m.caption), permalink: m.permalink || null, media_type: m.media_type || null,
      reach: v('reach'), impressions: null, likes: int(m.like_count), comments: int(m.comments_count), shares: v('shares'), saves: v('saved'), source: 'api', collected_at: ctx.nowIso
    };
  });
  return savePosts(ctx, 'instagram', rows);
}

const STEP_FN = { health, facebook_account: facebookAccount, facebook_posts: facebookPosts, instagram_account: instagramAccount, instagram_media: instagramMedia };

async function recordFailure(repo, e, nowIso) {
  const expired = e instanceof GraphError && e.tokenProblem;
  const code = e?.code ? String(e.code) : 'error';
  await repo.updateConnection(expired ? { status: 'expired', last_checked_at: nowIso, last_error: 'token_expired' } : { last_checked_at: nowIso, last_error: `read_failed:${code}` }).catch(() => {});
  return { expired, error: expired ? 'token_expired' : `read_failed:${code}` };
}

/** One step. Not connected → { skipped: 'not_connected' } with nothing read or written. */
export async function runStep(step, { repo, env = process.env, fetchImpl = fetch, now = Date.now() }) {
  if (!STEP_FN[step]) return { ok: false, step, error: 'unknown_step' };
  const conn = await repo.getConnection();
  if (!conn) return { ok: true, step, skipped: 'not_connected', rows: 0 };
  const nowIso = new Date(now).toISOString();
  try {
    const cfg = metaConfig(env);
    const ctx = { cfg, conn, repo, fetchImpl, now, nowIso, token: decryptToken(conn.token_encrypted, env) };
    ctx.opts = { token: ctx.token, fetchImpl };
    const rows = await STEP_FN[step](ctx);
    await repo.updateConnection({ status: 'connected', last_checked_at: nowIso, last_error: null, ...(step === 'health' ? {} : { last_collected_at: nowIso }) });
    return { ok: true, step, rows };
  } catch (e) {
    console.error(`[social-collect] ${step} failed: ${e?.code || 'error'}`);
    return { ok: false, step, ...(await recordFailure(repo, e, nowIso)) };
  }
}

/** Nightly / "all": every step in order; a failed health check stops the run before any read. */
export async function runAll(deps) {
  const results = [];
  for (const s of STEPS) {
    const r = await runStep(s.id, deps);
    results.push(r);
    if (r.skipped || (!r.ok && (s.id === 'health' || r.expired))) break;
  }
  const skipped = results[0]?.skipped || null;
  return { ok: results.every((r) => r.ok), skipped, rows: results.reduce((t, r) => t + (r.rows || 0), 0), results };
}
