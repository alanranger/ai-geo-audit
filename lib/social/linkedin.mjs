/**
 * LinkedIn (personal profile) has no analytics API. The week's figures are typed in by Alan (the "Enter this week"
 * form, source = manual) or sent by GPT through the API (source = gpt), on the same write path:
 * one social_account_daily row (channel linkedin, date = week ending, period_days 7) plus one social_posts row per post
 * (and that post's snapshot for today, for same-age comparison). Upsert only: the same week / the same post
 * (permalink) updates the existing row, never duplicates; nothing is deleted. Nothing reads from or posts to LinkedIn.
 */
const NUM_FIELDS = { followers: 'followers', impressions_7d: 'impressions', reactions: 'reactions', comments: 'comments', reposts: 'shares' };
const POST_NUMS = { impressions: 'impressions', reactions: 'likes', comments: 'comments', reposts: 'shares' };
const MAX_POSTS = 20;
export const SOURCES = ['manual', 'gpt'];

/** Whole numbers ≥ 0 only: a number, or a string of digits. Booleans, "12abc", -3 and 1.5 are refused. */
function count(v, label) {
  if (v === undefined || v === null || v === '') return { value: null };
  const ok = (typeof v === 'number' && Number.isInteger(v)) || (typeof v === 'string' && /^\d+$/.test(v.trim()));
  const n = Number(v);
  if (!ok || n < 0 || n > 10_000_000) return { error: `${label} must be a whole number of 0 or more` };
  return { value: n };
}

function validDay(s, todayIso) {
  const d = String(s || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) return 'a date (YYYY-MM-DD) is required';
  return d > todayIso ? 'the date cannot be in the future' : null;
}

const slug = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'post';
/** One post = one row: the LinkedIn activity id when the permalink has one, else the cleaned permalink. */
export function linkedinPostId(permalink) {
  const s = String(permalink || '').trim();
  const urn = s.match(/(?:activity|share|ugcPost)[:-](\d{10,})/i);
  if (urn) return `li:${urn[1]}`;
  return `li:${s.replace(/^https?:\/\/(www\.)?/i, '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase()}`;
}
const validLink = (s) => /^https:\/\/(www\.)?linkedin\.com\/\S+$/i.test(String(s || '').trim());

function numbers(src, map, prefix) {
  const out = {};
  for (const [inKey, col] of Object.entries(map)) {
    const r = count(src?.[inKey], `${prefix}${inKey.replace(/_/g, ' ')}`);
    if (r.error) return { error: r.error };
    out[col] = r.value;
  }
  return { out };
}

/** Impressions must cover the reactions and comments counted on them. */
function impressionsCover(o, prefix) {
  if (o.impressions == null || (o.reactions ?? o.likes) == null || o.comments == null) return null;
  return o.impressions < (o.reactions ?? o.likes) + o.comments ? `${prefix}impressions must be at least reactions + comments` : null;
}

function postIdentity(p, i, source) {
  if (p?.permalink && !validLink(p.permalink)) return { error: `post ${i + 1}: permalink must be a https://www.linkedin.com/… link` };
  if (source === 'gpt' && !p?.permalink) return { error: `post ${i + 1}: permalink is required (it identifies the post)` };
  return { link: p?.permalink ? String(p.permalink).trim() : null };
}

function postRow(p, i, ctx) {
  const when = p?.posted_at ?? p?.posted_on;
  const dateErr = validDay(when, ctx.todayIso);
  if (dateErr) return { error: `post ${i + 1}: ${dateErr}` };
  const title = String(p?.title || '').trim().slice(0, 140);
  if (!title) return { error: `post ${i + 1}: a title / first line is required` };
  const id = postIdentity(p, i, ctx.source);
  if (id.error) return id;
  const nums = numbers(p, POST_NUMS, `post ${i + 1}: `);
  if (nums.error) return { error: nums.error };
  const cover = impressionsCover(nums.out, `post ${i + 1}: `);
  if (cover) return { error: cover };
  const day = String(when).slice(0, 10);
  const postedAt = /T\d{2}:\d{2}/.test(String(when)) && !Number.isNaN(Date.parse(when)) ? new Date(when).toISOString() : `${day}T12:00:00Z`;
  return { row: { channel: 'linkedin', post_id: id.link ? linkedinPostId(id.link) : `manual:${day}:${slug(title)}`, posted_at: postedAt, title, permalink: id.link, media_type: null, reach: null, saves: null, ...nums.out, source: ctx.source, entered_by: ctx.by, collected_at: ctx.nowIso } };
}

function accountRow(body, ctx) {
  const dateErr = validDay(body?.week_ending, ctx.todayIso);
  if (dateErr) return { error: `week ending: ${dateErr}` };
  const nums = numbers(body, NUM_FIELDS, '');
  if (nums.error) return { error: nums.error };
  const nl = newsletterFields(body?.newsletter, ctx);
  if (nl.error) return nl;
  if (Object.values(nums.out).every((v) => v == null) && !nl.out) return { error: 'enter at least followers or impressions' };
  const cover = impressionsCover(nums.out, '7-day ');
  if (cover) return { error: cover };
  return { row: { channel: 'linkedin', date: String(body.week_ending).slice(0, 10), ...nums.out, ...(nl.out || {}), period_days: 7, source: ctx.source, entered_by: ctx.by, collected_at: ctx.nowIso } };
}

/**
 * Optional Light & Logic newsletter figures (own columns, never mixed with profile / post figures). Only written when
 * supplied, so an entry without `newsletter` keeps what is stored for that week.
 */
const NL_NUMS = { subscribers: 'newsletter_subscribers', issue_views: 'newsletter_issue_views' };
function newsletterFields(nl, ctx) {
  if (nl == null) return { out: null };
  if (typeof nl !== 'object' || Array.isArray(nl)) return { error: 'newsletter must be an object' };
  const nums = numbers(nl, NL_NUMS, 'newsletter ');
  if (nums.error) return { error: nums.error };
  const out = { ...nums.out, newsletter_issue_date: null, newsletter_issue_url: null };
  if (nl.issue_date != null && nl.issue_date !== '') {
    const err = validDay(nl.issue_date, ctx.todayIso);
    if (err) return { error: `newsletter issue date: ${err}` };
    out.newsletter_issue_date = String(nl.issue_date).slice(0, 10);
  }
  if (nl.issue_url != null && nl.issue_url !== '') {
    if (!validLink(nl.issue_url)) return { error: 'newsletter issue_url must be a https://www.linkedin.com/… link' };
    out.newsletter_issue_url = String(nl.issue_url).trim();
  }
  return Object.values(out).every((v) => v == null) ? { out: null } : { out };
}

/** → { daily, posts } or { error }. */
export function linkedinRows(body, { now = Date.now(), by = 'admin', source = 'manual' } = {}) {
  if (!SOURCES.includes(source)) return { error: 'unknown source' };
  const nowIso = new Date(now).toISOString();
  const ctx = { nowIso, todayIso: nowIso.slice(0, 10), source, by: String(by || source).slice(0, 60) };
  const acc = accountRow(body, ctx);
  if (acc.error) return acc;
  const p = postRows(body, ctx);
  if (p.error) return p;
  return { daily: { ...acc.row, posts: p.posts.length || null }, posts: p.posts, todayIso: ctx.todayIso };
}

function postRows(body, ctx) {
  const list = Array.isArray(body?.posts) ? body.posts.filter((p) => p && (p.title || p.posted_on || p.posted_at || p.permalink)) : [];
  if (list.length > MAX_POSTS) return { error: `at most ${MAX_POSTS} posts per entry` };
  const posts = [];
  for (let i = 0; i < list.length; i += 1) {
    const r = postRow(list[i], i, ctx);
    if (r.error) return { error: r.error };
    posts.push(r.row);
  }
  if (new Set(posts.map((x) => x.post_id)).size !== posts.length) return { error: 'the same post appears twice in this entry' };
  return { posts };
}

const snapshot = (r, day) => ({ channel: r.channel, post_id: r.post_id, captured_date: day, reach: null, impressions: r.impressions, likes: r.likes, comments: r.comments, shares: r.shares, saves: null, source: r.source, collected_at: r.collected_at });

export async function saveLinkedinEntry(repo, body, opts) {
  const r = linkedinRows(body, opts);
  if (r.error) return { ok: false, error: r.error };
  await repo.upsertDaily([r.daily]);
  if (r.posts.length) {
    await repo.upsertPosts(r.posts);
    await repo.upsertSnapshots(r.posts.map((p) => snapshot(p, r.todayIso)));
  }
  return { ok: true, source: r.daily.source, week_ending: r.daily.date, daily_rows: 1, post_rows: r.posts.length, post_ids: r.posts.map((p) => p.post_id) };
}
