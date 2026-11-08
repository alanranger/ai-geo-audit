/**
 * LinkedIn (personal profile) has no analytics API: Alan types the week's figures in (admin key). One entry = one
 * social_account_daily row (channel linkedin, date = week ending, period_days 7, source manual) plus one social_posts
 * row per post typed in. Upsert only: re-entering the same week corrects it, nothing is deleted.
 */
const NUM_FIELDS = { followers: 'followers', impressions_7d: 'impressions', reactions: 'reactions', comments: 'comments', reposts: 'shares' };
const POST_NUMS = { impressions: 'impressions', reactions: 'likes', comments: 'comments', reposts: 'shares' };
const MAX_POSTS = 20;

function count(v, label) {
  if (v === undefined || v === null || v === '') return { value: null };
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 10_000_000) return { error: `${label} must be a whole number of 0 or more` };
  return { value: n };
}

function validDay(s, todayIso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) return 'a date (YYYY-MM-DD) is required';
  return s > todayIso ? 'the date cannot be in the future' : null;
}

const slug = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'post';

function numbers(src, map, prefix) {
  const out = {};
  for (const [inKey, col] of Object.entries(map)) {
    const r = count(src?.[inKey], `${prefix}${inKey.replace(/_/g, ' ')}`);
    if (r.error) return { error: r.error };
    out[col] = r.value;
  }
  return { out };
}

function postRow(p, i, nowIso, todayIso) {
  const dateErr = validDay(p?.posted_on, todayIso);
  if (dateErr) return { error: `post ${i + 1}: ${dateErr}` };
  const title = String(p?.title || '').trim().slice(0, 140);
  if (!title) return { error: `post ${i + 1}: a title / first line is required` };
  const nums = numbers(p, POST_NUMS, `post ${i + 1}: `);
  if (nums.error) return { error: nums.error };
  return { row: { channel: 'linkedin', post_id: `manual:${p.posted_on}:${slug(title)}`, posted_at: `${p.posted_on}T12:00:00Z`, title, permalink: null, media_type: null, reach: null, saves: null, ...nums.out, source: 'manual', collected_at: nowIso } };
}

/** → { daily, posts } rows or { error }. At least one account figure is required. */
export function linkedinRows(body, { now = Date.now(), by = 'admin' } = {}) {
  const nowIso = new Date(now).toISOString();
  const todayIso = nowIso.slice(0, 10);
  const dateErr = validDay(body?.week_ending, todayIso);
  if (dateErr) return { error: `week ending: ${dateErr}` };
  const nums = numbers(body, NUM_FIELDS, '');
  if (nums.error) return { error: nums.error };
  if (Object.values(nums.out).every((v) => v == null)) return { error: 'enter at least followers or impressions' };
  const list = Array.isArray(body?.posts) ? body.posts.filter((p) => p && (p.title || p.posted_on)) : [];
  if (list.length > MAX_POSTS) return { error: `at most ${MAX_POSTS} posts per entry` };
  const posts = [];
  for (let i = 0; i < list.length; i += 1) {
    const r = postRow(list[i], i, nowIso, todayIso);
    if (r.error) return { error: r.error };
    posts.push(r.row);
  }
  const daily = { channel: 'linkedin', date: body.week_ending, ...nums.out, posts: list.length ? list.length : null, period_days: 7, source: 'manual', entered_by: by, collected_at: nowIso };
  return { daily, posts };
}

export async function saveLinkedinEntry(repo, body, opts) {
  const r = linkedinRows(body, opts);
  if (r.error) return { ok: false, error: r.error };
  await repo.upsertDaily([r.daily]);
  if (r.posts.length) await repo.upsertPosts(r.posts);
  return { ok: true, daily_rows: 1, post_rows: r.posts.length, week_ending: r.daily.date };
}
