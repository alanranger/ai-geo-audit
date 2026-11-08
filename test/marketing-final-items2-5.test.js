/**
 * Final fix round (8 Nov 2026) items 2 and 5: the authoritative Pick n Mix candidates recipe is the agreed broad rule;
 * average order = net ÷ orders from one set (orders + Booking Sheet sales + plan payments), with gross / net / refunds.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PNM_CANDIDATES, RECIPES } from '../lib/marketing/query/recipes.mjs';
import { validateQuery } from '../lib/marketing/query/english.mjs';
import { orderValue, summarise, valueBreakdown } from '../lib/marketing/value.mjs';
import { COLUMNS, PRESETS } from '../lib/marketing/query/table.mjs';

test('Pick n Mix candidates = can email + opened in 6 months + (booking OR purchase in 24 months OR Pick n Mix any time); valid query', () => {
  const r = PNM_CANDIDATES.query.root;
  assert.equal(r.match, 'all');
  assert.deepEqual(r.items.slice(0, 2).map((c) => [c.field, c.op, c.value?.n ?? null]), [['eligible', 'is_true', null], ['last_open', 'within_last', 6]]);
  const any = r.items[2];
  assert.equal(any.match, 'any');
  assert.deepEqual(any.items.map((c) => [c.field, c.value.within?.n ?? null, c.value.cats || null]), [['booking', 24, null], ['purchase', 24, null], ['purchase', null, ['pick_n_mix']]]);
  assert.doesNotThrow(() => validateQuery(PNM_CANDIDATES.query));
  assert.equal(RECIPES.pnm_candidates, PNM_CANDIDATES);
});

test('the Customers recipe 7 reads the server rule; the narrow list is renamed "Beginners → next step (12 months)"', () => {
  const src = fs.readFileSync(new URL('../lib/marketing-query.js', import.meta.url), 'utf8');
  assert.match(src, /'7 Pick n Mix candidates \(agreed broad rule\)', \(cat\) => cat\.recipes\?\.pnm_candidates/);
  assert.match(src, /'13 Beginners → next step \(12 months\)'/);
  assert.doesNotMatch(src, /'7 Pick n Mix candidates', G\(/);
});

test('average order: the three audit examples now divide (net ÷ orders incl. plan payments)', () => {
  const cases = [[{ net: 8938, gross: 8988, refunds: 50, orders: 67, plan_payments: 1 }, 68, 131.44], [{ net: 7598, gross: 7598, refunds: 0, orders: 23, plan_payments: 32 }, 55, 138.15], [{ net: 6714, gross: 6714, refunds: 0, orders: 7, plan_payments: 10 }, 17, 394.94]];
  for (const [s, sales, aov] of cases) {
    const o = orderValue(s);
    assert.equal(o.sales, sales);
    assert.ok(Math.abs(o.aov - aov) < 0.02, `${o.aov} vs ${aov}`);
    assert.ok(Math.abs(o.aov * o.sales - s.net) < 1);
  }
  assert.equal(orderValue({ net: 0, orders: 0 }).aov, null);
  assert.match(valueBreakdown(cases[0][0]), /gross £8,988 · refunds £50 · net £8,938 · 68 orders \(67 orders \/ sales \+ 1 plan payments\)/);
});

test('stored summary uses the same definition; table columns and labels say which date is which', () => {
  const s = summarise([{ src: 'squarespace', net: 100, gross: 100, refunded: 0, places: 1, date: '2026-01-01' }, { src: 'plan', net: 300, gross: 300, refunded: 0, places: 0, date: '2026-02-01' }], '2026-11-08');
  assert.deepEqual([s.orders, s.plan_payments, s.net, s.aov], [1, 1, 400, 200]);
  const p = { anchor_key: 'email:x', facts: { value: { c: { net: 400, gross: 400, refunds: 0, orders: 1, plan_payments: 1 }, cp: { last: '2026-02-01' } }, last_booking: '2026-06-10' } };
  assert.deepEqual([COLUMNS.orders.get(p), COLUMNS.aov.get(p), COLUMNS.last_purchase.get(p)], [2, 200, '2026-06-10']);
  assert.deepEqual([COLUMNS.last_paid_purchase.label, COLUMNS.last_purchase.label], ['Last paid purchase (confirmed)', 'Last activity (any evidence)']);
  assert.ok(PRESETS.value.columns.includes('last_paid_purchase') && PRESETS.value.columns.includes('last_purchase'));
});
