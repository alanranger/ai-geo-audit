import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPPORTUNITY_STACK,
  filterOpportunityRows,
  computeOpportunityTotals,
  sortOpportunityRowsInGroups,
  renderOpportunityStackHtml,
  setOpportunityStackState
} from '../lib/revenue-truth-opportunity-stack.mjs';
import { buildExecSummary } from '../lib/revenue-truth-exec-summary.mjs';
import { isHubInvestigateSlug } from '../lib/revenue-truth-exec-filters.mjs';

function rowCount(html) {
  return (html.match(/data-rt-opp-row="/g) || []).length;
}

function groupCount(html) {
  return (html.match(/rt-opp-group-head/g) || []).length;
}

test('renders 9 rows + 4 group headers + totals row', () => {
  const html = renderOpportunityStackHtml();
  assert.equal(rowCount(html), 9);
  assert.equal(groupCount(html), 4);
  assert.match(html, /TOTAL \(9 levers\)/);
});

test('default totals LOW £12,000, MID £24,800, HIGH £40,200', () => {
  const t = computeOpportunityTotals(OPPORTUNITY_STACK);
  assert.equal(t.low, 12000);
  assert.equal(t.mid, 24800);
  assert.equal(t.high, 40200);
  assert.match(renderOpportunityStackHtml(), /£12,000/);
  assert.match(renderOpportunityStackHtml(), /£24,800/);
  assert.match(renderOpportunityStackHtml(), /£40,200/);
});

test('filter Group A only → 4 rows and totals £6k / £11k / £16.5k', () => {
  const rows = filterOpportunityRows('group_a');
  assert.equal(rows.length, 4);
  const t = computeOpportunityTotals(rows);
  assert.equal(t.low, 6000);
  assert.equal(t.mid, 11000);
  assert.equal(t.high, 16500);
  const html = renderOpportunityStackHtml({ filter: 'group_a' });
  assert.equal(rowCount(html), 4);
  assert.match(html, /TOTAL \(4 levers\)/);
});

test('filter A + B → 6 rows and totals £9k / £18k / £28.5k', () => {
  const rows = filterOpportunityRows('ab');
  assert.equal(rows.length, 6);
  const t = computeOpportunityTotals(rows);
  assert.equal(t.low, 9000);
  assert.equal(t.mid, 18000);
  assert.equal(t.high, 28500);
});

test('filter Quick wins → 3 rows (1, 2, 5) totals £4.5k / £8.5k / £12.5k', () => {
  const rows = filterOpportunityRows('quick_wins');
  assert.deepEqual(rows.map((r) => r.id), [1, 2, 5]);
  const t = computeOpportunityTotals(rows);
  assert.equal(t.low, 4500);
  assert.equal(t.mid, 8500);
  assert.equal(t.high, 12500);
});

test('sort by MID descending within groups', () => {
  const sorted = sortOpportunityRowsInGroups(OPPORTUNITY_STACK, 'mid', 'desc');
  const b = sorted.filter((r) => r.group === 'B').map((r) => r.lever);
  const c = sorted.filter((r) => r.group === 'C').map((r) => r.lever);
  assert.match(b[0], /Academy trial-to-paid/);
  assert.match(b[1], /4th cohort/);
  assert.match(c[0], /photography-courses-coventry/);
});

test('chevron expand/collapse via render state', () => {
  setOpportunityStackState({ filter: 'all', sortCol: 'mid', sortDir: 'desc', expanded: new Set() });
  const closed = renderOpportunityStackHtml({ expanded: new Set() });
  assert.match(closed, /data-rt-opp-detail="row_1"/);
  assert.match(closed, /rt-opp-detail is-collapsed/);
  const open = renderOpportunityStackHtml({ expanded: new Set(['row_1']) });
  assert.doesNotMatch(open, /data-rt-opp-detail="row_1"[^>]*is-collapsed/);
  assert.match(open, /rt-opp-chevron is-open/);
});

test('row 1 has tier anchor for §9 scroll', () => {
  const html = renderOpportunityStackHtml();
  assert.match(html, /data-rt-opp-row="row_1"[^>]*data-tier-anchor="one_to_one_lessons"/);
});

test('column headers have one sort indicator each (no duplicate rt-sort-ind)', () => {
  const html = renderOpportunityStackHtml();
  assert.doesNotMatch(html, /rt-sort-ind/);
  const sortCols = (html.match(/rt-opp-sort-ind/g) || []).length;
  assert.equal(sortCols, 8);
});

test('exec summary hub investigate labels fixed', () => {
  assert.equal(isHubInvestigateSlug('/photography-courses-coventry'), true);
  assert.equal(isHubInvestigateSlug('hire-a-professional-photographer-in-coventry'), true);
  const ctx = {
    summary: { config: { now: { year: 2026 } }, monthly: [], headlineReconciliation: { passes: true } },
    findings: { asOf: '2026-05-01' },
    diagnosis: {
      diagnostics: [
        { page_slug: '/photography-courses-coventry', tier_key: 'courses_masterclasses', state: 'traffic_with_zero_conversion', metrics: { full_window: { impressions: 70000, clicks: 604 } } },
        { page_slug: '/hire-a-professional-photographer-in-coventry', tier_key: 'commissions', state: 'traffic_with_zero_conversion', metrics: { full_window: { impressions: 63000, clicks: 188 } } }
      ]
    },
    windowMonths: 12
  };
  const { bullets } = buildExecSummary(ctx);
  const hubs = bullets.investigate.filter((b) => b.isHub);
  assert.equal(hubs.length, 2);
  assert.match(hubs[0].sub, /Hub page — routes visitors to product pages/);
});
