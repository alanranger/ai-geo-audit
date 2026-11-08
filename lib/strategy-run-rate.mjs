/**
 * Event outcomes — the one shared definition (V04, 7 Nov 2026; cancellation records 8 Nov 2026), used by the Strategy
 * "Events: how full, and did they run?" tile and the KPI scorecard F5, from strategy_event_snapshots (daily capture of
 * every listed event since 7 Oct 2026), the Booking Sheet and public.strategy_event_outcomes (Alan's record of what
 * happened, keyed by runKey):
 *   cancelled (recorded) = a strategy_event_outcomes row with cancelled = true; it wins over the Booking Sheet and the
 *                          snapshots (e.g. Batsford 25 Oct has sheet rows dated that day but did not run)
 *   ran        = the Booking Sheet shows attendees on that date (courses: course rows; workshops: workshop rows, multi-day
 *                for residentials)
 *   withdrawn  = removed from the website before the date (not a failure; not in the base)
 *   cancelled  = still listed to the day before, but no attendees on the Booking Sheet and no record
 * Ran % of held = ran ÷ (listed − withdrawn − cancelled with a recorded reason). Unrecorded cancellations stay in the
 * base. AM/PM sessions of one day count once; walks count as day. Attendees only ever come from the Booking Sheet row
 * on the date they attend, so a transferred booking counts once, on the event it moved to; record counts are notes.
 */
export const RUN_RATE_EPOCH = '2026-10-07';
export const OUTCOMES_TABLE = 'strategy_event_outcomes';

const BUCKETS = ['day', 'residential', 'course'];
const TYPE = { day: 'day', walk: 'day', residential: 'residential', course: 'course' };

export const REASONS = { weather: 'weather', low_bookings: 'low bookings', leader_unavailable: 'leader unavailable', venue: 'venue', other: 'other' };
export const BOOKINGS = { transferred: 'bookings transferred', refunded: 'bookings refunded', credit_held: 'credit held', mixed: 'bookings mixed' };

export const runKey = (s) => `${s.event_date}|${TYPE[s.event_type] || s.event_type}|${String(s.title || '').toLowerCase().replace(/\b(am|pm|morning|afternoon|sunrise|sunset)\b/g, '').replace(/[^a-z]+/g, ' ').trim().slice(0, 40)}`;

function sheetRan(ev, courses, workshops) {
  if (ev.type === 'course') return (courses || []).some((c) => c.from_date === ev.date && c.client_name);
  return (workshops || []).some((w) => w.event_start === ev.date && w.client_name && (ev.type === 'residential') === !!w.is_multi_day);
}

const ukDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const toText = (rec) => (rec.transferred_to_date ? `to ${String(rec.transferred_to_title || '').split(/[|–-]/)[0].trim() || 'another event'} ${ukDay(rec.transferred_to_date)}` : null);

function bookingsText(rec) {
  const to = toText(rec);
  if (rec.bookings_outcome === 'transferred') return `bookings transferred${to ? ` ${to}` : ''}${rec.transferred_count != null ? ` (${rec.transferred_count})` : ''}`;
  const detail = [
    to && `transferred ${to}${rec.transferred_count != null ? ` (${rec.transferred_count})` : ''}`,
    rec.refunded_count != null && `${rec.refunded_count} refunded`,
    rec.credit_held_count != null && `${rec.credit_held_count} credit held`
  ].filter(Boolean).join(', ');
  if (!rec.bookings_outcome) return detail;
  return `${BOOKINGS[rec.bookings_outcome] || rec.bookings_outcome}${detail ? `: ${detail}` : ''}`;
}

/** "other: moved to Sun 25 Oct, then cancelled (bookings mixed: transferred to Peak District … 1 Nov, 1 refunded, 1 credit held)". */
export function recordReason(rec) {
  const reason = rec.reason_note && rec.reason === 'other' ? `other: ${rec.reason_note}` : (REASONS[rec.reason] || 'reason not given');
  const books = bookingsText(rec);
  return books ? `${reason} (${books})` : reason;
}

const recordOf = (rec) => ({
  reason: rec.reason, reason_note: rec.reason_note, bookings_outcome: rec.bookings_outcome, bookings_note: rec.bookings_note,
  transferred_to_title: rec.transferred_to_title, transferred_to_date: rec.transferred_to_date,
  transferred_count: rec.transferred_count, refunded_count: rec.refunded_count, credit_held_count: rec.credit_held_count,
  set_by: rec.set_by, set_at: rec.set_at
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
  if (rec?.cancelled) return { ...e, outcome: 'cancelled', recorded: true, reason: recordReason(rec), record: recordOf(rec), siteSold: Math.max(siteSold, Number(e.last.sheet_booked) || 0) };
  if (e.last.snapshot_date < lastDay) return { ...e, outcome: 'withdrawn', siteSold };
  if (sheetRan(e, courses, workshops)) return { ...e, outcome: 'ran', siteSold };
  const diaryBooked = Math.max(siteSold, Number(e.last.sheet_booked) || 0);
  const reason = diaryBooked > 0 ? 'had bookings, reason not recorded (e.g. weather)' : 'no bookings';
  return { ...e, outcome: 'cancelled', recorded: false, reason, siteSold: diaryBooked, mismatch: diaryBooked > 0 };
}

/** Every listed event whose date has passed (from the epoch): ran / withdrawn / cancelled (reason, recorded or not). */
export function eventOutcomes({ snaps, today, courses, workshops, records, from = RUN_RATE_EPOCH }) {
  const recs = new Map((records || []).map((r) => [r.run_key, r]));
  return latestPerEvent(snaps, today, from).map((e) => classify(e, recs, courses, workshops));
}

/** Finished events with bookings, no attendees and no cancellation record — the "record what happened" list. */
export const outcomesNeedingRecord = (outcomes) => (outcomes || []).filter((e) => e.outcome === 'cancelled' && !e.recorded && e.mismatch);

const rate = (ran, held) => (held > 0 ? Math.round((ran / held) * 1000) / 10 : null);

/** Listed / ran / withdrawn / cancelled (recorded) / held for one set of outcomes — the tile and F5 both use this. */
export function runCounts(list) {
  const n = (pred) => list.filter(pred).length;
  const ran = n((e) => e.outcome === 'ran');
  const withdrawn = n((e) => e.outcome === 'withdrawn');
  const cancelled = n((e) => e.outcome === 'cancelled');
  const cancelledRecorded = n((e) => e.outcome === 'cancelled' && e.recorded);
  const held = list.length - withdrawn - cancelledRecorded;
  return { listed: list.length, ran, withdrawn, cancelled, cancelledRecorded, held, pct: rate(ran, held) };
}

/** Ran % of held per type and pooled — the same numbers the Strategy events tile shows. */
export function computeRunRate(outcomes) {
  const parts = BUCKETS.map((b) => runCounts(outcomes.filter((e) => e.type === b)));
  const all = runCounts(outcomes.filter((e) => BUCKETS.includes(e.type)));
  return {
    from: RUN_RATE_EPOCH, scheduled: all.held, ran: all.ran, avg_pct: all.pct, cancelled_recorded: all.cancelledRecorded, withdrawn: all.withdrawn, listed: all.listed,
    pctLine: [...parts, all].map((p) => (p.pct == null ? '—' : `${p.pct}%`)).join(' / '),
    countLine: [...parts, all].map((p) => (p.held ? `${p.ran}/${p.held}` : '—')).join(' | ')
  };
}

/** Alan's cancellation records (empty when the table is not there yet — figures fall back to the V04 rule). */
export async function loadEventOutcomeRecords(supabase, propertyUrl) {
  try {
    const { data, error } = await supabase.from(OUTCOMES_TABLE)
      .select('run_key, event_date, event_title, cancelled, reason, reason_note, bookings_outcome, bookings_note, transferred_to_title, transferred_to_date, transferred_count, refunded_count, credit_held_count, credit_held_person_id, set_by, set_at')
      .eq('property_url', propertyUrl);
    return error ? [] : (data || []);
  } catch {
    return [];
  }
}
