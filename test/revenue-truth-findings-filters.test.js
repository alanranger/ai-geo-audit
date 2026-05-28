import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPlumbingProduct } from '../lib/revenue-truth-ui-core.mjs';
import { hasRealGrowth, isRankableFinding, isExcludedFromMovers } from '../lib/revenue-truth-findings-filters.mjs';

describe('revenue-truth findings filters', () => {
  it('excludes plumbing products', () => {
    assert.equal(isPlumbingProduct('Voucher/Plan Redemption - not a product sale'), true);
    assert.equal(isPlumbingProduct('Beginners Photography Course'), false);
  });

  it('growth requires recent non-zero revenue', () => {
    assert.equal(hasRealGrowth({ y2024: 0, y2025: 1000, y2026_ytd_closed: 0, y2026_annualised: 0 }), false);
    assert.equal(hasRealGrowth({ y2024: 100, y2025: 500, y2026_ytd_closed: 200, y2026_annualised: 600 }), true);
  });

  it('excludes volatile tier products from movers', () => {
    const f = {
      unit_type: 'product',
      unit_id: 'GOWER Landscape Photography Wales',
      meta: { category: 'workshop (residential)' },
      flags: [],
      deltas: { nonjlr_2024_to_2025: { delta_gbp: -100 } }
    };
    assert.equal(isExcludedFromMovers(f), true);
  });

  it('rankable decline ignores retired wind-down', () => {
    const f = {
      unit_type: 'product',
      unit_id: 'Old course',
      meta: { category: 'course' },
      flags: ['retired_wound_down'],
      deltas: { nonjlr_2024_to_2025: { delta_gbp: -500 } },
      series_nonjlr: { y2024: 1000, y2025: 500, y2026_annualised: 400, y2026_ytd_closed: 100 }
    };
    assert.equal(isRankableFinding(f, 'nonjlr_2024_to_2025', 'decline'), false);
  });
});
