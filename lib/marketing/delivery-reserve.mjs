/**
 * Email send reservations by delivery (question 2026-11-08 email capacity). Pure functions, no database.
 *
 * - One logical reservation per email delivery. Each later stage REPLACES the earlier amount, never adds to it:
 *   estimate (audience chosen) → frozen snapshot → Squarespace schedule (collector-read, else operator-verified).
 * - Amounts are unique addresses within the delivery, Alan's copy included; the same person in two deliveries counts
 *   twice. A multi-module email is one delivery.
 * - Committed = a frozen snapshot or an evidenced platform schedule. Provisional = audience chosen, not frozen (a live
 *   or labelled estimate, or a reservation typed on the record), or a snapshot held for review ("count review only",
 *   export status blocked) while its send awaits approval. No audience = unbudgeted (never 0). A drafted record with
 *   no frozen snapshot and no platform schedule is a draft proposal: never committed, provisional or deducted.
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

/** The live audience's reserving number: an unattached reference group (shown as "query now") never reserves. */
export function liveSends(q) {
  if (q == null) return null;
  if (typeof q === 'number') return q;
  return q.attached === false ? null : q.sends;
}

const num = (v) => (v == null ? null : Number(v));

/** Frozen snapshot: clients (organisations are not split once frozen), owner addresses apart, business copy once. */
function snapshotSplit(exp) {
  const o = exp?.owner || {};
  if (!exp || o.included === false) return exp ? { people: num(exp.eligible_count), business_copy: 0, owner_addresses: 0, organisations: null } : null;
  const business = Number((o.kinds || {}).business) || 0;
  return { people: num(exp.eligible_count), business_copy: Math.min(1, business + (Number(o.business_copy) || 0)), owner_addresses: Math.max(0, (Number(o.count) || 0) - business), organisations: null };
}

const BASIS = { squarespace_schedule: 'provider', operator_schedule: 'provider', snapshot: 'snapshot', typed_reservation: 'reservation' };
function basisOf(d) {
  if (d.sent?.count != null) return 'provider';
  if (d.amount_from === 'estimate') return d.estimate?.live ? 'query' : 'estimate';
  return BASIS[d.amount_from] || null;
}

function splitOf(d, query, exp) {
  if (d.snapshot && exp) return snapshotSplit(exp);
  return query && query.attached !== false && query.people != null ? query : {};
}

/**
 * Audience breakdown for one delivery: people + business copy (once) = sends, owner addresses and organisations
 * apart. query_now (live saved-group count) and plan_estimate (estimate_sends on the record) are both kept; the
 * reserved number is never swapped for the other without `differs` saying so.
 */
/**
 * ONE basis: when the reserving number is the provider's (Squarespace schedule / sent count / operator-verified), the
 * people figure follows it too (provider − business copy − owner addresses in the list), and the difference from the
 * frozen snapshot is a labelled line ("N since unsubscribed / removed"). Recipients are never changed here.
 */
export function providerBasis(s, sends, basis) {
  if (basis !== 'provider' || s.people == null || sends == null) return { people: s.people ?? null };
  const fixed = (s.business_copy || 0) + (s.owner_addresses || 0);
  const frozen = s.people + fixed;
  const diff = frozen - sends;
  if (!diff) return { people: s.people, frozen_people: s.people, since_frozen: 0 };
  const line = diff > 0 ? `${diff} since unsubscribed / removed from the Squarespace list (frozen: ${s.people} people)` : `${-diff} more on the Squarespace list than frozen (frozen: ${s.people} people)`;
  return { people: Math.max(0, sends - fixed), frozen_people: s.people, since_frozen: diff, since_frozen_line: line };
}

export function audienceOf(d, c, q, exp) {
  const query = typeof q === 'number' ? { sends: q } : q || null;
  const s = splitOf(d, query, exp);
  const plan = num(c.estimate_sends);
  const queryNow = query ? num(query.sends) : null;
  const sends = d.amount ?? plan;
  const basis = basisOf(d);
  return {
    business_copy: s.business_copy ?? null, owner_addresses: s.owner_addresses ?? null, organisations: s.organisations ?? null,
    sends, basis, ...providerBasis(s, sends, basis), query_now: queryNow, query_people: query?.people ?? null, query_group: query?.segment_id || null,
    plan_estimate: plan, differs: queryNow != null && plan != null && queryNow !== plan
  };
}

export const GONE_RELEASE_MINUTES = 30;

/** Squarespace stopped listing the schedule at or after its send time (sent, not unscheduled), as the collector saw. */
export function goneAfterSend(p) {
  if (p?.state !== 'gone' || !p.gone_at || !p.scheduled_for) return false;
  return Date.parse(p.scheduled_for) <= Date.parse(p.gone_at);
}

/** No Sent link yet: released by the first meter read ≥ 30 minutes after the schedule left Squarespace's list. */
export function goneReleased(d, meterAt) {
  if (!meterAt || !goneAfterSend(d.provider)) return false;
  return Date.parse(meterAt) >= Date.parse(d.provider.gone_at) + GONE_RELEASE_MINUTES * 60000;
}

/**
 * null = still to send; released / pending_reconciliation / cancel_unconfirmed once sent or cancelled. A send is
 * released by a meter read after its send time once the Sent collector has linked it, else by goneReleased().
 * A record only marked sent (no Sent link, no schedule seen leaving) stays reserved until one of those exists.
 */
export function releaseOf(d, meterAt) {
  if (d.sent) {
    if (!d.sent.at) return 'released';
    const metered = meterAt && Date.parse(meterAt) > Date.parse(d.sent.at);
    return (metered && d.sent.seen) || goneReleased(d, meterAt) ? 'released' : 'pending_reconciliation';
  }
  if (goneReleased(d, meterAt)) return 'released';
  if (d.cancelled) return d.provider?.state === 'scheduled' ? 'cancel_unconfirmed' : 'released';
  return null;
}

/** "released, pending Sent link" when the release came from the schedule leaving Squarespace, not the Sent list. */
export const releaseNote = (d, release) => (release === 'released' && !d.sent?.seen && goneAfterSend(d.provider) ? 'released, pending Sent link' : null);

const COMMITTED = new Set(['scheduled', 'snapshot']);

/** A drafted record with no frozen snapshot and no platform schedule: a proposal, never a reserved send. */
const isDraftProposal = (d) => d.record_stage === 'drafted' && !d.snapshot && !d.operator && d.provider?.state !== 'scheduled' && !d.sent;

/** committed | provisional | unbudgeted | draft (proposal, not reserved) | released for one delivery. */
export function bucketOf(d) {
  if (d.release === 'released') return 'released';
  if (!d.release && (d.not_in_scheduled || isDraftProposal(d))) return 'draft';
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

const emptySide = () => ({ committed: 0, provisional: 0, unbudgeted: 0, pending_reconciliation: 0, cancel_unconfirmed: 0, items: 0, draft: 0, draft_items: 0 });

function addTo(side, d) {
  if (d.bucket === 'draft') { side.draft += d.amount || 0; side.draft_items += 1; return; }
  side.items += 1;
  if (d.bucket === 'unbudgeted') side.unbudgeted += 1;
  else side[d.bucket] += d.amount;
  if (d.release === 'pending_reconciliation') side.pending_reconciliation += d.amount || 0;
  if (d.release === 'cancel_unconfirmed') side.cancel_unconfirmed += d.amount || 0;
}

/** A plan whose Squarespace draft is already counted as a schedule (lib/marketing/delivery.mjs markScheduledDrafts). */
const countedElsewhere = (d) => !!d.scheduled_as && ['draft', 'provisional', 'unbudgeted'].includes(d.bucket);

/** Sums by cycle side for the deliveries that still hold (or need) a reservation. */
export function sidesOf(deliveries) {
  const out = { current: emptySide(), next: emptySide(), unallocated: emptySide(), later: emptySide() };
  for (const d of deliveries) if (d.bucket !== 'released' && out[d.side] && !countedElsewhere(d)) addTo(out[d.side], d);
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
    draft_proposals: cur.draft, draft_items: cur.draft_items,
    next_cycle: { starts_at: cycle.reset, ends_at: cycle.next_reset, allowance: meter.quota, committed: s.next.committed, provisional: s.next.provisional, unbudgeted: s.next.unbudgeted, free_after_commitments: meter.quota - s.next.committed, draft_proposals: s.next.draft, draft_items: s.next.draft_items },
    later_items: s.later.items, later_draft_items: s.later.draft_items, reset_day: cycle.reset_day,
    not_in_scheduled: notScheduledList(deliveries)
  };
}

/** Records marked scheduled that Squarespace's Scheduled tab doesn't list (lib/marketing/delivery.mjs notInScheduled). */
const notScheduledList = (deliveries) => deliveries.filter((d) => d.not_in_scheduled && d.bucket !== 'released')
  .map((d) => ({ key: d.key, title: d.title, side: d.side, amount: d.amount, since: d.not_in_scheduled.since, reason: d.not_in_scheduled.reason }));
