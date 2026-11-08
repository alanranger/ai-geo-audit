/**
 * Email send reservations by delivery (question 2026-11-08 email capacity). Pure functions, no database.
 *
 * - One logical reservation per email delivery. Each later stage REPLACES the earlier amount, never adds to it:
 *   estimate (audience chosen) → frozen snapshot → Squarespace schedule (collector-read, else operator-verified).
 * - Amounts are unique addresses within the delivery, Alan's copy included; the same person in two deliveries counts
 *   twice. A multi-module email is one delivery.
 * - Committed = a frozen snapshot or an evidenced platform schedule. Provisional = audience chosen, not frozen (a live
 *   or labelled estimate, or a reservation typed on the record), or a snapshot held for review ("count review only",
 *   export status blocked) while its send awaits approval. No audience = unbudgeted (never 0).
 * - Cycles split at the provider's exact reset instant. A delivery with only a day that falls on a reset day stays
 *   unallocated (no midnight is assumed).
 * - A sent delivery keeps its reservation until a meter read taken after the send exists ("pending reconciliation").
 *   A cancelled one keeps it while Squarespace still lists the schedule; only a complete read without it releases it.
 */
export const LONDON = 'Europe/London';
export const londonDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: LONDON });

/** Current cycle [start, reset) plus the next reset (no rollover, no borrowing between them). */
export function cycleOf(resetIso) {
  if (!resetIso) return null;
  const end = new Date(resetIso);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 1);
  const next = new Date(end);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { start: start.toISOString(), reset: end.toISOString(), next_reset: next.toISOString(), id: start.toISOString().slice(0, 10), reset_day: londonDay(end.toISOString()) };
}

/** Stage and amount: the latest stage present wins; the amount comes from the latest stage that has a count. */
export function reservationOf(x) {
  const stages = [
    ['scheduled', 'squarespace_schedule', x.provider?.state === 'scheduled', x.provider?.recipients],
    ['scheduled', 'operator_schedule', x.operator != null, x.operator?.recipients],
    [x.snapshot?.review ? 'review_snapshot' : 'snapshot', 'snapshot', x.snapshot != null, x.snapshot?.amount],
    ['reserved', 'typed_reservation', x.manual > 0, x.manual],
    ['estimate', 'estimate', x.estimate != null, x.estimate]
  ].filter((s) => s[2]);
  if (!stages.length) return { stage: 'unbudgeted', amount: null, amount_from: null };
  const counted = stages.find((s) => s[3] != null);
  return { stage: stages[0][0], amount: counted ? Number(counted[3]) : null, amount_from: counted ? counted[1] : null };
}

/** null = still to send; released / pending_reconciliation / cancel_unconfirmed once sent or cancelled. */
export function releaseOf(d, meterAt) {
  if (d.sent) {
    if (!d.sent.at) return 'released';
    return meterAt && Date.parse(meterAt) > Date.parse(d.sent.at) ? 'released' : 'pending_reconciliation';
  }
  if (d.cancelled) return d.provider?.state === 'scheduled' ? 'cancel_unconfirmed' : 'released';
  return null;
}

const COMMITTED = new Set(['scheduled', 'snapshot']);

/** committed | provisional | unbudgeted | released for one delivery. */
export function bucketOf(d) {
  if (d.release === 'released') return 'released';
  if (d.amount == null) return 'unbudgeted';
  if (d.release || COMMITTED.has(d.stage)) return 'committed';
  return 'provisional';
}

function sideOfInstant(at, c) {
  const t = Date.parse(at);
  if (t < Date.parse(c.start)) return 'previous';
  if (t < Date.parse(c.reset)) return 'current';
  return t < Date.parse(c.next_reset) ? 'next' : 'later';
}

function sideOfDay(day, c) {
  const reset = londonDay(c.reset);
  const next = londonDay(c.next_reset);
  if (day === reset || day === next) return 'unallocated';
  if (day < londonDay(c.start)) return 'previous';
  if (day < reset) return 'current';
  return day < next ? 'next' : 'later';
}

/** Which cycle a delivery's send falls in. A day already past (still to send) counts from today. */
export function cycleSide(d, cycle, today) {
  if (!cycle) return 'unallocated';
  if (d.send_at) return sideOfInstant(d.send_at, cycle);
  if (!d.send_day) return 'unallocated';
  return sideOfDay(d.send_day < today ? today : d.send_day, cycle);
}

const emptySide = () => ({ committed: 0, provisional: 0, unbudgeted: 0, pending_reconciliation: 0, cancel_unconfirmed: 0, items: 0 });

function addTo(side, d) {
  side.items += 1;
  if (d.bucket === 'unbudgeted') side.unbudgeted += 1;
  else side[d.bucket] += d.amount;
  if (d.release === 'pending_reconciliation') side.pending_reconciliation += d.amount || 0;
  if (d.release === 'cancel_unconfirmed') side.cancel_unconfirmed += d.amount || 0;
}

/** Sums by cycle side for the deliveries that still hold (or need) a reservation. */
export function sidesOf(deliveries) {
  const out = { current: emptySide(), next: emptySide(), unallocated: emptySide(), later: emptySide() };
  for (const d of deliveries) if (d.bucket !== 'released' && out[d.side]) addTo(out[d.side], d);
  return out;
}

/**
 * The capacity lines. Free after commitments = provider remaining − committed this cycle. Projected = that minus
 * provisional this cycle; incomplete when an audience is missing or a send has no time (not deducted, said so).
 * Overage (red) only when committed sends this cycle exceed what the provider has left.
 */
export function capacityOf(meter, deliveries, cycle) {
  const remaining = meter.quota - meter.used;
  const s = sidesOf(deliveries);
  const cur = s.current;
  const una = s.unallocated;
  const free = remaining - cur.committed;
  const projected = free - cur.provisional;
  const missing = cur.unbudgeted + una.unbudgeted;
  const unallocatedAmount = una.committed + una.provisional;
  return {
    quota: meter.quota, used: meter.used, remaining, committed: cur.committed, free_after_commitments: free,
    provisional: cur.provisional, unbudgeted: cur.unbudgeted, projected_free: projected,
    projected_incomplete: missing > 0 || unallocatedAmount > 0, missing_audiences: missing,
    unallocated: { committed: una.committed, provisional: una.provisional, unbudgeted: una.unbudgeted, items: una.items },
    pending_reconciliation: cur.pending_reconciliation, cancel_unconfirmed: cur.cancel_unconfirmed,
    overage: free < 0 ? -free : 0, projected_overage: projected < 0 ? -projected : 0,
    next_cycle: { starts_at: cycle.reset, ends_at: cycle.next_reset, allowance: meter.quota, committed: s.next.committed, provisional: s.next.provisional, unbudgeted: s.next.unbudgeted, free_after_commitments: meter.quota - s.next.committed },
    later_items: s.later.items, reset_day: cycle.reset_day
  };
}
