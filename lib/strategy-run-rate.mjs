/**
 * Event outcomes — the one shared definition (V04, 7 Nov 2026; cancellation records and Alan's rule "B", 8 Nov 2026),
 * used by the Strategy "Events: how full, and did they run?" tile and the KPI scorecard F5, from strategy_event_snapshots
 * (daily capture of every listed event since 7 Oct 2026), the Booking Sheet and public.strategy_event_outcomes (Alan's
 * record of what happened, keyed by runKey):
 *   cancelled (recorded) = a strategy_event_outcomes row with cancelled = true; it wins over the Booking Sheet and the
 *                          snapshots (e.g. Batsford 23 / 25 Oct have sheet rows dated those days but did not run)
 *   ran        = the Booking Sheet shows attendees on that date (courses: course rows; workshops: workshop rows, multi-day
 *                for residentials)
 *   withdrawn  = removed from the website before the date (not a failure; not in the base)
 *   cancelled  = still listed to the day before, but no attendees on the Booking Sheet and no record
 * Ran % of held = ran ÷ (listed − withdrawn − cancelled for reasons outside Alan's control). Weather, venue, leader
 * unavailable and "other" leave the base; low / no bookings and cancellations with no reason recorded stay in it as
 * "didn't run". AM/PM sessions of one day count once; walks count as day. Attendees only ever come from the Booking
 * Sheet row on the date they attend, so a transferred booking counts once, on the event it moved to; record counts are
 * notes, and a held credit is an open commitment, never revenue.
 */
export const RUN_RATE_EPOCH = '2026-10-07';
export const OUTCOMES_TABLE = 'strategy_event_outcomes';

const BUCKETS = ['day', 'residential', 'course'];
const TYPE = { day: 'day', walk: 'day', residential: 'residential', course: 'course' };

export const REASONS = { weather: 'weather', low_bookings: 'low bookings', leader_unavailable: 'leader unavailable', venue: 'venue', other: 'other' };
export const BOOKINGS = { transferred: 'bookings transferred', refunded: 'bookings refunded', credit_held: 'credit held', mixed: 'bookings mixed' };
/** Reasons outside Alan's control: these cancellations leave the run-rate base. */
export const OUTSIDE_REASONS = new Set(['weather', 'venue', 'leader_unavailable', 'other']);

export const runKey = (s) => `${s.event_date}|${TYPE[s.event_type] || s.event_type}|${String(s.title || '').toLowerCase().replace(/\b(am|pm|morning|afternoon|sunrise|sunset)\b/g, '').replace(/[^a-z]+/g, ' ').trim().slice(0, 40)}`;

function sheetRan(ev, courses, workshops) {
  if (ev.type === 'course') return (courses || []).some((c) => c.from_date === ev.date && c.client_name);
  return (workshops || []).some((w) => w.event_start === ev.date && w.client_name && (ev.type === 'residential') === !!w.is_multi_day);
}

const ukDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortTitle = (t) => String(t || '').split(/[|–-]/)[0].trim();

/** Where the bookings went: the transfers list, else the single transferred_to fields. */
export function transfersOf(rec) {
  if (Array.isArray(rec.transfers) && rec.transfers.length) return rec.transfers;
  return rec.transferred_to_date ? [{ title: rec.transferred_to_title, date: rec.transferred_to_date, count: rec.transferred_count ?? null }] : [];
}

const transferText = (list) => list.map((t) => `to ${shortTitle(t.title) || 'another event'} ${ukDay(t.date)}${t.count != null ? ` (${t.count})` : ''}`).join(' and ');

function bookingsText(rec) {
  const to = transferText(transfersOf(rec));
  if (rec.bookings_outcome === 'transferred') return `bookings transferred${to ? ` ${to}` : ''}`;
  const detail = [
    to && `transferred ${to}`,
    rec.refunded_count != null && `${rec.refunded_count} refunded`,
    rec.credit_held_count != null && `${rec.credit_held_count} credit held`
  ].filter(Boolean).join(', ');
  if (!rec.bookings_outcome) return detail;
  return `${BOOKINGS[rec.bookings_outcome] || rec.bookings_outcome}${detail ? `: ${detail}` : ''}`;
}

/** "other: moved, then cancelled (bookings mixed: transferred to Peak District … 1 Nov and to … 10 Jan (1), 3 refunded, 1 credit held)". */
export function recordReason(rec) {
  const reason = rec.reason_note && rec.reason === 'other' ? `other: ${rec.reason_note}` : (REASONS[rec.reason] || 'reason not given');
  const books = bookingsText(rec);
  return books ? `${reason} (${books})` : reason;
}

const recordOf = (rec) => ({
  reason: rec.reason, reason_note: rec.reason_note, bookings_outcome: rec.bookings_outcome, bookings_note: rec.bookings_note,
  transferred_to_title: rec.transferred_to_title, transferred_to_date: rec.transferred_to_date, transfers: transfersOf(rec),
  transferred_count: rec.transferred_count, refunded_count: rec.refunded_count, credit_held_count: rec.credit_held_count,
  credit_used_on: rec.credit_used_on || null, credit_linked: !!rec.credit_held_person_id, set_by: rec.set_by, set_at: rec.set_at
});

function latestPerEvent(snaps, today, from) {
  const byEvent = new Map();
  for (const s of snaps || []) {
    if (!s.event_date || s.event_date >= today || s.event_date < from || !TYPE[s.event_type]) continue;
    const k = runKey(s);
    const prev = byEvent.get(k);
    if (!prev || s.snapshot_date > prev.last.snapshot_date) byEvent.set(k, { key: k, date: s.event_date, type: TYPE[s.event_type], title: s.title, last: s });
  }
  return [...byEvent.values()];
}

function classify(e, recs, courses, workshops) {
  const lastDay = new Date(Date.parse(`${e.date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const siteSold = Math.max(0, (Number(e.last.capacity) || 0) - (Number(e.last.qty_in_stock) || 0));
  const rec = recs.get(e.key);
  if (rec?.cancelled) return { ...e, outcome: 'cancelled', recorded: true, outside: OUTSIDE_REASONS.has(rec.reason), reason: recordReason(rec), record: recordOf(rec), siteSold: Math.max(siteSold, Number(e.last.sheet_booked) || 0) };
  if (e.last.snapshot_date < lastDay) return { ...e, outcome: 'withdrawn', siteSold };
  if (sheetRan(e, courses, workshops)) return { ...e, outcome: 'ran', siteSold };
  const diaryBooked = Math.max(siteSold, Number(e.last.sheet_booked) || 0);
  const reason = diaryBooked > 0 ? 'had bookings, reason not recorded (e.g. weather)' : 'no bookings';
  return { ...e, outcome: 'cancelled', recorded: false, outside: false, reason, siteSold: diaryBooked, mismatch: diaryBooked > 0 };
}

/** Every listed event whose date has passed (from the epoch): ran / withdrawn / cancelled (reason, recorded or not). */
export function eventOutcomes({ snaps, today, courses, workshops, records, from = RUN_RATE_EPOCH }) {
  const recs = new Map((records || []).map((r) => [r.run_key, r]));
  return latestPerEvent(snaps, today, from).map((e) => classify(e, recs, courses, workshops));
}

/** Finished events with bookings, no attendees and no cancellation record — the "record what happened" list. */
export const outcomesNeedingRecord = (outcomes) => (outcomes || []).filter((e) => e.outcome === 'cancelled' && !e.recorded && e.mismatch);

/** "credit held · Batsford Oct 2026" (first word of the event title + month and year of the run). */
export function creditLabel(rec) {
  const d = new Date(`${rec.event_date}T12:00:00Z`);
  const when = d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `credit held · ${shortTitle(rec.event_title).split(/\s+/)[0] || 'event'} ${when}`;
}

/** The person-overlay marker for one record, or null when no credit is held / linked / still open. */
export function creditMarker(row) {
  if (!row.cancelled || !(Number(row.credit_held_count) > 0) || row.credit_used_on || !row.credit_held_person_id) return null;
  return { label: creditLabel(row), count: Number(row.credit_held_count), run_key: row.run_key, event_date: row.event_date, set_at: row.set_at };
}

/** Credits still held (not used yet): open commitments for the person overlay and the Monday brief, never revenue. */
export const creditsHeld = (records) => (records || [])
  .filter((r) => Number(r.credit_held_count) > 0 && !r.credit_used_on)
  .map((r) => ({ run_key: r.run_key, event_date: r.event_date, event_title: r.event_title, count: Number(r.credit_held_count), person_id: r.credit_held_person_id || null, label: creditLabel(r) }));

const rate = (ran, held) => (held > 0 ? Math.round((ran / held) * 1000) / 10 : null);

/** Listed / ran / withdrawn / cancelled (counted vs outside Alan's control) / held — the tile and F5 both use this. */
export function runCounts(list) {
  const n = (pred) => list.filter(pred).length;
  const ran = n((e) => e.outcome === 'ran');
  const withdrawn = n((e) => e.outcome === 'withdrawn');
  const cancelled = n((e) => e.outcome === 'cancelled');
  const cancelledOutside = n((e) => e.outcome === 'cancelled' && e.outside);
  const held = list.length - withdrawn - cancelledOutside;
  return { listed: list.length, ran, withdrawn, cancelled, cancelledCounted: cancelled - cancelledOutside, cancelledOutside, held, pct: rate(ran, held) };
}

/** Ran % of held per type and pooled — the same numbers the Strategy events tile shows. */
export function computeRunRate(outcomes) {
  const parts = BUCKETS.map((b) => runCounts(outcomes.filter((e) => e.type === b)));
  const all = runCounts(outcomes.filter((e) => BUCKETS.includes(e.type)));
  return {
    from: RUN_RATE_EPOCH, scheduled: all.held, ran: all.ran, avg_pct: all.pct, withdrawn: all.withdrawn, listed: all.listed,
    cancelled_counted: all.cancelledCounted, cancelled_outside: all.cancelledOutside,
    pctLine: [...parts, all].map((p) => (p.pct == null ? '—' : `${p.pct}%`)).join(' / '),
    countLine: [...parts, all].map((p) => (p.held ? `${p.ran}/${p.held}` : '—')).join(' | ')
  };
}

/** Alan's cancellation records (empty when the table is not there yet — figures fall back to the V04 rule). */
export async function loadEventOutcomeRecords(supabase, propertyUrl) {
  try {
    const { data, error } = await supabase.from(OUTCOMES_TABLE)
      .select('run_key, event_date, event_title, cancelled, reason, reason_note, bookings_outcome, bookings_note, transferred_to_title, transferred_to_date, transfers, transferred_count, refunded_count, credit_held_count, credit_held_person_id, credit_used_on, set_by, set_at')
      .eq('property_url', propertyUrl);
    return error ? [] : (data || []);
  } catch {
    return [];
  }
}
