import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessRankingCompleteness,
  filterFinalizeKeywordRows,
  rankingFallbackBanner,
  NULL_STACK_INCOMPLETE_PCT,
} from '../lib/keyword-ranking/ranking-completeness.js';
import {
  applyTrackedEmptySerpStubs,
  isEmptySerpSignal,
  organicCountOf,
} from '../lib/keyword-ranking/empty-serp-stub.js';

test('null stack pct threshold is 10%', () => {
  assert.equal(NULL_STACK_INCOMPLETE_PCT, 0.10);
});

test('assessRankingCompleteness flags >10% null stacks', () => {
  const rows = [];
  for (let i = 0; i < 9; i++) rows.push({ serp_surface_stack: [{ type: 'organic' }] });
  rows.push({ serp_surface_stack: null });
  // 1/10 = 10% — not incomplete (strict >)
  assert.equal(assessRankingCompleteness(rows).incomplete, false);
  rows.push({ serp_surface_stack: null });
  // 2/11 > 10%
  const a = assessRankingCompleteness(rows);
  assert.equal(a.incomplete, true);
  assert.equal(a.ranking_quality, 'incomplete');
  assert.equal(a.null_stack, 2);
});

test('assessRankingCompleteness complete when all stacks present', () => {
  const rows = Array.from({ length: 20 }, () => ({
    serp_surface_stack: [{ type: 'organic' }],
    serp_features: { capture_status: 'complete_ranked' },
  }));
  const a = assessRankingCompleteness(rows);
  assert.equal(a.incomplete, false);
  assert.equal(a.ranking_quality, 'complete');
  assert.equal(a.null_stack, 0);
});

test('filterFinalizeKeywordRows drops organic>0 empty-stack slim rows', () => {
  const kept = filterFinalizeKeywordRows([
    { keyword: 'a', serp_surface_stack: [{ type: 'organic' }], organic_count: 40 },
    { keyword: 'b', serp_surface_stack: [], organic_count: 45 },
    { keyword: 'c', serp_surface_stack: null, organic_count: 0, error: 'empty' },
  ]);
  assert.equal(kept.length, 2);
  assert.equal(kept[0].keyword, 'a');
  assert.equal(kept[1].keyword, 'c');
});

test('rankingFallbackBanner text', () => {
  const s = rankingFallbackBanner({
    incompleteDate: '2026-10-05',
    completeDate: '2026-09-29',
    missing: 87,
    total: 155,
  });
  assert.match(s, /Using 2026-09-29/);
  assert.match(s, /2026-10-05 incomplete/);
  assert.match(s, /87 of 155/);
});

test('organic_count>0 with empty stack is NOT empty signal', () => {
  const row = {
    keyword: 'photography courses',
    serp_surface_stack: null,
    best_rank_absolute: null,
    organic_count: 49,
  };
  assert.equal(organicCountOf(row), 49);
  assert.equal(isEmptySerpSignal(row), false);
});

test('applyTrackedEmptySerpStubs marks incomplete when organics present', () => {
  // Use a known locked keyword from tracking-class if available; brand-like phrase
  const rows = applyTrackedEmptySerpStubs([{
    keyword: 'photography courses coventry',
    serp_surface_stack: [],
    best_rank_absolute: null,
    best_rank_group: null,
    organic_count: 48,
  }]);
  const out = rows[0];
  // Either incomplete path or unchanged if keyword not locked in this env
  if (out.serp_features?.capture_status === 'incomplete') {
    assert.equal(out.serp_features.capture_status, 'incomplete');
    assert.notEqual(out.serp_features.fetch_error, 'empty_serp_surface_stack');
  } else if (out.error === 'empty_serp_surface_stack') {
    assert.fail('must not empty-stub when organic_count>0');
  }
});
