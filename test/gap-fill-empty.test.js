import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listFailedCaptureKeywords,
  mergeSerpRetryRows,
} from '../lib/keyword-ranking/gap-fill-empty.js';

test('listFailedCaptureKeywords picks empty/incomplete only', () => {
  const rows = [
    { keyword: 'ok one', serp_features: { capture_status: 'complete_ranked' }, best_rank_absolute: 3 },
    { keyword: 'blank a', serp_features: { capture_status: 'empty' }, best_rank_absolute: null },
    { keyword: 'BLANK A', serp_features: { capture_status: 'empty' }, best_rank_absolute: null },
    { keyword: 'thin', serp_features: { capture_status: 'incomplete' }, best_rank_absolute: null },
  ];
  assert.deepEqual(listFailedCaptureKeywords(rows), ['blank a', 'thin']);
});

test('mergeSerpRetryRows replaces by keyword', () => {
  const base = [
    { keyword: 'a', serp_features: { capture_status: 'empty' } },
    { keyword: 'b', serp_features: { capture_status: 'empty' } },
  ];
  const merged = mergeSerpRetryRows(base, [
    { keyword: 'b', serp_features: { capture_status: 'complete_ranked' }, best_rank_absolute: 2 },
  ]);
  assert.equal(merged[0].serp_features.capture_status, 'empty');
  assert.equal(merged[1].best_rank_absolute, 2);
});
