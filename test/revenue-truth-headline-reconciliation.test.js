import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHeadlineReconciliation, formatReconciliationBadge } from '../lib/revenue-truth-headline-reconciliation.mjs';

test('headline reconciliation passes when page matches sheet minus JLR', () => {
  const cfg = { now: { year: 2026 } };
  const wide = [{ year: 2026, month: 5, revenue_amount: 19619 }];
  const monthly = [{ year: 2026, month: 5, headlineRevenue: 19253, isPartial: true }];
  const txns = [
    { year: 2026, txn_date: '2026-05-10', amount: 365, is_jlr: true, canonical_product: 'Woodland walk' }
  ];
  const rec = buildHeadlineReconciliation(wide, monthly, txns, cfg);
  assert.equal(rec.passes, true);
  assert.equal(rec.sheet_raw_ytd, 19619);
  assert.equal(rec.jlr_stripped_ytd, 365);
  assert.equal(rec.page_headline_ytd, 19253);
  assert.match(formatReconciliationBadge(rec), /Reconciled/);
});

test('headline reconciliation fails on real break not JLR strip', () => {
  const cfg = { now: { year: 2026 } };
  const wide = [{ year: 2026, month: 5, revenue_amount: 19619 }];
  const monthly = [{ year: 2026, month: 5, headlineRevenue: 19000 }];
  const txns = [{ year: 2026, txn_date: '2026-05-10', amount: 365, is_jlr: true }];
  const rec = buildHeadlineReconciliation(wide, monthly, txns, cfg);
  assert.equal(rec.passes, false);
  assert.match(formatReconciliationBadge(rec), /FAIL/);
});
