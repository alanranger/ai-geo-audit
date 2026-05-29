import test from 'node:test';
import assert from 'node:assert/strict';
import { deltaKeyForWindow, rankTopFindings } from '../lib/revenue-truth-findings-filters.mjs';

test('deltaKeyForWindow switches between nonjlr and total', () => {
  assert.equal(deltaKeyForWindow('2025->2026', false), 'nonjlr_2025_to_2026');
  assert.equal(deltaKeyForWindow('2025->2026', true), 'total_2025_to_2026');
});

test('rankTopFindings uses total deltas when includeJlr is true', () => {
  const all = [{
    unit_type: 'product',
    unit_id: 'A',
    meta: { category: 'workshop' },
    flags: [],
    series_nonjlr: { y2024: 0, y2025: 100, y2026_annualised: 150, y2026_ytd_closed: 40 },
    series_total: { y2024: 0, y2025: 100, y2026_annualised: 200, y2026_ytd_closed: 50 },
    deltas: {
      nonjlr_2025_to_2026: { delta_gbp: 50 },
      total_2025_to_2026: { delta_gbp: -20 }
    }
  }];
  const nonJlrGrowth = rankTopFindings(all, '2025->2026', 'growth', false);
  const totalDecline = rankTopFindings(all, '2025->2026', 'decline', true);
  assert.equal(nonJlrGrowth.length, 1);
  assert.equal(totalDecline.length, 1);
  assert.equal(totalDecline[0].unit_id, 'A');
});
