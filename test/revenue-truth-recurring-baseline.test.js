import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isLumpyTxn,
  sumRecurringForMonth,
  buildSeasonalityByProduct,
  attachRecurringToMonthly
} from '../lib/revenue-truth-recurring-baseline.mjs';
import { DEFAULT_TIER_BANDS } from '../lib/revenue-truth-ui-core.mjs';

describe('revenue-truth recurring baseline', () => {
  const seasonality = buildSeasonalityByProduct([
    { product_title: 'BLUEBELL WOODLANDS', seasonality_type: 'event_bound' }
  ]);

  it('includes residential + event-bound, excludes only voucher tiers', () => {
    const txns = [
      { year: 2026, month: 4, txn_date: '2026-04-10', amount: 2720, category_label: '3. Workshops Residential', is_jlr: false, is_redemption: false },
      { year: 2026, month: 4, txn_date: '2026-04-12', amount: 744, category_label: '2. Workshops Non Residential', canonical_product: 'BLUEBELL WOODLANDS', is_jlr: false, is_redemption: false },
      { year: 2026, month: 4, txn_date: '2026-04-15', amount: 200, category_label: '8. Gift Vouchers Inc', is_jlr: false, is_redemption: false },
      { year: 2026, month: 4, txn_date: '2026-04-20', amount: 2727, category_label: '7. 1-2-1', is_jlr: false, is_redemption: false }
    ];
    const r = sumRecurringForMonth(txns, seasonality, 2026, 4);
    assert.equal(r.nonJlrNet, 6391);
    // Only the £200 gift voucher is stripped now; residential + Bluebell stay in.
    assert.equal(r.lumpyExcluded, 200);
    assert.equal(r.recurringBaseline, 6191);
  });

  it('strips JLR and redemptions before lumpy math', () => {
    const txns = [
      { year: 2026, month: 5, txn_date: '2026-05-01', amount: 500, category_label: '7. 1-2-1', is_jlr: true, is_redemption: false },
      { year: 2026, month: 5, txn_date: '2026-05-02', amount: 150, category_label: '8. Gift Vouchers Inc', is_jlr: false, is_redemption: true }
    ];
    const r = sumRecurringForMonth(txns, seasonality, 2026, 5);
    assert.equal(r.nonJlrNet, 0);
    assert.equal(r.recurringBaseline, 0);
  });

  it('includes JLR in recurring baseline when includeJlr is true', () => {
    const txns = [
      { year: 2026, month: 5, txn_date: '2026-05-01', amount: 500, category_label: '7. 1-2-1', is_jlr: true, is_redemption: false },
      { year: 2026, month: 5, txn_date: '2026-05-03', amount: 300, category_label: '7. 1-2-1', is_jlr: false, is_redemption: false },
      { year: 2026, month: 5, txn_date: '2026-05-04', amount: 999, category_label: '7. 1-2-1', is_jlr: true, is_redemption: true }
    ];
    const off = sumRecurringForMonth(txns, seasonality, 2026, 5, null, false);
    assert.equal(off.recurringBaseline, 300);
    const on = sumRecurringForMonth(txns, seasonality, 2026, 5, null, true);
    assert.equal(on.recurringBaseline, 800);
  });

  it('attachRecurringToMonthly honours cfg.includeJlr', () => {
    const cfg = { now: { iso: '2026-05-28T12:00:00.000Z', year: 2026, month: 5 }, tierBands: { survival: DEFAULT_TIER_BANDS.survival }, includeJlr: true };
    const monthly = [{ year: 2026, month: 5, isPartial: false }];
    const txns = [
      { year: 2026, month: 5, txn_date: '2026-05-10', amount: 400, category_label: '7. 1-2-1', is_jlr: true, is_redemption: false },
      { year: 2026, month: 5, txn_date: '2026-05-11', amount: 100, category_label: '7. 1-2-1', is_jlr: false, is_redemption: false }
    ];
    const out = attachRecurringToMonthly(monthly, txns, seasonality, cfg, () => 'below_survival');
    assert.equal(out[0].recurringBaseline, 500);
  });

  it('flags only voucher tiers as lumpy; residential + event-bound now count', () => {
    assert.equal(isLumpyTxn({ category_label: '8. Gift Vouchers Inc', is_jlr: false, is_redemption: false }, seasonality), true);
    assert.equal(isLumpyTxn({ category_label: '3. Workshops Residential', is_jlr: false, is_redemption: false }, seasonality), false);
    assert.equal(isLumpyTxn({ category_label: '2. Workshops Non Residential', canonical_product: 'BLUEBELL WOODLANDS', is_jlr: false, is_redemption: false }, seasonality), false);
    assert.equal(isLumpyTxn({ category_label: '7. 1-2-1', is_jlr: false, is_redemption: false }, seasonality), false);
  });

  it('attachRecurringToMonthly adds band fields', () => {
    const cfg = { now: { iso: '2026-05-28T12:00:00.000Z', year: 2026, month: 5 }, tierBands: DEFAULT_TIER_BANDS };
    const monthly = [{ year: 2026, month: 5, isPartial: true, headlineRevenue: 787 }];
    const txns = [{ year: 2026, month: 5, txn_date: '2026-05-10', amount: 637, category_label: '7. 1-2-1', is_jlr: false, is_redemption: false }];
    const out = attachRecurringToMonthly(monthly, txns, seasonality, cfg, (n) => (n >= DEFAULT_TIER_BANDS.survival ? 'survival' : 'below_survival'));
    assert.equal(out[0].recurringBaseline, 637);
    assert.equal(out[0].recurringBand, 'below_survival');
  });
});
