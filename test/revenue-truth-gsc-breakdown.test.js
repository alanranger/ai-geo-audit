import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  gscTotalsForMonths,
  lastClosedMonthKeys,
  slugFromLandingUrl
} from '../lib/revenue-truth-gsc-lookup.mjs';
import { buildFindings } from '../lib/revenue-truth-findings.mjs';
import { attachGscToFindings } from '../lib/revenue-truth-gsc-lookup.mjs';
import { renderProductBreakdownTable, renderPageBreakdownTable } from '../lib/revenue-truth-tables-ui.mjs';

describe('revenue-truth gsc breakdown overlay', () => {
  it('lastClosedMonthKeys returns 3 months ending at last closed', () => {
    assert.deepEqual(lastClosedMonthKeys(2026, 5, 3), ['2026-04-01', '2026-03-01', '2026-02-01']);
  });

  it('gscTotalsForMonths sums only requested months', () => {
    const cell = {
      monthly_series: [
        { period_start: '2026-02-01', clicks: 10, impressions: 100 },
        { period_start: '2026-03-01', clicks: 20, impressions: 200 },
        { period_start: '2026-04-01', clicks: 5, impressions: 50 },
        { period_start: '2026-01-01', clicks: 99, impressions: 999 }
      ]
    };
    const t = gscTotalsForMonths(cell, ['2026-02-01', '2026-03-01', '2026-04-01']);
    assert.equal(t.clicks, 35);
    assert.equal(t.impressions, 350);
    assert.equal(t.ctr_pct, 10);
  });

  it('attachGscToFindings adds gsc_last_3mo on product and page rows', () => {
    const findings = buildFindings({
      transactions: [
        { year: 2026, month: 3, amount: 100, canonical_product: 'Workshop A', landing_page_url: 'https://www.alanranger.com/workshop-a', funding: 'Stripe', booking_source: 'Google', txn_date: '2026-03-01', is_jlr: false }
      ],
      canonicalProducts: [{ product_title: 'Workshop A', product_url: 'https://www.alanranger.com/workshop-a', category: 'workshop' }],
      now: '2026-05-28T12:00:00Z'
    });
    const gscBySlug = new Map([['workshop-a', {
      monthly_series: [{ period_start: '2026-04-01', clicks: 7, impressions: 70 }]
    }]]);
    attachGscToFindings(findings, gscBySlug, ['2026-04-01']);
    assert.equal(findings.products.all[0].gsc_last_3mo.clicks, 7);
    assert.equal(findings.pages.all[0].gsc_last_3mo.clicks, 7);
    const prodHtml = renderProductBreakdownTable(findings);
    const pageHtml = renderPageBreakdownTable(findings);
    assert.match(prodHtml, /Clicks \(3mo\)/);
    assert.match(pageHtml, /CTR \(3mo\)/);
  });

  it('slugFromLandingUrl strips domain', () => {
    assert.equal(slugFromLandingUrl('https://www.alanranger.com/landscape-photography-workshops'), 'landscape-photography-workshops');
  });
});
