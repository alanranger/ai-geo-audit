/**
 * Event outcomes — the one shared definition (V04, 7 Nov 2026), used by the Strategy "Events: how full, and did they
 * run?" tile and the KPI scorecard F5, from strategy_event_snapshots (daily capture of every listed event since
 * 7 Oct 2026) plus the Booking Sheet:
 *   ran        = the Booking Sheet shows attendees on that date (courses: course rows; workshops: workshop rows, multi-day
 *                for residentials)
 *   withdrawn  = removed from the website before the date (not a failure; not in the base)
 *   cancelled  = still listed to the day before, but no attendees on the Booking Sheet
 * Run rate = ran ÷ (listed − withdrawn). AM/PM sessions of one day count once; walks count as day.
 */
export const RUN_RATE_EPOCH = '2026-10-07';

const BUCKETS = ['day', 'residential', 'course'];
const TYPE = { day: 'day', walk: 'day', residential: 'residential', course: 'course' };

export const runKey = (s) => `${s.event_date}|${TYPE[s.event_type] || s.event_type}|${String(s.title || '').toLowerCase().replace(/\b(am|pm|morning|afternoon|sunrise|sunset)\b/g, '').replace(/[^a-z]+/g, ' ').trim().slice(0, 40)}`;

function sheetRan(ev, courses, workshops) {
  if (ev.type === 'course') return (courses || []).some((c) => c.from_date === ev.date && c.client_name);
  return (workshops || []).some((w) => w.event_start === ev.date && w.client_name && (ev.type === 'residential') === !!w.is_multi_day);
}

/** Every listed event whose date has passed (from the epoch): ran / withdrawn / cancelled (reason). */
export function eventOutcomes({ snaps, today, courses, workshops, from = RUN_RATE_EPOCH }) {
  const byEvent = new Map();
  for (const s of snaps || []) {
    if (!s.event_date || s.event_date >= today || s.event_date < from || !TYPE[s.event_type]) continue;
    const k = runKey(s);
    const prev = byEvent.get(k);
    if (!prev || s.snapshot_date > prev.last.snapshot_date) byEvent.set(k, { key: k, date: s.event_date, type: TYPE[s.event_type], title: s.title, last: s });
  }
  return [...byEvent.values()].map((e) => {
    const lastDay = new Date(Date.parse(`${e.date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const siteSold = Math.max(0, (Number(e.last.capacity) || 0) - (Number(e.last.qty_in_stock) || 0));
    if (e.last.snapshot_date < lastDay) return { ...e, outcome: 'withdrawn', siteSold };
    if (sheetRan(e, courses, workshops)) return { ...e, outcome: 'ran', siteSold };
    const diaryBooked = Math.max(siteSold, Number(e.last.sheet_booked) || 0);
    const reason = diaryBooked > 0 ? 'had bookings, reason not recorded (e.g. weather)' : 'no bookings';
    return { ...e, outcome: 'cancelled', reason, siteSold: diaryBooked, mismatch: diaryBooked > 0 };
  });
}

const rate = (ran, held) => (held > 0 ? Math.round((ran / held) * 1000) / 10 : null);

/** Ran ÷ held (listed − withdrawn) per type and pooled — the same numbers the Strategy events tile shows. */
export function computeRunRate(outcomes) {
  const parts = BUCKETS.map((b) => {
    const o = outcomes.filter((e) => e.type === b);
    const ran = o.filter((e) => e.outcome === 'ran').length;
    const held = o.length - o.filter((e) => e.outcome === 'withdrawn').length;
    return { ran, held, listed: o.length, pct: rate(ran, held) };
  });
  const ran = parts.reduce((a, p) => a + p.ran, 0);
  const held = parts.reduce((a, p) => a + p.held, 0);
  const all = [...parts, { ran, held, pct: rate(ran, held) }];
  return {
    from: RUN_RATE_EPOCH, scheduled: held, ran, avg_pct: rate(ran, held),
    pctLine: all.map((p) => (p.pct == null ? '—' : `${p.pct}%`)).join(' / '),
    countLine: all.map((p) => (p.held ? `${p.ran}/${p.held}` : '—')).join(' | ')
  };
}
