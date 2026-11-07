/**
 * Squarespace email send budget by BILLING CYCLE (never calendar month). The provider meter (used / quota / reset time)
 * comes from the PC collector; it is shown with its age and goes "stale" after 26 hours — a stale or missing meter is
 * never shown as zero. Reservations are planned recipients on campaigns not yet sent; once a campaign is linked to its
 * sent Squarespace email the reservation stops counting (the provider's used total already includes it).
 */
export const STALE_HOURS = 26;

/** Cycle [start, reset) from the provider's next reset time: start = same instant one month earlier. */
export function cycleOf(resetIso) {
  if (!resetIso) return null;
  const end = new Date(resetIso);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 1);
  return { start: start.toISOString(), reset: end.toISOString(), id: start.toISOString().slice(0, 10) };
}

const ACTIVE = new Set(['proposed', 'drafted', 'verified', 'approved', 'scheduled', 'blocked']);

export function meterView(latest, campaigns, sentEmails, now = new Date()) {
  if (!latest) return { state: 'never_read', note: 'No meter reading yet: the collector on Alan\'s PC has not run.' };
  const ageH = (now - new Date(latest.captured_at)) / 3600000;
  const cycle = cycleOf(latest.cycle_reset_at);
  const inCycle = (iso) => cycle && iso >= cycle.start && iso < cycle.reset;
  const reservations = campaigns.filter((c) => c.reserved_sends > 0 && !c.sqs_email_id && ACTIVE.has(c.stage));
  const reserved = reservations.reduce((s, c) => s + Number(c.reserved_sends), 0);
  const sent = sentEmails.filter((e) => e.sent_on && inCycle(new Date(e.sent_on).toISOString()));
  const remaining = latest.quota_emails - latest.used_emails;
  return {
    state: ageH > STALE_HOURS ? 'stale' : 'fresh', captured_at: latest.captured_at, age_hours: Math.round(ageH * 10) / 10,
    cycle, quota: latest.quota_emails, used: latest.used_emails, remaining, reserved, after_reservations: remaining - reserved,
    reservations: reservations.map((c) => ({ campaign_key: c.campaign_key, title: c.title, reserved_sends: c.reserved_sends, stage: c.stage })),
    sent_this_cycle: sent.map((e) => ({ email_id: e.email_id, subject: e.subject, sent_on: e.sent_on, recipients: e.message_count })),
    sent_recipients_this_cycle: sent.reduce((s, e) => s + (e.message_count || 0), 0),
    sending_disabled: !!latest.is_sending_disabled
  };
}

/** Would a planned send fit? Refuses when the meter is stale or missing. */
export function capacityCheck(view, recipients) {
  if (!view || view.state !== 'fresh') return { ok: false, reason: 'meter_not_fresh' };
  if (recipients > view.after_reservations) return { ok: false, reason: 'over_capacity', short_by: recipients - view.after_reservations };
  return { ok: true };
}
