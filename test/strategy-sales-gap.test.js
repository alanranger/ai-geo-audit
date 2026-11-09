/**
 * Sales gap by month (QUESTION-2026-11-09 (h)): every £ in the month the booking is MADE; likely via fill rate ×
 * capacity − booked, damped and spread by the lead-time curve; Remedy levers add up to the gap; Q1 reconciles.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSalesGap, eventLikely, fillRates, monthsFrom, stockIn } from '../lib/strategy-sales-gap.mjs';

const TODAY = '2026-11-09';
const LEAD = {
  day: { n: 120, q25_days: 19, median_days: 45, q75_days: 139 },
  residential: { n: 17, q25_days: 31, median_days: 76, q75_days: 104 },
  course: { n: 25, q25_days: 23, median_days: 36, q75_days: 63 }
};
const FILL = { day: 0.559, residential: 0.563, course: 0.583, all: 0.563 };
const TARGETS = [3339, 2694, 1776, 3655, 4277, 4602, 3464, 2634, 4130, 5391, 5755, 5191].map((v, i) => (i === 0 ? 4332 : v));
const lake = { eventKey: 'lake', date: '2027-01-22', title: 'Lake District Photography Workshop | Winter', type: 'residential', cap: 4, booked: 2, left: 2, price: 1075, booked_gbp: 2150 };
const macro = { eventKey: 'macro', date: '2026-11-28', title: 'Abstract and Macro Photography Workshop', type: 'day', cap: 4, booked: 0, left: 4, price: 75 };
const QUARTERS = [
  { key: 'q1', label: 'Q1 · Oct–Dec 2026', start_date: '2026-10-01', end_date: '2026-12-31' },
  { key: 'q2', label: 'Q2 · Jan–Mar 2027', start_date: '2027-01-01', end_date: '2027-03-31' },
  { key: 'q3', label: 'Q3 · Apr–Jun 2027', start_date: '2027-04-01', end_date: '2027-06-30' },
  { key: 'q4', label: 'Q4 · Jul–Sep 2027', start_date: '2027-07-01', end_date: '2027-09-30' }
];
const txns = [
  { txn_date: '2026-10-05', category_order: 2, amount: 3000 },
  { txn_date: '2026-11-03', category_order: 3, amount: 1075 }, // a Lake District (22 Jan) place booked on 3 Nov
  { txn_date: '2025-11-10', category_order: 8, amount: 600 }, { txn_date: '2025-12-10', category_order: 7, amount: 300 },
  { txn_date: '2026-06-01', category_order: 8, amount: 150 }, { txn_date: '2026-07-01', category_order: 4, amount: 300 }
];
const gap = (events = [lake, macro], extra = {}) => buildSalesGap({ today: TODAY, txns, targets: TARGETS, events, fill: FILL, lead: LEAD, quarters: QUARTERS, ...extra });

test('fill rates parse from scorecard F4 (last 12 months + next 6)', () => {
  assert.deepEqual(fillRates([{ key: 'F4', l12: '55.9% / 56.3% / 58.3% / 56.3%' }]), { day: 0.559, residential: 0.563, course: 0.583, all: 0.563, basis: 'KPI scorecard F4 · last 12 months + next 6' });
  assert.equal(fillRates([{ key: 'F4', l12: '—' }]), null);
});

test('booking month: a January-event place booked in November is November sold and likely, not January', () => {
  const g = gap();
  const [nov, dec, jan] = g.months;
  assert.deepEqual([nov.label, dec.label, jan.label], ['Nov', 'Dec', 'Jan']);
  assert.equal(nov.sold, 1075, 'the 3 Nov booking for the 22 Jan event is November sales');
  assert.equal(jan.sold, 0, 'January has no cash dated in it');
  const lk = eventLikely(lake, { today: TODAY, fill: FILL, lead: LEAD }, monthsFrom(TODAY, 4));
  assert.ok(lk.by_month['2026-11'] > 0 && lk.by_month['2026-12'] > 0 && lk.by_month['2027-01'] > 0, 'the January event\'s likely bookings are spread over Nov, Dec and Jan');
  assert.ok(nov.likely >= lk.by_month['2026-11'] * 1075 - 0.01, 'November likely includes the January event\'s November bookings');
  assert.ok(jan.likely < lk.likely * 1075, 'January only gets its own share');
  assert.equal(jan.booked_ahead, 2150, 'booked ahead is a line on the event month, already counted when booked');
});

test('lead-time spread sums to the likely places; damping = share of bookings still to come', () => {
  const months = monthsFrom(TODAY, 4);
  const lk = eventLikely(lake, { today: TODAY, fill: FILL, lead: LEAD }, months);
  const spread = Object.values(lk.by_month).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(spread - lk.likely) < 1e-9);
  assert.ok(Math.abs(lk.extra - (0.563 * 4 - 2)) < 1e-9, 'fill × capacity − booked');
  assert.ok(Math.abs(lk.damping - (0.25 + (43 / 45) * 0.25)) < 1e-9, '74 days out: half the residential bookings still to come (q25 31, median 76)');
});

test('damping: a close event keeps only the share of bookings that normally arrive in the days left', () => {
  const near = eventLikely({ ...macro, date: '2026-11-19' }, { today: TODAY, fill: FILL, lead: LEAD }, monthsFrom(TODAY, 2));
  assert.ok(near.damping > 0 && near.damping < 0.25, `10 days out on a 19-day q25: damping ${near.damping}`);
  assert.ok(Math.abs(near.likely - near.extra * near.damping) < 1e-9);
  const far = eventLikely({ ...macro, date: '2027-10-01' }, { today: TODAY, fill: FILL, lead: LEAD }, monthsFrom(TODAY, 12));
  assert.equal(far.window_opens, '2026-12-27', 'day booking window = 2 × q75 (278 days)');
  assert.equal(far.damping, 1);
  assert.equal(far.by_month['2026-11'] || 0, 0, 'its booking window has not opened in November');
});

test('Remedy: each month\'s levers add up to its gap, and the total too', () => {
  const g = gap();
  for (const r of g.remedy.rows) assert.ok(Math.abs(r.lever1.gbp + r.lever2.gbp + r.lever3.gbp - r.gap) < 0.01, `${r.label} levers sum to the gap`);
  const t = g.remedy.total;
  assert.ok(Math.abs(t.lever1 + t.lever2 + t.lever3 - t.gap) < 0.01);
  assert.equal(g.remedy.rows.length, 3, 'rolling 3 months only');
});

test('Remedy lever 2: too late when under a median lead time is left; latest on-sale date otherwise', () => {
  const g = gap([]);
  const [nov, dec] = g.remedy.rows;
  assert.equal(nov.lever2.too_late, true, '21 days left < 45-day median lead');
  assert.equal(dec.lever2.brief.latest_on_sale, '2026-11-16', 'Dec 31 − 45 days');
  assert.ok(dec.lever2.events <= 2);
});

test('Q1 reconciles with the months (Oct sold + Nov + Dec); future quarters without stock say so', () => {
  const g = gap();
  const q1 = g.quarters[0];
  assert.equal(q1.state, 'current');
  assert.ok(q1.reconcile.ok);
  const [nov, dec] = g.months;
  const oct = q1.reconcile.parts.find((p) => p.label === 'Oct');
  assert.equal(oct.sold, 3000);
  assert.ok(Math.abs(q1.reconcile.raw_gap - (oct.raw_gap + nov.raw_gap + dec.raw_gap)) < 0.01);
  assert.ok(Math.abs(q1.likely - (nov.likely + dec.likely)) < 0.01, 'Q1 likely = Nov + Dec likely');
  const q4 = g.quarters[3];
  assert.equal(q4.no_events_on_sale, true);
  assert.equal(q4.stock.events, 0);
});

test('stock: events starting after the period begins with their booking window open by its end', () => {
  const months = monthsFrom(TODAY, 3);
  const evs = [lake, macro].map((e) => eventLikely(e, { today: TODAY, fill: FILL, lead: LEAD }, months));
  const nov = stockIn(evs, '2026-11-01', '2026-11-30', TODAY);
  assert.equal(nov.events, 2);
  assert.equal(nov.gbp, 2 * 1075 + 4 * 75);
  const jan = stockIn(evs, '2027-01-01', '2027-01-31', TODAY);
  assert.equal(jan.events, 1, 'the November event has started by January');
});
