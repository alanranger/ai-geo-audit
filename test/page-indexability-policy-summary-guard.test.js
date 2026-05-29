import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRowIndexable } from '../lib/page-indexability-policy.js';

const EFFECTIVE = '2025-09-15';
const SLUG = 'photographic-workshops-near-me/event-1';

function row(periodStart, clicks, policyValue = 'intentional_noindex') {
  return {
    page_url: `https://www.alanranger.com/${SLUG}`,
    clicks_28d: clicks,
    impressions_28d: clicks * 10,
    period_start: periodStart,
    policy_value: policyValue,
    policy_effective_date: EFFECTIVE
  };
}

function sumClicks(rows) {
  return rows.reduce((s, r) => s + (Number(r.clicks_28d) || 0), 0);
}

test('synthetic summary KPI split — clicks vs clicks_indexable', () => {
  const policyRows = [
    row('2025-06-01', 100),
    row('2025-07-01', 100),
    row('2025-08-01', 100),
    row('2025-09-01', 100),
    row('2025-09-01', 100),
    row('2025-10-01', 100),
    row('2025-10-01', 100),
    row('2025-11-01', 100),
    row('2025-12-01', 100),
    row('2026-01-01', 100)
  ];
  const neutralRows = Array.from({ length: 5 }, (_, i) => ({
    page_url: `https://www.alanranger.com/neutral-page-${i + 1}`,
    clicks_28d: 50,
    impressions_28d: 500,
    period_start: '2025-09-01',
    policy_value: null,
    policy_effective_date: null
  }));

  const allRows = [...policyRows, ...neutralRows];
  const indexableRows = allRows.filter(isRowIndexable);
  const clicks = sumClicks(allRows);
  const clicksIndexable = sumClicks(indexableRows);

  console.log(`rows_total_count=${allRows.length}`);
  console.log(`rows_indexable_count=${indexableRows.length} (5 neutral + 3 pre months Jun-Aug)`);
  console.log(`clicks=${clicks} clicks_indexable=${clicksIndexable}`);

  assert.equal(allRows.length, 15);
  assert.equal(indexableRows.length, 8);
  assert.equal(clicks, 1250);
  assert.equal(clicksIndexable, 550);
  assert.ok(clicksIndexable < clicks);
});
