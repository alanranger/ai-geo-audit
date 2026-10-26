/**
 * F5 Run rate = events that ran ÷ events scheduled, from strategy_event_snapshots
 * (daily capture of every listed event since 7 Oct 2026).
 *
 * Scheduled = any event seen in a snapshot whose date is in [from, toExclusive).
 * Ran = the last snapshot before it showed ≥1 booking. Dual-session days
 * (…|AM / …|PM rows) count once: ran if any session had bookings.
 * Walks count as Day. Average = mean of the Day / Residential / Course rates.
 */

export const RUN_RATE_EPOCH = '2026-10-07';

const BUCKET_BY_TYPE = { day: 'day', walk: 'day', residential: 'residential', course: 'course' };
const BUCKETS = ['day', 'residential', 'course'];

function groupKey(eventKey) {
  return String(eventKey || '').replace(/\|(AM|PM)$/i, '');
}

/** Last snapshot per row key, then the best booked figure per event group. */
function lastBookedPerEvent(rows, from, toExclusive) {
  const lastByKey = new Map();
  for (const r of rows || []) {
    if (!r?.event_key || !r.event_date || r.event_date < from || r.event_date >= toExclusive) continue;
    if (!BUCKET_BY_TYPE[r.event_type]) continue;
    const prev = lastByKey.get(r.event_key);
    if (!prev || String(r.snapshot_date) > String(prev.snapshot_date)) lastByKey.set(r.event_key, r);
  }
  const groups = new Map();
  for (const r of lastByKey.values()) {
    const key = groupKey(r.event_key);
    const g = groups.get(key) || { bucket: BUCKET_BY_TYPE[r.event_type], combined: 0, sessions: 0 };
    const booked = Number(r.sheet_booked) || 0;
    if (/\|(AM|PM)$/i.test(r.event_key)) g.sessions += booked;
    else g.combined = Math.max(g.combined, booked);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ bucket: g.bucket, booked: Math.max(g.combined, g.sessions) }));
}

function rate(ran, scheduled) {
  return scheduled > 0 ? Math.round((ran / scheduled) * 1000) / 10 : null;
}

export function computeRunRate(rows, { from = RUN_RATE_EPOCH, toExclusive } = {}) {
  const tally = Object.fromEntries(BUCKETS.map((b) => [b, { ran: 0, scheduled: 0 }]));
  for (const e of lastBookedPerEvent(rows, from, toExclusive)) {
    tally[e.bucket].scheduled += 1;
    if (e.booked > 0) tally[e.bucket].ran += 1;
  }
  const parts = BUCKETS.map((b) => ({ ...tally[b], pct: rate(tally[b].ran, tally[b].scheduled) }));
  const pcts = parts.map((p) => p.pct).filter((p) => p != null);
  const avgPct = pcts.length ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 10) / 10 : null;
  const ran = parts.reduce((a, p) => a + p.ran, 0);
  const scheduled = parts.reduce((a, p) => a + p.scheduled, 0);
  const all = [...parts, { ran, scheduled, pct: avgPct }];
  return {
    from,
    scheduled,
    ran,
    avg_pct: avgPct,
    pctLine: all.map((p) => (p.pct == null ? '—' : `${p.pct}%`)).join(' / '),
    countLine: all.map((p) => (p.scheduled ? `${p.ran}/${p.scheduled}` : '—')).join(' | '),
  };
}
