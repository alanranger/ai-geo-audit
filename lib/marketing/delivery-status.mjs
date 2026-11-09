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
  done: ['Done', '✓', 'green']
};

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
  if (!d.audience && !d.estimate) return 'audience not chosen';
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

export function emailStatus(d, ctx = {}) {
  const now = ctx.now ?? Date.now();
  if (d.sent?.seen) return status('sent', { at: d.sent.at, when: `Sent ${ukDayTime(d.sent.at)}`, link: sqsLink(d.sent.email_id), evidence: 'Squarespace Sent list (collector)' });
  if (d.record_stage === 'cancelled') return status('cancelled', { evidence: 'campaign record cancelled' });
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
/** Same rule as the decision state (provider id / URL or a published stage), except a platform-scheduled post not yet out. */
const isPublished = (p) => !(p.platform_state === 'scheduled' && !p.actual_at) && (!!p.provider_id || !!p.provider_url || PUBLISHED_STAGES.has(p.stage));

function dueSocial(p, ctx) {
  const at = p.planned_at;
  const when = `Due ${ukDayTime(at)}`;
  if (isLinkedin(p)) {
    const late = ctx.now - ms(at) > SOCIAL_LATE_AFTER_H * 3600000;
    return status(late ? 'late' : 'checking', { at, when, blocker: 'personal LinkedIn has no API: needs GPT\'s live check', evidence: late ? `no live check recorded ${SOCIAL_LATE_AFTER_H} h after its planned time` : 'waiting for GPT\'s live check' });
  }
  if (ctx.meta && !ctx.meta.ok) return status('verification_unavailable', { at, when, evidence: `Meta check failed (${ctx.meta.error || 'error'}); last verified ${ctx.meta.last_ok_at ? ukDayTime(ctx.meta.last_ok_at) : 'never'}`, last_verified: { code: 'in_preparation', at } });
  const checkedAfter = ctx.meta?.last_ok_at && ms(ctx.meta.last_ok_at) > ms(at) + SOCIAL_LATE_AFTER_H * 3600000;
  if (checkedAfter) return status('late', { at, when, evidence: `not published: Meta checked ${ukDayTime(ctx.meta.last_ok_at)}, ${SOCIAL_LATE_AFTER_H} h after its planned time` });
  return status('checking', { at, when, evidence: `waiting for the Meta check${ctx.meta?.last_ok_at ? ` (last ${ukDayTime(ctx.meta.last_ok_at)})` : ''}` });
}

/** ctx = { now, open: Set of step_keys with an open release approval (decision state), blockers(p) → string[], meta, posts } */
export function placementStatus(p, ctx = {}) {
  const c = { now: Date.now(), open: new Set(), blockers: () => [], ...ctx };
  if (isPublished(p)) return status('published', { at: p.actual_at, when: p.actual_at ? `Published ${ukDayTime(p.actual_at)}` : 'Published', link: p.provider_url, evidence: publishedEvidence(p, c.posts) });
  if (['skipped', 'withdrawn'].includes(p.stage)) return status('cancelled', { label: p.stage === 'skipped' ? 'Skipped' : 'Withdrawn', evidence: `stage ${p.stage}` });
  if (p.platform_state === 'scheduled' && p.provider_id && !isDue(p.planned_at, c.now)) return status('scheduled', { at: p.planned_at, when: `Scheduled ${ukDayTime(p.planned_at)}`, link: p.provider_url, evidence: `${isLinkedin(p) ? 'LinkedIn' : 'Meta'} scheduled post ${p.provider_id}` });
  if (p.planned_at && isDue(p.planned_at, c.now)) return dueSocial(p, c);
  return upcomingSocial(p, c);
}

/** Not yet due: needs approval only while the decision state has it open (all ready); otherwise in preparation. */
function upcomingSocial(p, c) {
  const when = p.planned_at ? `Planned ${ukTime(p.planned_at)}` : 'No time yet';
  if (c.open.has(p.step_key)) return status('needs_approval', { at: p.planned_at, when, evidence: 'caption, artwork and link ready · one Review' });
  const b = c.blockers(p);
  return status('in_preparation', { at: p.planned_at, when, blocker: b.length ? `missing ${b[0]}` : 'caption, artwork and link ready · Alan reviews it the day before' });
}

/* ---------- tasks (Outlook notes, Google weekly check) ---------- */

/** step = { key, channel, title, day, done, done_at? }; ctx = { today, open: Set of decision keys } */
export function taskStatus(step, ctx = {}) {
  const when = step.day ? `Planned ${ukDay(step.day)}` : null;
  if (step.done) return status('done', { at: step.done_at || null, evidence: 'ticked as done' });
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

export const CHECK_RULES = `Status checks: Squarespace (Scheduled, Sent and Drafts, read-only on Alan's PC) every ${CHECK_EVERY_MIN} minutes ${String(CHECK_HOURS.from).padStart(2, '0')}:00–${CHECK_HOURS.to}:00 UK, plus one check about ${RELEASE_CHECK_DELAY_MIN} minutes after each scheduled release (any hour except 05:00–06:00, the nightly run). Meta (Facebook / Instagram posts) about ${RELEASE_CHECK_DELAY_MIN} minutes after each Facebook / Instagram release and on Refresh status (not every 15 minutes, to keep API load low). Personal LinkedIn has no API: GPT's recorded live check (post id, URL, time, screenshot) counts as published. Time passing never marks anything sent; a failed check keeps the last verified state ("verification unavailable"). Refresh status runs a real check and never sends, retries or publishes.`;
