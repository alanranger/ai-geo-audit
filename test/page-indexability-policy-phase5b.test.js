import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRowIndexable } from '../lib/page-indexability-policy.js';

const EFFECTIVE = '2025-09-15';

function row(pageUrl, periodStart, clicks, impressions, policyValue = 'intentional_noindex') {
  return {
    page_url: pageUrl,
    clicks_28d: clicks,
    impressions_28d: impressions,
    period_start: periodStart,
    policy_value: policyValue,
    policy_effective_date: EFFECTIVE
  };
}

function computePortfolioSegmentKpis(segmentPages) {
  const totalClicks = segmentPages.reduce((s, p) => s + (Number(p.clicks_28d) || 0), 0);
  const totalImpr = segmentPages.reduce((s, p) => s + (Number(p.impressions_28d) || 0), 0);
  return {
    clicks_28d: totalClicks,
    impressions_28d: totalImpr,
    pages_count: segmentPages.length
  };
}

function appendPortfolioIndexable(basePages) {
  const indexable = basePages.filter(isRowIndexable);
  const base = computePortfolioSegmentKpis(basePages);
  const idx = computePortfolioSegmentKpis(indexable);
  return {
    ...base,
    clicks_28d_indexable: idx.clicks_28d,
    rows_total_count: basePages.length,
    rows_indexable_count: indexable.length
  };
}

test('portfolio grouped fixture — per-segment indexable split', () => {
  const groupA = [
    row('https://www.alanranger.com/a/neutral', '2025-10-01', 10, 100, null),
    row('https://www.alanranger.com/a/pre', '2025-08-01', 10, 100),
    row('https://www.alanranger.com/a/straddle', '2025-09-01', 10, 100),
    row('https://www.alanranger.com/a/post', '2025-10-01', 10, 100),
    row('https://www.alanranger.com/a/neutral2', '2025-10-01', 10, 100, null)
  ];
  const out = appendPortfolioIndexable(groupA);
  assert.equal(out.rows_total_count, 5);
  assert.equal(out.rows_indexable_count, 3);
  assert.equal(out.clicks_28d, 50);
  assert.equal(out.clicks_28d_indexable, 30);
  assert.ok(out.clicks_28d_indexable < out.clicks_28d);
  console.log('PASS  portfolio segment rows_total=5 rows_indexable=3 clicks_indexable=30');
});

test('money pages timeseries fixture — per-day indexable fields', () => {
  const policy = { policy_value: 'intentional_noindex', policy_effective_date: EFFECTIVE };
  const target = '/photography-workshops';
  const points = [
    { date: '2025-08-15', clicks: 5, impressions: 50, ctr: 0.1, position: 12 },
    { date: '2025-09-15', clicks: 5, impressions: 50, ctr: 0.1, position: 12 },
    { date: '2025-10-15', clicks: 5, impressions: 50, ctr: 0.1, position: 12 }
  ];
  let indexableCount = 0;
  const enriched = points.map((point) => {
    const indexable = isRowIndexable({
      page_url: target,
      period_start: `${point.date.slice(0, 7)}-01`,
      ...policy
    });
    if (indexable) indexableCount += 1;
    return {
      ...point,
      clicks_indexable: indexable ? point.clicks : 0
    };
  });
  assert.equal(enriched.length, 3);
  assert.equal(indexableCount, 1);
  assert.equal(enriched[0].clicks_indexable, 5);
  assert.equal(enriched[1].clicks_indexable, 0);
  assert.equal(enriched[2].clicks_indexable, 0);
  console.log('PASS  money pages timeseries indexable days=1 of 3');
});
