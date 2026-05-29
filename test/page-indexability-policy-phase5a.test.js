import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRowIndexable } from '../lib/page-indexability-policy.js';

const EFFECTIVE = '2025-09-15';
const PERIOD_PRE = '2025-08-01';
const PERIOD_STRADDLE = '2025-09-01';
const PERIOD_POST = '2025-10-01';

function policyRow(pageUrl, periodStart, clicks, impressions, policyValue = 'intentional_noindex') {
  return {
    page_url: pageUrl,
    period_start: periodStart,
    clicks,
    impressions,
    clicks_28d: clicks,
    impressions_28d: impressions,
    policy_value: policyValue,
    policy_effective_date: EFFECTIVE
  };
}

function aggregateSubsegmentGroup(rows) {
  const allPages = new Set();
  const indexablePages = new Set();
  const clickPages = new Set();
  const clickPagesIndexable = new Set();
  let clicks = 0;

  rows.forEach((row) => {
    allPages.add(row.page_url);
    const indexable = isRowIndexable(row);
    if (indexable) indexablePages.add(row.page_url);
    if (row.clicks > 0) {
      clickPages.add(row.page_url);
      clicks += row.clicks;
      if (indexable) clickPagesIndexable.add(row.page_url);
    }
  });

  return {
    clickPages: clickPages.size,
    clickPages_indexable: clickPagesIndexable.size,
    rows_total_count: allPages.size,
    rows_indexable_count: indexablePages.size,
    clicks
  };
}

function computeSegmentMetrics(segmentPages) {
  const totalClicks = segmentPages.reduce((sum, p) => sum + (Number(p.clicks_28d) || 0), 0);
  const totalImpressions = segmentPages.reduce((sum, p) => sum + (Number(p.impressions_28d) || 0), 0);
  return {
    clicks_28d: totalClicks,
    impressions_28d: totalImpressions,
    page_count: segmentPages.length
  };
}

function appendIndexableSegmentMetrics(base, segmentPages) {
  const indexablePages = segmentPages.filter(isRowIndexable);
  const indexable = computeSegmentMetrics(indexablePages);
  const out = { ...base };
  for (const key of Object.keys(base)) out[`${key}_indexable`] = indexable[key];
  out.rows_total_count = segmentPages.length;
  out.rows_indexable_count = indexablePages.length;
  return out;
}

function buildFiveRowGroup(prefix) {
  return [
    policyRow(`${prefix}/neutral-a`, PERIOD_POST, 10, 100, null),
    policyRow(`${prefix}/neutral-b`, PERIOD_POST, 10, 100, null),
    policyRow(`${prefix}/policy-pre`, PERIOD_PRE, 10, 100),
    policyRow(`${prefix}/policy-straddle`, PERIOD_STRADDLE, 10, 100),
    policyRow(`${prefix}/policy-post`, PERIOD_POST, 10, 100)
  ];
}

test('sub-segment grouped fixture — per-group counts and clickPages split', () => {
  const groupA = buildFiveRowGroup('https://www.alanranger.com/group-a');
  const groupB = buildFiveRowGroup('https://www.alanranger.com/group-b');
  const aggA = aggregateSubsegmentGroup(groupA);
  const aggB = aggregateSubsegmentGroup(groupB);

  assert.equal(aggA.rows_total_count, 5);
  assert.equal(aggB.rows_total_count, 5);
  assert.equal(aggA.rows_indexable_count, 3);
  assert.equal(aggB.rows_indexable_count, 3);
  assert.equal(aggA.clickPages, 5);
  assert.equal(aggA.clickPages_indexable, 3);
  assert.ok(aggA.clickPages_indexable < aggA.clickPages);
  assert.equal(aggA.clicks, 50);
  assert.equal(aggB.clickPages_indexable, 3);

  console.log('PASS  sub-segment groupA rows_total=5 rows_indexable=3 clickPages_indexable=3');
  console.log('PASS  sub-segment groupB rows_total=5 rows_indexable=3 clickPages_indexable=3');
});

test('page-level aggregate fixture — clicks_indexable < clicks', () => {
  const rows = buildFiveRowGroup('https://www.alanranger.com/page-level');
  const base = computeSegmentMetrics(rows);
  const out = appendIndexableSegmentMetrics(base, rows);

  assert.equal(out.rows_total_count, 5);
  assert.equal(out.rows_indexable_count, 3);
  assert.equal(out.clicks_28d, 50);
  assert.equal(out.clicks_28d_indexable, 30);
  assert.ok(out.clicks_28d_indexable < out.clicks_28d);

  console.log(`PASS  page-level rows_total=5 rows_indexable=3 clicks=50 clicks_indexable=30`);
});
