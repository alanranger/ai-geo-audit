/**
 * ONE delivery status for every view (schedule List / grids, Results, Waiting, Strategy next action). Pure rules; the
 * server builders attach it (lib/marketing/delivery.mjs for emails, lib/marketing/delivery-status-board.mjs for
 * everything) and the views only render it.
 *
 *   status = { code, label, icon, tone, when, at, link, evidence, blocker, last_verified? }
 *
 * - sent / published: provider-confirmed only (Squarespace Sent list; Meta post; personal LinkedIn = GPT's recorded live
 *   check: provider id + URL + time + screenshot), with the actual time and link.
 * - scheduled: the platform confirmed a future release (collector-read Squarespace schedule, or operator-verified).
 * - needs_approval: only when everything is ready (social: the decision state's release rule — caption, rendered
 *   artwork and URL — and still open; email: a campaign record at "verified").
 * - in_preparation: a draft / plan, one-line blocker, "Planned {time}". Never shown as scheduled.
 * - checking: due but not yet confirmed. Time passing NEVER marks anything sent.
 * - late / failed: only with evidence (e.g. Squarespace still lists it as scheduled an hour after its time).
 * - verification_unavailable: the check that would confirm it failed; the last verified state is kept (last_verified).
 * - cancelled: Squarespace dropped the schedule before its time and it isn't in Sent; or the record was cancelled.
 * - done: a task (Outlook note, Google check) ticked as done.
 * A confirmed send / publication is never downgraded by a later failed check.
 */
export const LONDON = 'Europe/London';
export const CHECK_HOURS = { from: 7, to: 22 };
export const CHECK_EVERY_MIN = 15;
export const RELEASE_CHECK_DELAY_MIN = 10;
export const EMAIL_LATE_AFTER_MIN = 60;
export const SOCIAL_LATE_AFTER_H = 24;
const SQS = 'https://alan-ranger.squarespace.com/config/marketing/campaigns/composer/';

export const STATUS = {
  sent: ['Sent', '✅', 'green'],
  published: ['Published', '✅', 'green'],
  scheduled: ['Scheduled', '🕒', 'blue'],
  needs_approval: ['Needs approval', '⚠', 'amber'],
  in_preparation: ['In preparation', '📄', 'grey'],
  checking: ['Checking delivery', '…', 'neutral'],
  late: ['Late', '⏰', 'red'],
  failed: ['Failed', '✖', 'red'],
  verification_unavailable: ['Verification unavailable', '?', 'neutral'],
  cancelled: ['Cancelled', '⊘', 'grey'],
  done: ['Done', '✓', 'green'],
  due: ['Due', '📋', 'grey'],
  in_progress: ['In progress', '◔', 'blue'],
  checked: ['Checked', '✓', 'green'],
  needs_attention: ['Needs attention', '⚠', 'amber'],
  deferred: ['Deferred', '⏸', 'neutral'],
  waiting_window: ['Ready, waiting for Meta\'s window', '⏳', 'neutral'],
  story_ready: ['Story ready to publish', '📱', 'grey'],
  conditional: ['Conditional', '🔒', 'grey'],
  on_hold: ['On hold (Alan)', '⏸', 'neutral'],
  not_in_scheduled: ['Not in Squarespace Scheduled — check', '⚠', 'red']
};
/**
 * Deliveries Alan has put on hold (no production commitment, no implied promotion); the planned dependency stays
 * visible. Light & Logic: deferred by Alan until the backlog is cleared (GPT post-reboot audit, 9 Nov 2026).
 */
export const HOLDS = [
  { match: /^gpt-ll-newsletter-/, by: 'Alan', at: '2026-11-09', reason: 'deferred until the backlog is cleared', dependency: 'Light & Logic edition and its promotion module in that month\'s email (paused, not removed)' }
];
export const deliveryHoldOf = (stepKey) => HOLDS.find((h) => h.match.test(String(stepKey || ''))) || null;
/** "On hold (Alan)" for a held delivery, else null. Never a production date or a promotion. */
export function onHoldStatus(stepKey) {
  const h = deliveryHoldOf(stepKey);
  return h ? status('on_hold', { when: `On hold since ${ukDay(h.at)}`, blocker: h.reason, evidence: `planned dependency kept: ${h.dependency}` }) : null;
}
/** Who posts the Instagram Stories (GPT, Meta Business Suite > Create story > Edit > More stickers > Link; Alan, 9 Nov). */
export const STORY_OWNER = 'GPT';

const ms = (iso) => (iso ? Date.parse(iso) : NaN);
export const ukTime = (iso) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: LONDON, hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s/g, '').toLowerCase();
export const ukDayTime = (iso) => `${new Date(iso).toLocaleDateString('en-GB', { timeZone: LONDON, weekday: 'short', day: 'numeric', month: 'short' })} ${ukTime(iso)}`;

export function status(code, f = {}) {
  const [label, icon, tone] = STATUS[code];
  return { code, label: f.label || label, icon, tone, when: f.when || null, at: f.at || null, link: f.link || null, evidence: f.evidence || null, blocker: f.blocker || null, ...(f.last_verified ? { last_verified: f.last_verified } : {}) };
}

/* ---------- email (one delivery from lib/marketing/delivery.mjs) ---------- */

const sqsLink = (id) => (id ? `${SQS}${id}` : null);
export const ukDay = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const planned = (iso, day) => (iso ? `Planned ${ukDayTime(iso)}` : (day ? `Planned ${ukDay(day)} (no time yet)` : 'No date yet'));

function emailBlocker(d) {
  if (!d.audience) return d.estimate ? 'audience not chosen (plan estimate only)' : 'audience not chosen';
  if (d.snapshot?.review) return 'awaiting Alan\'s send approval';
  if (!d.snapshot) return 'audience not frozen';
  return 'not scheduled in Squarespace yet';
}

/** Due and not yet in Sent: checking; late only when a fresh read still lists it as scheduled an hour after its time. */
function dueEmail(d, ctx) {
  const at = d.send_at;
  const last = { code: 'scheduled', at, evidence: 'Squarespace Scheduled tab' };
  if (ctx.read?.failed_since_ok) return status('verification_unavailable', { at, when: `Due ${ukDayTime(at)}`, evidence: `latest Squarespace check ${ctx.read.last_status}; last verified ${ctx.read.last_ok_at ? ukDayTime(ctx.read.last_ok_at) : 'never'}`, last_verified: last });
  const stillListed = d.provider?.state === 'scheduled' && ms(d.provider.collected_at) > ms(at) + EMAIL_LATE_AFTER_MIN * 60000;
  if (stillListed) return status('late', { at, when: `Due ${ukDayTime(at)}`, evidence: `Squarespace still listed it as scheduled at ${ukDayTime(d.provider.collected_at)}`, link: sqsLink(d.provider.email_id) });
  const left = d.provider?.state === 'gone' ? ` · left the Scheduled tab ${ukDayTime(d.provider.gone_at)}` : '';
  return status('checking', { at, when: `Due ${ukDayTime(at)}`, evidence: `waiting for Squarespace's Sent list to confirm it${left}`, link: sqsLink(d.provider?.email_id) });
}

const isDue = (iso, now) => !!iso && ms(iso) <= now;

/** A platform schedule (collector-read or operator-verified): scheduled before its time; checking / late after. */
function scheduledEmail(d, ctx, now) {
  if (isDue(d.send_at, now)) return dueEmail(d, ctx);
  const seen = d.provider?.state === 'scheduled';
  return status('scheduled', { at: d.send_at, when: `Scheduled ${ukDayTime(d.send_at)}`, link: sqsLink(d.provider?.email_id), evidence: seen ? 'Squarespace Scheduled tab (collector)' : `operator-verified (${d.operator?.by || 'recorded'})` });
}

/** No platform schedule: approval (record verified), checking (marked sent, not yet in Sent) or in preparation. */
function recordEmail(d, now) {
  if (d.record_stage === 'verified') return status('needs_approval', { at: d.send_at, when: planned(d.send_at, d.send_day), evidence: 'campaign record verified · your approval' });
  const dueAt = d.send_at || (d.send_day ? `${d.send_day}T23:59:00Z` : null);
  if (d.record_stage === 'sent' && isDue(dueAt, now)) return status('checking', { at: d.send_at, evidence: 'marked sent on the record; waiting for the Sent list to confirm it' });
  return status('in_preparation', { at: d.send_at, when: planned(d.send_at, d.send_day), blocker: emailBlocker(d) });
}

/** Marked scheduled, but Squarespace's Scheduled tab doesn't list it (lib/marketing/delivery.mjs notInScheduled). */
function notScheduledStatus(d) {
  const n = d.not_in_scheduled;
  return status('not_in_scheduled', {
    at: n.since, when: d.send_at ? `Was scheduled ${ukDayTime(d.send_at)}` : null, link: sqsLink(d.provider?.email_id),
    blocker: 'counted as a draft (not reserved) until Squarespace lists it again', evidence: `${n.reason} (read ${ukDayTime(n.since)})`
  });
}

export function emailStatus(d, ctx = {}) {
  const now = ctx.now ?? Date.now();
  if (d.sent?.seen) return status('sent', { at: d.sent.at, when: `Sent ${ukDayTime(d.sent.at)}`, link: sqsLink(d.sent.email_id), evidence: 'Squarespace Sent list (collector)' });
  if (d.record_stage === 'cancelled') return status('cancelled', { evidence: 'campaign record cancelled' });
  if (d.not_in_scheduled) return notScheduledStatus(d);
  const p = d.provider;
  if (p?.state === 'gone' && ms(p.gone_at) < ms(p.scheduled_for)) return status('cancelled', { at: p.gone_at, evidence: `Squarespace dropped the schedule ${ukDayTime(p.gone_at)} before its time; not in Sent` });
  return p || d.operator ? scheduledEmail(d, ctx, now) : recordEmail(d, now);
}

/* ---------- social placement (marketing_social_placements) ---------- */

const PUBLISHED_STAGES = new Set(['published', 'live_check', 'live']);
const isLinkedin = (p) => /linkedin/.test(p.placement || '');
const gptLive = (p) => (Array.isArray(p.evidence) ? p.evidence : []).find((e) => e && /live_post_verified|live_check/.test(e.action || '') && e.by);

export function publishedEvidence(p, posts = new Map()) {
  const live = gptLive(p);
  if (live) return `verified by ${live.by} live check ${ukDayTime(live.at || p.actual_at)}${live.screenshot ? ' (screenshot recorded)' : ''}`;
  const seen = p.provider_id ? posts.get(p.provider_id) : null;
  if (seen) return `seen by the Meta collector ${seen.collected_at ? ukDayTime(seen.collected_at) : ''}`.trim();
  return `recorded by ${p.set_by || 'operator'}`;
}
/**
 * Published = provider evidence only (also the decision state's rule): a live stage / state, or a provider ID / post URL.
 * A scheduled post's URL is the scheduler queue, not proof: scheduled ≠ published until its real post is recorded.
 */
export function isPublishedPlacement(p) {
  if (PUBLISHED_STAGES.has(p.stage) || p.platform_state === 'published') return true;
  if (p.platform_state === 'scheduled' || p.stage === 'scheduled') return !!(p.actual_at && p.provider_id);
  return !!(p.provider_id || p.provider_url);
}
const isStory = (p) => p.placement === 'instagram_story';
const editorial = (p) => p.assets?.editorial || {};
const platformOf = (p) => (isLinkedin(p) ? 'LinkedIn' : (/instagram/.test(p.placement || '') ? 'Instagram' : 'Facebook'));
/** GPT's read-back of the post in the platform's own Scheduled queue (the native queues expose no post ID). */
const queueEvidence = (p) => (Array.isArray(p.evidence) ? p.evidence : []).find((e) => e && e.by && /queue/i.test(`${e.source || ''} ${e.text || ''}`));
/** Operator-verified provider scheduling: platform state scheduled + queue read-back evidence + queue URL + a planned time. */
export const operatorScheduled = (p) => p.platform_state === 'scheduled' && !!p.provider_url && !!p.planned_at && !!queueEvidence(p);
const POST_MATCH_MIN = 30;
/** The Meta collector's post on the same channel at the planned time: the provider evidence for a post with no ID. */
export function collectorPost(p, recent = []) {
  if (isLinkedin(p) || isStory(p) || !p.planned_at) return null;
  const ch = /instagram/.test(p.placement || '') ? 'instagram' : 'facebook';
  return recent.find((x) => x.channel === ch && Math.abs(ms(x.posted_at) - ms(p.planned_at)) <= POST_MATCH_MIN * 60000) || null;
}

function dueSocial(p, ctx) {
  const at = p.planned_at;
  const when = `Due ${ukDayTime(at)}`;
  if (isLinkedin(p) || isStory(p)) {
    const late = ctx.now - ms(at) > SOCIAL_LATE_AFTER_H * 3600000;
    const why = isStory(p) ? 'Instagram Stories are not collected: needs GPT\'s recorded live check' : 'personal LinkedIn has no API: needs GPT\'s live check';
    return status(late ? 'late' : 'checking', { at, when, blocker: why, evidence: late ? `no live check recorded ${SOCIAL_LATE_AFTER_H} h after its planned time` : 'waiting for GPT\'s live check' });
  }
  if (ctx.meta && !ctx.meta.ok) return status('verification_unavailable', { at, when, evidence: `Meta check failed (${ctx.meta.error || 'error'}); last verified ${ctx.meta.last_ok_at ? ukDayTime(ctx.meta.last_ok_at) : 'never'}`, last_verified: { code: 'in_preparation', at } });
  const checkedAfter = ctx.meta?.last_ok_at && ms(ctx.meta.last_ok_at) > ms(at) + SOCIAL_LATE_AFTER_H * 3600000;
  if (checkedAfter) return status('late', { at, when, evidence: `not published: Meta checked ${ukDayTime(ctx.meta.last_ok_at)}, ${SOCIAL_LATE_AFTER_H} h after its planned time` });
  return status('checking', { at, when, evidence: `waiting for the Meta check${ctx.meta?.last_ok_at ? ` (last ${ukDayTime(ctx.meta.last_ok_at)})` : ''}` });
}

/** Before its time: the platform's own ID, or GPT's read-back in the native queue (no ID exposed; never invented). */
function scheduledSocial(p) {
  const at = p.planned_at;
  if (p.provider_id) return status('scheduled', { at, when: `Scheduled ${ukDayTime(at)}`, link: p.provider_url, evidence: `${isLinkedin(p) ? 'LinkedIn' : 'Meta'} scheduled post ${p.provider_id}` });
  if (!operatorScheduled(p)) return null;
  return status('scheduled', { label: 'Scheduled on platform', at, when: `${platformOf(p)} ${ukDayTime(at)}`, link: p.provider_url, evidence: `verified by ${queueEvidence(p).by} in the native queue (no ID available)` });
}

const dayMonth = (iso) => new Date(iso).toLocaleDateString('en-GB', { timeZone: LONDON, day: 'numeric', month: 'short' });
/** A gate on the post (editorial "Hold: …", or the step's): not schedulable until it is confirmed. */
export function holdOf(p, held) {
  const text = /^hold\b/i.test(editorial(p).scheduling_status || '') ? editorial(p).scheduling_status : held?.get(p.step_key);
  if (!text || !p.planned_at) return null;
  const kick = /kick-?starter/i.test(text);
  const next = new Date(ms(p.planned_at) + 864e5).toISOString();
  return status('conditional', { label: `Conditional: ${dayMonth(p.planned_at)}${kick ? ' Kick-Starter' : ''}`, at: p.planned_at, when: `Planned ${ukDayTime(p.planned_at)}`, blocker: kick ? `needs a session available before ${dayMonth(next)}` : text.replace(/^hold:\s*/i, ''), evidence: 'not schedulable until confirmed' });
}

/** ctx = { now, open: Set of step_keys with an open release approval (decision state), blockers(p) → string[], meta, posts, recent, held } */
export function placementStatus(p, ctx = {}) {
  const c = { now: Date.now(), open: new Set(), blockers: () => [], ...ctx };
  if (isPublishedPlacement(p)) return status('published', { at: p.actual_at, when: p.actual_at ? `Published ${ukDayTime(p.actual_at)}` : 'Published', link: p.provider_url, evidence: publishedEvidence(p, c.posts) });
  const seen = collectorPost(p, c.recent);
  if (seen) return status('published', { at: seen.posted_at, when: `Published ${ukDayTime(seen.posted_at)}`, link: seen.permalink, evidence: `seen by the Meta collector ${ukDayTime(seen.collected_at || seen.posted_at)}` });
  if (['skipped', 'withdrawn'].includes(p.stage)) return status('cancelled', { label: p.stage === 'skipped' ? 'Skipped' : 'Withdrawn', evidence: `stage ${p.stage}` });
  const sch = p.platform_state === 'scheduled' && !isDue(p.planned_at, c.now) ? scheduledSocial(p) : null;
  if (sch) return sch;
  const held = holdOf(p, c.held);
  if (held) return held;
  if (p.planned_at && isDue(p.planned_at, c.now)) return dueSocial(p, c);
  return upcomingSocial(p, c);
}

/** Feed post Meta can't take yet (20 minutes to 29 days ahead): ready, GPT schedules it from the stored date. Not Alan's. */
function windowStatus(p, now) {
  const from = editorial(p).provider_schedule_eligible_at;
  if (!from || isStory(p) || isLinkedin(p)) return null;
  const when = ms(from) > now ? `schedule from ${ukDayTime(from)}` : `in Meta's window since ${ukDayTime(from)} · GPT schedules it now`;
  return status('waiting_window', { at: p.planned_at, when, evidence: `Meta schedules 20 minutes to 29 days ahead · planned ${ukDayTime(p.planned_at)}` });
}

/** An Instagram Story (separate from the main artwork's approval and from feed scheduling): posted on its day. */
const storyStatus = (p) => status('story_ready', { at: p.planned_at, when: `Planned ${ukDayTime(p.planned_at)}`, link: p.link_url, blocker: p.link_url ? `link sticker ${p.link_url}` : 'no link yet', evidence: `${STORY_OWNER} posts it on the day` });

/** Not yet due: needs approval only while the decision state has it open (all ready); otherwise in preparation. */
function upcomingSocial(p, c) {
  const when = p.planned_at ? `Planned ${ukTime(p.planned_at)}` : 'No time yet';
  if (isStory(p) && p.planned_at) return storyStatus(p);
  const win = windowStatus(p, c.now);
  if (win) return win;
  if (c.open.has(p.step_key)) return status('needs_approval', { at: p.planned_at, when, evidence: 'caption, artwork and link ready · one Review' });
  const b = c.blockers(p);
  const ready = alanApproved(p) ? 'artwork approved by Alan · GPT schedules it' : 'caption, artwork and link ready · Alan reviews it the day before';
  return status('in_preparation', { at: p.planned_at, when, blocker: b.length ? `missing ${b[0]}` : ready });
}
/** Alan approved the main artwork (assets.editorial.approval): never asked again; scheduling is GPT's. */
export const alanApproved = (p) => /approved by alan/i.test(editorial(p).approval || '');

/* ---------- YouTube video (a content record's YouTube use; provider_state from videos.list) ---------- */

export const VIDEO_LATE_AFTER_MIN = 60;
/** A real restriction from YouTube's own fields (the Data API does not expose copyright-check progress). */
export function videoProblem(s) {
  if (s.rejection_reason) return `rejected by YouTube (${s.rejection_reason})`;
  if (['failed', 'rejected', 'deleted'].includes(s.upload_status)) return `upload ${s.upload_status}${s.failure_reason ? ` (${s.failure_reason})` : ''}`;
  if (['failed', 'terminated'].includes(s.processing_status)) return 'YouTube processing failed';
  if ((s.region_blocked || []).length) return `blocked in ${s.region_blocked.length} countr${s.region_blocked.length === 1 ? 'y' : 'ies'}`;
  if (s.age_restricted) return 'age-restricted by YouTube';
  if (s.embeddable === false) return 'embedding switched off';
  return null;
}
/** Alan must act only on a rejection / failure / region block (an age limit or embedding is noted, not his queue). */
export const videoNeedsAlan = (s) => !!s && (!!s.rejection_reason || ['failed', 'rejected', 'deleted'].includes(s.upload_status) || (s.region_blocked || []).length > 0);

function dueVideo(s, release, link, now) {
  const when = `Due ${ukDayTime(release)}`;
  if (s.error && !(ms(s.read_at) > ms(release))) return status('verification_unavailable', { at: release, when, link, evidence: `YouTube read failed (${s.error}); last verified: scheduled, read ${ukDayTime(s.read_at)}`, last_verified: { code: 'scheduled', at: release } });
  if (ms(s.read_at) > ms(release) + VIDEO_LATE_AFTER_MIN * 60000) return status('late', { at: release, when, link, evidence: `YouTube still reported it ${s.privacy} at ${ukDayTime(s.read_at)}` });
  return status('checking', { at: release, when, link, evidence: `waiting for YouTube to report it public (last read ${ukDayTime(s.read_at)}: ${s.privacy})` });
}

/**
 * a = { url, release_at (GPT's confirmed YouTube schedule), provider_state }. Public only when YouTube says public —
 * never because the release time passed. Before the first read: GPT's Studio confirmation = operator-verified scheduled.
 */
function unreadVideo(release, link) {
  if (!release) return status('in_preparation', { link, blocker: 'no YouTube release time' });
  return status('scheduled', { at: release, when: `Scheduled ${ukDayTime(release)}`, link, evidence: 'operator-verified (GPT, YouTube Studio); not read by the collector yet' });
}

/** What YouTube itself reported: public / unlisted / a restriction, else null (still private). */
function reportedVideo(s, release, link) {
  const read = `YouTube, read ${ukDayTime(s.read_at)}`;
  const problem = videoProblem(s);
  if (problem) return status('needs_attention', { at: release, link, evidence: read, blocker: problem });
  if (s.privacy === 'public') return status('published', { label: 'Public', at: s.public_at || release, when: `Public ${ukDayTime(s.public_at || release)}`, link, evidence: `YouTube reports it public (read ${ukDayTime(s.read_at)})` });
  if (s.privacy === 'unlisted') return status('needs_attention', { at: release, link, blocker: 'unlisted on YouTube, not public', evidence: read });
  return null;
}

export function videoStatus(a, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const s = a.provider_state || null;
  const link = a.url || null;
  const release = s?.publish_at || a.release_at || null;
  if (!s?.read_at) return unreadVideo(release, link);
  const reported = reportedVideo(s, release, link);
  if (reported) return reported;
  if (release && ms(release) <= now) return dueVideo(s, release, link, now);
  if (!release) return status('in_preparation', { link, blocker: 'private on YouTube with no release time' });
  return status('scheduled', { at: release, when: `Scheduled ${ukDayTime(release)}`, link, evidence: `YouTube scheduled (private until release), read ${ukDayTime(s.read_at)}${s.error ? `; latest read failed (${s.error}), last state kept` : ''}` });
}

/** The email guard: what an email row that carries a Short shows before release. */
export function shortCheck(a, vs) {
  const pub = vs.code === 'published';
  return { asset_key: a.asset_key, title: a.title, duration: a.duration || null, url: a.url || null, release_at: vs.at || a.release_at || null, public: pub, status: vs.code, label: pub ? 'Short public ✓' : 'Short not public yet ⚠' };
}

/* ---------- tasks (Outlook notes, Google weekly check) ---------- */

/* The weekly Google Business review is a GPT task (never a publication): Due / In progress / Checked / Needs attention. */
export const isGbpReview = (step) => /Google Business/i.test(step.channel || '') && /check|review/i.test(step.title || '');
const GBP_NEXT = 'Review latest posts and reviews';
/**
 * From GPT's own tick only (status + reason + who + when); collecting data or pressing Refresh never changes it.
 * step.tick = { is_ticked, status, reason, set_by, set_at, history }.
 */
const openIssues = (t) => (t.history || []).flatMap((h) => h.issues || []).filter((i) => i && !i.resolved);
const issueLine = (i) => (i ? `${i.next || i.what} (owner ${i.owner || 'GPT'})` : null);
const byWhen = (prefix, t) => `${prefix} ${t.set_at ? ukDayTime(t.set_at) : ''}`.trim();
export function gbpReviewStatus(step) {
  const t = step.tick || {};
  const issues = openIssues(t);
  if (t.status === 'needs_attention' || issues.length) return status('needs_attention', { at: t.set_at, evidence: t.reason || null, blocker: issueLine(issues[0]) });
  if (t.is_ticked || t.status === 'done') return status('checked', { at: t.set_at, when: byWhen(`Checked by ${t.set_by || 'GPT'}`, t), evidence: t.reason || 'checked (no outcome recorded)' });
  if (t.status === 'in_progress') return status('in_progress', { at: t.set_at, when: byWhen('Started', t), blocker: GBP_NEXT });
  if (['skipped', 'not_needed'].includes(t.status)) return status('cancelled', { label: 'Skipped', evidence: t.reason || t.status });
  return status('due', { when: step.day ? `Due ${ukDay(step.day)}` : null, blocker: GBP_NEXT, evidence: 'owner GPT' });
}

const ukDateOf = (iso) => new Date(iso).toLocaleDateString('en-GB', { timeZone: LONDON, weekday: 'short', day: 'numeric', month: 'short' });
/** d = { by, at, reason } from marketing_decisions (kind deferred). Never "In preparation". */
export function deferredStatus(d) {
  const label = `Deferred by ${d.by || 'Alan'}${d.at ? ` · ${ukDateOf(d.at)}` : ''}`;
  return status('deferred', { label, when: label, at: d.at || null, evidence: d.reason || null });
}

/** step = { key, channel, title, day, done, done_at?, tick? }; ctx = { today, open: Set of decision keys, deferred: Map step_key → { by, at, reason } } */
export function taskStatus(step, ctx = {}) {
  if (isGbpReview(step)) return gbpReviewStatus(step);
  const when = step.day ? `Planned ${ukDay(step.day)}` : null;
  if (step.done) return status('done', { at: step.done_at || null, evidence: 'ticked as done' });
  if (ctx.deferred?.has(step.key)) return deferredStatus(ctx.deferred.get(step.key));
  if (ctx.open?.has(`outlook|${step.key}`)) return status('needs_approval', { when, evidence: 'personal note · approve and send' });
  if (step.day && ctx.today && step.day < ctx.today) return status('late', { when, evidence: 'planned day passed, not ticked' });
  return status('in_preparation', { when, blocker: /Outlook/i.test(step.channel || '') ? 'a reminder: write the note when due' : 'a reminder' });
}

/** Squarespace checks due: every 15 minutes 07:00–22:00 UK, and once ~10 minutes after each release (any hour). */
export function watchDecision({ now, lastAttemptAt, lastOkAt, releases = [], running = false }) {
  const hour = Number(new Date(now).toLocaleString('en-GB', { timeZone: LONDON, hour: '2-digit', hour12: false }));
  if (running || hour === 5) return { due: false, reason: running ? 'a collector run is in progress' : 'the 05:40 nightly collector hour' };
  const since = (iso) => (iso ? (now - ms(iso)) / 60000 : Infinity);
  const after = releases.find((r) => {
    const check = ms(r) + RELEASE_CHECK_DELAY_MIN * 60000;
    return check <= now && now - check < 3 * 3600000 && !(ms(lastOkAt) >= check);
  });
  if (after && since(lastAttemptAt) >= 5) return { due: true, reason: `release check ${RELEASE_CHECK_DELAY_MIN} min after ${ukDayTime(after)}` };
  const inHours = hour >= CHECK_HOURS.from && hour < CHECK_HOURS.to;
  if (inHours && since(lastAttemptAt) >= CHECK_EVERY_MIN) return { due: true, reason: `${CHECK_EVERY_MIN}-minute check` };
  return { due: false, reason: inHours ? 'checked in the last 15 minutes' : 'outside 07:00–22:00 UK and no release due' };
}

export const CHECK_RULES = `Status checks: Squarespace (Scheduled, Sent and Drafts, read-only on Alan's PC) every ${CHECK_EVERY_MIN} minutes ${String(CHECK_HOURS.from).padStart(2, '0')}:00–${CHECK_HOURS.to}:00 UK, plus one check about ${RELEASE_CHECK_DELAY_MIN} minutes after each scheduled release (any hour except 05:00–06:00, the nightly run). Meta (Facebook / Instagram posts) about ${RELEASE_CHECK_DELAY_MIN} minutes after each Facebook / Instagram release and on Refresh status (not every 15 minutes, to keep API load low). YouTube (each Short's status, read-only with the channel owner's sign-in) every ${CHECK_EVERY_MIN} minutes ${String(CHECK_HOURS.from).padStart(2, '0')}:00–${CHECK_HOURS.to}:00 UK and about ${RELEASE_CHECK_DELAY_MIN} minutes after each release; "Public" only when YouTube says so (YouTube's copyright-check progress isn't in its API, only real restrictions). Personal LinkedIn has no API: GPT's recorded live check (post id, URL, time, screenshot) counts as published. Time passing never marks anything sent or public; a failed check keeps the last verified state ("verification unavailable"). Refresh status runs a real check and never sends, retries or publishes.`;
