import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyJlrToMonthly,
  buildJlrByMonth,
  filterTxnsForJlr
} from '../lib/revenue-truth-jlr-filter.mjs';

test('filterTxnsForJlr excludes is_jlr rows by default', () => {
  const txns = [
    { year: 2026, month: 1, amount: 100, is_jlr: false },
    { year: 2026, month: 1, amount: 15, is_jlr: true }
  ];
  const out = filterTxnsForJlr(txns, false);
  assert.equal(out.length, 1);
  assert.equal(out[0].amount, 100);
});

test('applyJlrToMonthly subtracts JLR from headline', () => {
  const txns = [{ year: 2026, month: 5, amount: 20, is_jlr: true, category_order: 2 }];
  const jlrByMonth = buildJlrByMonth(txns);
  const monthly = [{ year: 2026, month: 5, headlineRevenue: 820, operationalRevenue: 800, d2c: 800, recurringBaseline: 600 }];
  const out = applyJlrToMonthly(monthly, jlrByMonth, (n) => (n >= 5000 ? 'comfortable' : 'survival'));
  assert.equal(out[0].headlineRevenue, 800);
  assert.equal(out[0].d2c, 780);
});
