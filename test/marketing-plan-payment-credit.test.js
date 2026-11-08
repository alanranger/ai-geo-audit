/**
 * Plans tab money and KPI 5 (Alan, 8 Nov 2026, answer "B"): Payment £ = the total actually paid so far; Plan Value £
 * only when Payment £ is blank. KPI 5 counts plans active by dates (the shared planState rule), not "Status active or
 * blank". Also the "credit held" overlay from cancelled events (strategy_event_outcomes). Fixture rows only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { activePlanCount, sheetPlans } from '../lib/marketing/plan-sources.mjs';
import { badgesOf, creditHeld, overlays } from '../lib/marketing/client-health.mjs';
import { creditsByAnchor } from '../lib/marketing/rebuild.mjs';

const row = (id, extra = {}) => ({ id, plan_id: `PNM-${id}`, client_name: `Client ${id}`, email: `c${id}@example.com`, start_date: '2026-11-12', end_date: '2027-11-11', plan_value: 600, payment: 600, status: 'Active', source_row: id, ...extra });

test('Payment £ is the total paid so far; Plan Value £ only stands in when Payment £ is blank', () => {
  const { plans, payments } = sheetPlans([
    row(1, { payment: 150 }),
    row(2, { payment: null }),
    row(3, { payment: '' }),
    row(4, { payment: 0 })
  ]);
  assert.deepEqual(plans.map((p) => p.paid_total), [150, 600, 600, 0]);
  assert.deepEqual(plans.map((p) => p.plan_value), [600, 600, 600, 600]);
  assert.deepEqual(payments.map((p) => p.amount), [150, 600, 600]);
});

test('KPI 5: active by dates, not "Status active or blank"', () => {
  const today = '2026-11-20';
  const rows = [
    row(1),
    row(2, { status: null, start_date: '2025-01-01', end_date: '2025-12-31' }),
    row(3, { status: '', start_date: '2026-12-05', end_date: '2027-12-04' }),
    row(4, { status: 'Cancelled' }),
    row(5, { status: null, start_date: '2026-10-01', end_date: null })
  ];
  const oldRule = rows.filter((p) => String(p.status || '').toLowerCase() === 'active' || !p.status).length;
  assert.equal(oldRule, 4);
  assert.equal(activePlanCount(sheetPlans(rows).plans, today), 2);
  assert.equal(activePlanCount([], today), 0);
});

const credit = { label: 'credit held · Batsford Oct 2026', count: 1, run_key: '2026-10-23|day|batsford arboretum autumn photography wo', event_date: '2026-10-23' };

test('credit held: overlay marker on the person and a Customers row mark; never touches the purchase tag', () => {
  assert.equal(creditHeld({}), null);
  assert.deepEqual(overlays({ credit_held: [credit] }, '2026-11-08').credit_held, [credit]);
  const marks = badgesOf({ credit_held: [credit] }, { today: '2026-11-08' }).marks;
  assert.deepEqual(marks.map((m) => m.key), ['credit']);
  assert.match(marks[0].tip, /^credit held · Batsford Oct 2026 — an open commitment to honour, not revenue$/);
  assert.equal(badgesOf({ credit_held: [credit] }, { today: '2026-11-08' }).purchase.key, badgesOf({}, { today: '2026-11-08' }).purchase.key);
});

test('rebuild keeps the marker: linked, unused credits by person anchor; used or unlinked ones dropped', () => {
  const base = { run_key: credit.run_key, event_date: '2026-10-23', event_title: 'Batsford Arboretum Autumn Photography Workshop - 23/10', cancelled: true, credit_held_count: 1, credit_held_person_id: 'p1', set_at: 't' };
  const m = creditsByAnchor([{ ...base, anchor_key: 'a1' }, { ...base, anchor_key: 'a2', credit_used_on: '2027-01-01' }, { ...base, anchor_key: null }]);
  assert.deepEqual([...m.keys()], ['a1']);
  assert.equal(m.get('a1')[0].label, 'credit held · Batsford Oct 2026');
});
