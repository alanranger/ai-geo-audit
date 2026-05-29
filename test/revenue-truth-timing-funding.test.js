import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFindings } from '../lib/revenue-truth-findings.mjs';

describe('revenue-truth timing funding exclusion', () => {
  it('excludes PicknMix / Gift Voucher Out from product and page YTD', () => {
    const txns = [
      { year: 2026, month: 3, amount: 1000, funding: 'Stripe', canonical_product: 'Workshop A', landing_page_url: '/workshop-a', booking_source: 'sheet', is_jlr: false },
      { year: 2026, month: 3, amount: 500, funding: 'PicknMix', canonical_product: 'Workshop A', landing_page_url: '/workshop-a', booking_source: 'sheet', is_jlr: false },
      { year: 2026, month: 4, amount: 325, funding: 'Gift Voucher Out', canonical_product: 'Workshop A', landing_page_url: '/workshop-a', booking_source: 'sheet', is_jlr: false }
    ];
    const findings = buildFindings({
      transactions: txns,
      canonicalProducts: [{ product_title: 'Workshop A', category: 'workshop' }],
      now: '2026-05-28T12:00:00Z'
    });
    const product = findings.products.all.find((f) => f.unit_id === 'Workshop A');
    const page = findings.pages.all.find((f) => f.unit_id === '/workshop-a');
    assert.ok(product, 'product bucket exists');
    assert.ok(page, 'page bucket exists');
    assert.equal(product.series_nonjlr.y2026_ytd, 1000);
    assert.equal(page.series_nonjlr.y2026_ytd, 1000);
  });
});
