import test from 'node:test';
import assert from 'node:assert/strict';
import {
  monthKey,
  txnWindowFor,
  buildTxnCountMap,
  applyTxnCount
} from '../lib/revenue-funnel-txn-counts.js';

test('monthKey handles ISO dates and {year, month} rows', () => {
  assert.equal(monthKey('2026-07-01'), '2026-07');
  assert.equal(monthKey('2026-07-31'), '2026-07');
  assert.equal(monthKey({ year: 2026, month: 7 }), '2026-07');
  assert.equal(monthKey({ year: 2026, month: 12 }), '2026-12');
  assert.equal(monthKey(null), null);
  assert.equal(monthKey({ year: null, month: 7 }), null);
});

test('txnWindowFor spans 28 inclusive days ending on the GSC date', () => {
  const w = txnWindowFor('2026-08-26');
  assert.deepEqual(w, { start: '2026-07-30', end: '2026-08-26' });
});

test('txnWindowFor crosses a month boundary correctly and honours custom lengths', () => {
  assert.deepEqual(txnWindowFor('2026-03-01', 3), { start: '2026-02-27', end: '2026-03-01' });
  assert.equal(txnWindowFor(null), null);
  assert.equal(txnWindowFor('not-a-date'), null);
});

test('buildTxnCountMap keys rows by month with jlr slices', () => {
  const map = buildTxnCountMap([
    { period_start: '2026-07-01', transactions_all: 21, transactions_nonjlr: 20, transactions_jlr: 1, redemptions_excluded: 0 },
    { period_start: '2026-06-01', transactions_all: 33, transactions_nonjlr: 23, transactions_jlr: 10, redemptions_excluded: 2 }
  ]);
  assert.equal(map.get('2026-07').nonjlr, 20);
  assert.equal(map.get('2026-07').all, 21);
  assert.equal(map.get('2026-06').jlr, 10);
  assert.equal(map.get('2026-06').redemptions_excluded, 2);
});

test('applyTxnCount picks the non-JLR slice by default (funnel default)', () => {
  const map = buildTxnCountMap([
    { period_start: '2026-06-01', transactions_all: 33, transactions_nonjlr: 23, transactions_jlr: 10 }
  ]);
  const row = applyTxnCount({ period_start: '2026-06-01', revenue_amount: 5231.87 }, map, false);
  assert.equal(row.transactions, 23);
  assert.equal(row.transactions_all, 33);
  assert.equal(row.transactions_jlr, 10);
});

test('applyTxnCount includes JLR when the toggle is on', () => {
  const map = buildTxnCountMap([
    { period_start: '2026-06-01', transactions_all: 33, transactions_nonjlr: 23, transactions_jlr: 10 }
  ]);
  const row = applyTxnCount({ period_start: '2026-06-01' }, map, true);
  assert.equal(row.transactions, 33);
});

test('applyTxnCount leaves transactions null for a month with no Booking Sheet rows', () => {
  const map = buildTxnCountMap([]);
  const row = applyTxnCount({ period_start: '2025-01-01', revenue_amount: 0 }, map, false);
  assert.equal(row.transactions, null, 'no data must stay distinct from zero sales');
});

test('applyTxnCount reports a real zero-sales month as 0, not null', () => {
  const map = buildTxnCountMap([
    { period_start: '2026-05-01', transactions_all: 0, transactions_nonjlr: 0, transactions_jlr: 0 }
  ]);
  const row = applyTxnCount({ period_start: '2026-05-01' }, map, false);
  assert.equal(row.transactions, 0);
});

test('applyTxnCount passes a null row through untouched', () => {
  assert.equal(applyTxnCount(null, buildTxnCountMap([]), false), null);
});
