/**
 * Marketing & Campaigns → "Results": one row per email or post that ACTUALLY went out (provider evidence only),
 * newest first. Read-only; nothing is written. Counts and list names only: no member lists, no names.
 * Emails: campaign records sent with evidence (strategy_campaigns: linked Squarespace report, schedule evidence or
 *   actual sends; send time = provider send time / scheduled_for) + collected Squarespace campaigns no record links.
 * Posts: collected social_posts + GPT's evidenced step ticks (lib/social/evidence.mjs), one row per post: the same
 *   step's Facebook / Instagram / Story placements (or same day + same first line) are grouped.
 * Unknown stays unknown (null), never 0: opens not collected yet, Stories (not collected), LinkedIn until GPT's entry.
 */
import { evidencedRows, igCode, liActivity } from '../social/evidence.mjs';
import { normalisePost } from '../social/summary.mjs';
import { supabaseRepo } from '../social/repo.mjs';
import { attachBookings } from './results-bookings.mjs';
import { status, ukDayTime } from './delivery-status.mjs';

const PROP = 'https://www.alanranger.com';
const DAY = 864e5;
const SENT = ['sent', 'measured'];
/** A record still at "scheduled" joins Results only when its Squarespace Sent report is collected (matched by provider id). */
const STAGES = [...SENT, 'scheduled'];
const SQS = 'https://alan-ranger.squarespace.com/config/marketing/campaigns/composer/';
const CH_ORDER = { email: 0, facebook: 1, instagram: 2, story: 3, linkedin: 4 };
const LEAD = /^(Post|Personal note to past clients|Main email of the week|Lightroom targeted email|Google Business update)\s*:\s*/i;

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data || [];
};

/** Title cut to at most six words, quotes and "Post:" leads dropped. */
export function shortWhat(t) {
  const s = String(t || '').replace(LEAD, '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
  const words = s.split(' ').filter(Boolean);
  return words.length > 6 ? `${words.slice(0, 6).join(' ')}…` : s;
}

/* ---------- emails ---------- */

/** Provider evidence for a sent record: the collected report, a schedule confirmation or the actual sends. */
const hasEvidence = (r) => !!(r.sqs_email_id || r.schedule_evidence || r.actual_sends != null);
const sentAtOf = (r, sqs) => (sqs?.sent_at || r.scheduled_for || (r.sent_on ? `${r.sent_on}T12:00:00Z` : null));

/** A sent email: opens "collected {date}" once the report is read, else "collecting" (never a future promise). */
function opensOf(sqs) {
  const known = sqs && (sqs.events_collected_at || Number(sqs.opened) > 0);
  if (!known) return { opened: null, clicked: null, opens_state: 'collecting', opens_at: null };
  return { opened: sqs.opened ?? null, clicked: sqs.clicked ?? null, opens_state: 'collected', opens_at: sqs.events_collected_at || sqs.collected_at || null };
}

/**
 * The shared delivery status (lib/marketing/delivery-status.mjs): Sent only from Squarespace's collected Sent list,
 * with its actual time and link; a record with schedule evidence but no Sent report yet is "Checking delivery".
 */
export function emailStatusOf(c, r = {}) {
  if (c?.email_id) return status('sent', { at: c.sent_at, when: `Sent ${ukDayTime(c.sent_at)}`, link: `${SQS}${c.email_id}`, evidence: 'Squarespace Sent list (collector)' });
  const at = r.scheduled_for || null;
  return status('checking', { at, when: at ? `Due ${ukDayTime(at)}` : null, evidence: 'marked sent on the record; waiting for the Sent list to confirm it' });
}

function emailEvidence(r, sqs) {
  const out = [];
  if (sqs) out.push(`Squarespace campaign report collected: ${sqs.delivered ?? sqs.message_count ?? '—'} delivered`);
  if (r?.schedule_evidence) out.push(`Squarespace schedule ${String(r.schedule_evidence).replace('_', '-')}${r.scheduled_for ? ` for ${r.scheduled_for}` : ''}`);
  if (r?.actual_sends != null) out.push(`Actual sends recorded on the campaign record: ${r.actual_sends}`);
  return out;
}

const firstOf = (...v) => v.find((x) => x != null && x !== '') ?? null;
const sentToOf = (r, c) => firstOf(c.delivered, r.actual_sends, c.message_count, r.scheduled_recipients);
const listsOf = (r, c) => [c.mailing_list_names, r.sent_lists].find(Array.isArray) || [];
/** An event campaign record's own event link(s) (server-side only; dropped before the response). */
const eventKeysOf = (r) => [...new Set([r.event_key, ...(r.event_keys || [])].filter(Boolean))];

export function emailRow(rec, sqs, now) {
  const r = rec || {};
  const c = sqs || {};
  const sentAt = sentAtOf(r, sqs);
  const subject = firstOf(c.subject, r.title);
  return {
    id: `email|${firstOf(c.email_id, r.campaign_key)}`, kind: 'email', sent_at: sentAt, title: firstOf(c.subject, r.title) || 'Email',
    what: shortWhat(subject), channels: [{ ch: 'email' }], campaign_key: firstOf(r.campaign_key, c.campaign_key), step_keys: [],
    provider_id: c.email_id || null, plan: rec && sqs && r.title && r.title !== c.subject ? r.title : null,
    event_keys: eventKeysOf(r), event_title: r.title || null,
    sent_to: sentToOf(r, c), ...opensOf(sqs), reactions: null, status: emailStatusOf(sqs, r),
    audience: { lists: listsOf(r, c), count: firstOf(c.delivered, r.actual_sends) },
    copy: subject || '', evidence: emailEvidence(rec, sqs)
  };
}

async function loadEmails(sb, sinceIso, now) {
  const since = sinceIso.slice(0, 10);
  const recs = must(await sb.from('strategy_campaigns')
    .select('campaign_key, title, stage, sent_on, scheduled_for, scheduled_recipients, actual_sends, sqs_email_id, sqs_draft_id, schedule_evidence, event_key, event_keys, sent_lists:sent_audience->list_names')
    .eq('property_url', PROP).in('stage', STAGES).or(`sent_on.gte.${since},scheduled_for.gte.${sinceIso}`).limit(300), 'strategy_campaigns');
  const sqs = must(await sb.from('sqs_email_campaigns').select('email_id, subject, sent_on, message_count, delivered, opened, clicked, mailing_list_names, campaign_key, collected_at, events_collected_at')
    .gte('sent_on', sinceIso).order('sent_on', { ascending: false }).limit(200), 'sqs_email_campaigns').map((c) => ({ ...c, sent_at: c.sent_on }));
  return emailRows(recs, sqs, now);
}

/** The same send without a stored link: within 15 minutes of the record's send time and within 2% of its recipients. */
function sameSend(r, sqs, used) {
  const at = Date.parse(r.scheduled_for || '');
  const n = Number(r.actual_sends ?? r.scheduled_recipients);
  if (!at || !n) return null;
  return sqs.find((c) => !used.has(c.email_id) && Math.abs(Date.parse(c.sent_at) - at) <= 15 * 60e3 && Math.abs(Number(c.delivered ?? c.message_count) - n) <= Math.max(2, n * 0.02)) || null;
}
/**
 * One row per actual send, keyed by the provider id: a record joins its collected report by sqs_email_id, then by the
 * Squarespace draft id (the same id once sent), then by campaign key, then by the same send time and size. The plan
 * title stays as detail; a stale plan row never becomes a second delivery. Unlinked collected reports are their own rows.
 */
export function emailRows(recs, sqs, now) {
  const byId = new Map(sqs.map((c) => [c.email_id, c]));
  const byKey = new Map(sqs.filter((c) => c.campaign_key).map((c) => [c.campaign_key, c]));
  const used = new Set();
  const rows = recs.filter(hasEvidence).map((r) => {
    const c = byId.get(r.sqs_email_id) || byId.get(r.sqs_draft_id) || byKey.get(r.campaign_key) || sameSend(r, sqs, used);
    if (!c && r.stage === 'scheduled') return null;
    if (c) used.add(c.email_id);
    return emailRow(r, c || null, now);
  }).filter(Boolean);
  return [...rows, ...sqs.filter((c) => !used.has(c.email_id)).map((c) => emailRow(null, c, now))];
}

/* ---------- posts ---------- */

const chOf = (p) => (p.placement === 'story' ? 'story' : p.channel);
const firstLine = (s) => String(s || '').trim().toLowerCase().slice(0, 40);
const groupKey = (p) => (p.step_key ? `step|${p.step_key}` : `${String(p.posted_at).slice(0, 10)}|${firstLine(p.title)}`);

function channelCell(p) {
  return { ch: chOf(p), reach: p.reach ?? null, reach_label: p.reach_label || 'reach', likes: p.likes ?? null, comments: p.comments ?? null, url: p.provider_url || p.permalink || null, matched: p.source !== 'evidence' };
}

const URL_RE = /https?:\/\/\S+/gi;
export const youtubeId = (s) => String(s || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([A-Za-z0-9_-]{11})/)?.[1] || null;
/** A post's title, never a URL: the step title, else the linked video's title, else the first line with text. */
export function titleOf(lead, ytTitles = new Map()) {
  if (lead.step_title) return lead.step_title;
  const yt = ytTitles.get(youtubeId(lead.title));
  if (yt) return yt;
  const line = String(lead.title || '').split(/\n/).map((l) => l.replace(URL_RE, '').trim()).find(Boolean);
  if (line) return line;
  if (youtubeId(lead.title)) return 'YouTube video';
  return String(lead.title || '').trim() ? 'Link post' : 'Post (no caption)';
}

/** A post in Results is published (collected from the platform, or GPT's recorded live check), with its own link. */
export function postStatusOf(list, at) {
  const link = list.map((p) => p.provider_url || p.permalink).find(Boolean) || null;
  const collected = list.some((p) => p.source !== 'evidence');
  return status('published', { at, when: at ? `Published ${ukDayTime(at)}` : 'Published', link, evidence: collected ? 'collected from the platform' : (list.find((p) => p.evidence)?.evidence || 'recorded publication') });
}

function postRow(list, ytTitles) {
  const lead = list.find((p) => p.step_title) || list[0];
  const at = list.map((p) => p.posted_at).filter(Boolean).sort().slice(-1)[0] || null;
  const channels = list.map(channelCell).sort((a, b) => CH_ORDER[a.ch] - CH_ORDER[b.ch]);
  const title = titleOf(lead, ytTitles);
  return {
    id: `post|${groupKey(lead)}`, kind: 'social', sent_at: at, title, what: shortWhat(title),
    channels, campaign_key: null, step_keys: [...new Set(list.map((p) => p.step_key).filter(Boolean))],
    sent_to: null, opened: null, clicked: null, opens_state: 'na', reactions: null, status: postStatusOf(list, at),
    audience: { lists: [], count: null, note: 'Followers of each channel (organic post)' },
    copy: list.find((p) => p.source !== 'evidence')?.title || lead.title || '',
    evidence: list.map((p) => `${chOf(p)}: ${p.evidence || (p.permalink ? `collected from the platform (${p.permalink})` : 'collected from the platform')}`)
  };
}

/** Evidenced placements + collected posts they don't replace → one row per post. */
export function postRows(posts, evidenced, ytTitles = new Map()) {
  const listed = [...posts.filter((p) => !evidenced.replaced.has(`${p.channel}|${p.post_id}`)), ...evidenced.rows];
  const igByDay = new Map(listed.filter((p) => p.step_key && p.channel === 'instagram').map((p) => [`${String(p.posted_at).slice(0, 10)}|${firstLine(p.title)}`, p.step_key]));
  const groups = new Map();
  for (const p of listed) {
    const k = p.step_key ? `step|${p.step_key}` : (igByDay.has(groupKey(p)) ? `step|${igByDay.get(groupKey(p))}` : groupKey(p));
    groups.set(k, [...(groups.get(k) || []), p]);
  }
  return [...groups.values()].map((list) => postRow(list, ytTitles));
}

/** YouTube titles for posts whose text is only a video link (youtube_video_stats, latest capture). */
async function videoTitles(sb, posts) {
  const ids = [...new Set(posts.map((p) => youtubeId(p.title)).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = must(await sb.from('youtube_video_stats').select('video_id, title, captured_date').in('video_id', ids).order('captured_date', { ascending: false }).limit(ids.length * 10), 'youtube_video_stats');
  return new Map(rows.filter((r) => r.title).reverse().map((r) => [r.video_id, r.title]));
}

const PLACEMENT = { linkedin_feed: ['linkedin', 'feed'], facebook_feed: ['facebook', 'feed'], instagram_feed: ['instagram', 'feed'], instagram_story: ['instagram', 'story'] };
const sameUrl = (post, url) => (post.channel === 'linkedin' ? !!liActivity(url) && liActivity(post.permalink) === liActivity(url) : !!igCode(url) && igCode(post.permalink) === igCode(url));
/**
 * Placements GPT recorded as published (provider id / URL in marketing_social_placements) that no tick evidence
 * already covers: joined to the collected post by its permalink when there is one, else shown from the placement.
 */
export function placementRows(placements, posts, evidenced, steps) {
  const have = new Set(evidenced.rows.map((r) => `${r.step_key}|${r.channel}|${r.placement}`));
  const stepBy = new Map(steps.map((s) => [s.step_key, s.step]));
  const out = [];
  for (const p of placements) {
    const [channel, placement] = PLACEMENT[p.placement] || [];
    if (!channel || have.has(`${p.step_key}|${channel}|${placement}`)) continue;
    const post = placement === 'feed' ? posts.find((x) => x.channel === channel && sameUrl(x, p.provider_url)) : null;
    if (post) evidenced.replaced.add(`${post.channel}|${post.post_id}`);
    const shell = { channel, post_id: `placement:${p.step_key}:${p.placement}`, posted_at: p.actual_at, title: p.public_caption || '', permalink: p.provider_url, source: 'evidence', reach: null, likes: null, comments: null };
    out.push({ ...(post || shell), placement, step_key: p.step_key, step_title: stepBy.get(p.step_key) || null, provider_url: p.provider_url, evidence: `published${p.provider_id ? ' (provider id recorded)' : ''} ${p.actual_at || ''}`.trim() });
  }
  return out;
}

async function publishedPlacements(sb, sinceIso) {
  const { data, error } = await sb.from('marketing_social_placements').select('step_key, placement, provider_id, provider_url, actual_at, public_caption')
    .eq('property_url', PROP).gte('actual_at', sinceIso).or('provider_id.not.is.null,provider_url.not.is.null').limit(500);
  if (error) throw new Error(`marketing_social_placements: ${error.message}`);
  return data || [];
}

async function loadPosts(sb, sinceIso) {
  const repo = supabaseRepo(sb);
  const posts = (await repo.readPosts(['facebook', 'instagram', 'linkedin'], sinceIso)).map(normalisePost);
  const ticks = (await repo.readEvidence(sinceIso)).filter((t) => /\|(Facebook|Instagram|LinkedIn)/i.test(t.tick_key));
  const placed = await publishedPlacements(sb, sinceIso);
  const bases = [...new Set([...ticks.map((t) => t.tick_key.replace(/\|(fb|ig)$/, '')), ...placed.map((p) => p.step_key)])];
  const [steps, tags] = await Promise.all([repo.readSteps(bases), repo.readDeliveryPurposes([...bases, ...ticks.map((t) => t.tick_key)])]);
  const evidenced = evidencedRows({ ticks, steps, tags, posts });
  evidenced.rows.push(...placementRows(placed, posts, evidenced, steps));
  return postRows(posts, evidenced, await videoTitles(sb, posts));
}

/* ---------- everything ---------- */

export async function buildMarketingResults(sb, { days = 30, now = Date.now() } = {}) {
  const sinceIso = new Date(now - Math.min(Math.max(Number(days) || 30, 1), 120) * DAY).toISOString();
  const [emails, posts] = await Promise.all([loadEmails(sb, sinceIso, now), loadPosts(sb, sinceIso)]);
  const rows = [...emails, ...posts].filter((r) => r.sent_at && Date.parse(r.sent_at) >= Date.parse(sinceIso))
    .map((r) => ({ ...r, sent_at: new Date(r.sent_at).toISOString() })).sort((a, b) => b.sent_at.localeCompare(a.sent_at));
  return { as_of: new Date(now).toISOString(), since: sinceIso, rows: await attachBookings(sb, rows, sinceIso) };
}
