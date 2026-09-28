import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSurfaceVisibilityRollup } from '../lib/audit/surfaceScores.js';
import { computeTopOfPageRollup } from '../lib/audit/topOfPage.js';
import {
  qualifyHistoricalScoreDelta,
  buildSiteAiHealthScorePresentation,
  GEO_METHOD_BREAK_DATE,
} from '../lib/audit/heroScoreComparability.js';
import { EMPTY_SERP_STUB_ERROR } from '../lib/keyword-ranking/dfs-serp-quality.js';

function moneyRow(keyword, opts = {}) {
  return {
    keyword,
    keyword_class: opts.cls || 'national-money',
    search_volume: opts.vol ?? 50,
    best_rank_group: opts.rank ?? 1,
    serp_surface_stack: opts.stack === null ? null : (opts.stack ?? [
      { type: 'organic', slot: 1, ours: true, our_position: 1 },
    ]),
    serp_features: Object.prototype.hasOwnProperty.call(opts, 'feats')
      ? opts.feats
      : { capture_status: 'complete_ranked' },
    error: opts.error,
    crawl_incomplete: opts.crawl_incomplete,
  };
}

test('Site AI Health presentation: mixed legacy/new/failed is provisional with coverage', () => {
  const rows = [
    moneyRow('photography gift card', { feats: { capture_status: 'complete_ranked' } }),
    moneyRow('legacy kw', {
      rank: 5,
      feats: {}, // no capture_status → legacy_unverified
    }),
    moneyRow('empty stub', {
      rank: null,
      stack: null,
      feats: { capture_status: 'empty', stub: true, fetch_error: EMPTY_SERP_STUB_ERROR },
      error: EMPTY_SERP_STUB_ERROR,
    }),
  ];
  const surface = computeSurfaceVisibilityRollup(rows);
  const top = computeTopOfPageRollup(rows);
  assert.equal(surface.coverage.tracked, 3);
  assert.equal(surface.coverage.measurable, 2);
  assert.equal(surface.coverage.failed, 1);
  assert.equal(surface.provisional, true);
  assert.equal(top.coverage.failed, 1);
  assert.equal(surface.perKeyword.length, 2);
  assert.equal(top.perKeyword.length, 2);

  const present = buildSiteAiHealthScorePresentation(surface, rows);
  assert.equal(present.provisional, true);
  assert.ok(present.score != null);
  assert.match(present.coverageLine, /measured of 3 tracked/);
  assert.match(present.coverageLine, /provisional/);
});

test('historical Surface/Top delta withheld before pin→city break', () => {
  const q = qualifyHistoricalScoreDelta('2026-09-14', {
    coverage: { provisional: true, tracked: 155, measurable: 152, failed: 3 },
  });
  assert.equal(q.withhold, true);
  assert.equal(q.reason, 'geo_method_break');
  assert.ok(String(q.note || '').toLowerCase().includes('pin'));

  const ok = qualifyHistoricalScoreDelta(GEO_METHOD_BREAK_DATE, {
    coverage: { provisional: false, tracked: 10, measurable: 10, failed: 0, legacy_unverified: 0 },
  });
  assert.equal(ok.withhold, false);

  const prov = qualifyHistoricalScoreDelta('2026-09-29', {
    coverage: { provisional: true, tracked: 10, measurable: 8, failed: 2 },
  });
  assert.equal(prov.withhold, false);
  assert.equal(prov.qualify, true);
});

test('stale snapshot fallback: empty-stack audit rows still exclude failed empties from mean', () => {
  // Mimic audit rankingAiData without capture_status on most rows + empty stubs
  const auditLike = [
    moneyRow('a', { feats: {}, rank: 2 }),
    moneyRow('b', { feats: {}, rank: 8, cls: 'local-money' }),
    {
      keyword: 'c empty',
      keyword_class: 'local-money',
      search_volume: 70,
      best_rank_group: null,
      best_rank_absolute: null,
      serp_surface_stack: null,
      serp_features: { stub: true, fetch_error: EMPTY_SERP_STUB_ERROR },
      error: EMPTY_SERP_STUB_ERROR,
    },
  ];
  const surf = computeSurfaceVisibilityRollup(auditLike);
  const top = computeTopOfPageRollup(auditLike);
  assert.equal(surf.coverage.failed, 1);
  assert.equal(surf.coverage.legacy_unverified, 2);
  assert.equal(surf.provisional, true);
  assert.equal(top.perKeyword.length, 2);
  // Score stays defined from measurable legacy rows — not fabricated from empties
  assert.ok(Number.isFinite(surf.overall));
  assert.ok(Number.isFinite(top.overall));
});
