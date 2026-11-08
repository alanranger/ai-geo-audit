/**
 * Squarespace email send budget by BILLING CYCLE (never calendar month). The provider meter (used / quota / reset time)
 * comes from the PC collector; it is shown with its age and goes "stale" after 26 hours — a stale or missing meter is
 * never shown as zero. Reservations are per delivery (lib/marketing/delivery-reserve.mjs): estimate → snapshot →
 * Squarespace schedule replace each other; a sent delivery stops reserving only once a meter read after the send
 * exists. `reserved` / `after_reservations` (read by other screens) = committed this cycle / free after commitments.
 */
import { deliveryView } from './delivery.mjs';
import { cycleOf } from './delivery-reserve.mjs';

export { cycleOf };
export const STALE_HOURS = 26;

const slim = (d) => ({ campaign_key: d.campaign_key, key: d.key, title: d.title, reserved_sends: d.amount, stage: d.stage, bucket: d.bucket, side: d.side, release: d.release });

/** ctx (optional): { exports, schedules, runs, estimates } from deliveryInputs() + the overview's live estimates. */
export function meterView(latest, campaigns, sentEmails, now = new Date(), ctx = {}) {
  if (!latest) return { state: 'never_read', note: 'No meter reading yet: the collector on Alan\'s PC has not run.' };
  const ageH = (now - new Date(latest.captured_at)) / 3600000;
  const cycle = cycleOf(latest.cycle_reset_at);
  const inCycle = (iso) => cycle && iso >= cycle.start && iso < cycle.reset;
  const inputs = { campaigns, sent: sentEmails, exports: ctx.exports || [], schedules: ctx.schedules || [], runs: ctx.runs || [], links: ctx.links || [], initiatives: ctx.initiatives || [] };
  const view = deliveryView(latest, inputs, ctx.estimates || {}, now);
  const c = view.capacity;
  const sent = sentEmails.filter((e) => e.sent_on && inCycle(new Date(e.sent_on).toISOString()));
  return {
    state: ageH > STALE_HOURS ? 'stale' : 'fresh', captured_at: latest.captured_at, age_hours: Math.round(ageH * 10) / 10,
    cycle, quota: latest.quota_emails, used: latest.used_emails, remaining: c.remaining, reserved: c.committed, after_reservations: c.free_after_commitments,
    reservations: view.deliveries.filter((d) => d.bucket !== 'released').map(slim),
    sent_this_cycle: sent.map((e) => ({ email_id: e.email_id, subject: e.subject, sent_on: e.sent_on, recipients: e.message_count })),
    sent_recipients_this_cycle: sent.reduce((s, e) => s + (e.message_count || 0), 0),
    sending_disabled: !!latest.is_sending_disabled,
    capacity: c, deliveries: view.deliveries, schedule_read: view.read, warnings: view.warnings, step_tags: view.step_tags
  };
}

/** Would a planned send fit? Refuses when the meter is stale or missing. */
export function capacityCheck(view, recipients) {
  if (!view || view.state !== 'fresh') return { ok: false, reason: 'meter_not_fresh' };
  if (recipients > view.after_reservations) return { ok: false, reason: 'over_capacity', short_by: recipients - view.after_reservations };
  return { ok: true };
}
