import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isIncompleteSerpCrawl,
  resolveSerpCaptureStatus,
  resolveCaptureQualityKind,
  isFailedSerpCapture,
  isFailedCaptureQuality,
  isCompleteSerpNoMatch,
  isMeasurableForRollup,
  summarizeSerpCaptureCoverage,
  formatCaptureCoverageLine,
  isPreGeoMethodBreakDate,
  buildSerpCaptureFeatures,
  attachLastGoodFromPrevious,
  CAPTURE_STATUS,
  CAPTURE_LEGACY_UNVERIFIED,
  SERP_CRAWL_INCOMPLETE_ERROR,
  EMPTY_SERP_STUB_ERROR,
  GEO_METHOD_BREAK_DATE,
  organicDepthLabel,
} from '../lib/keyword-ranking/dfs-serp-quality.js';
import { buildCombinedRows } from '../lib/keyword-ranking/refresh-core.js';
import { applyTrackedEmptySerpStubs, buildTrackedEmptySerpStub } from '../lib/keyword-ranking/empty-serp-stub.js';
import { computeTopOfPageRollup } from '../lib/audit/topOfPage.js';

test('full depth-50 crawl is complete', () => {
  assert.equal(isIncompleteSerpCrawl({
    depth: 50,
    organicCount: 46,
    itemsCount: 65,
    seResultsCount: 193,
    cost: 0.008,
  }), false);
});

test('thin page-1 crawl at depth 50 is incomplete (low organic + base cost)', () => {
  assert.equal(isIncompleteSerpCrawl({
    depth: 50,
    organicCount: 6,
    itemsCount: 9,
    seResultsCount: 6,
    cost: 0.002,
  }), true);
});

test('empty items is incomplete', () => {
  assert.equal(isIncompleteSerpCrawl({ depth: 50, organicCount: 0, itemsCount: 0 }), true);
});

test('shallow depth-10 with ~9 organic is not treated as depth-50 thin', () => {
  assert.equal(isIncompleteSerpCrawl({
    depth: 10,
    organicCount: 9,
    itemsCount: 13,
    seResultsCount: 192,
    cost: 0.002,
  }), false);
});

test('capture status: complete ranked vs complete no-match vs incomplete vs empty', () => {
  assert.equal(resolveSerpCaptureStatus({
    best_rank_group: 1,
    serp_surface_stack: [{ type: 'organic' }],
  }), CAPTURE_STATUS.COMPLETE_RANKED);

  assert.equal(resolveSerpCaptureStatus({
    best_rank_group: null,
    serp_surface_stack: [{ type: 'organic' }, { type: 'local_pack' }],
  }), CAPTURE_STATUS.COMPLETE_NO_MATCH);
  assert.equal(isCompleteSerpNoMatch({
    best_rank_group: null,
    serp_surface_stack: [{ type: 'organic' }],
  }), true);

  assert.equal(resolveSerpCaptureStatus({
    crawl_incomplete: true,
    best_rank_group: null,
    serp_surface_stack: [{ type: 'organic' }],
    error: SERP_CRAWL_INCOMPLETE_ERROR,
  }), CAPTURE_STATUS.INCOMPLETE);
  assert.equal(isFailedSerpCapture({ crawl_incomplete: true }), true);

  assert.equal(resolveSerpCaptureStatus({
    serp_features: { stub: true, fetch_error: EMPTY_SERP_STUB_ERROR },
    best_rank_group: null,
    serp_surface_stack: null,
  }), CAPTURE_STATUS.EMPTY);
});

test('buildSerpCaptureFeatures persists diagnostics and geo method', () => {
  const feats = buildSerpCaptureFeatures({ local_pack: true }, {
    capture_status: CAPTURE_STATUS.INCOMPLETE,
    crawl_incomplete: true,
    organic_count: 6,
    dfs_cost: 0.002,
    se_results_count: 6,
    serp_depth: 50,
    location_code: 9215523,
    location_coordinate: null,
    error: SERP_CRAWL_INCOMPLETE_ERROR,
  });
  assert.equal(feats.capture_status, 'incomplete');
  assert.equal(feats.organic_count, 6);
  assert.equal(feats.dfs_cost, 0.002);
  assert.equal(feats.serp_depth_requested, 50);
  assert.equal(feats.geo_method, 'coventry_city_code');
  assert.equal(feats.local_pack, true);
});

test('attachLastGoodFromPrevious never invents current rank fields', () => {
  const feats = attachLastGoodFromPrevious({}, {
    best_rank_group: 1,
    best_rank_absolute: 2,
    best_url: 'https://www.alanranger.com/x',
    last_refreshed_at: '2026-09-28T10:00:00.000Z',
    serp_features: { capture_status: 'complete_ranked' },
  });
  assert.equal(feats.last_good_rank_group, 1);
  assert.equal(feats.last_good_url, 'https://www.alanranger.com/x');
  assert.ok(feats.last_good_at);
  assert.equal(feats.best_rank_group, undefined);
});

test('buildCombinedRows drops failed ranks and keeps capture diagnostics', () => {
  const rows = buildCombinedRows([
    {
      keyword: 'photography gift card',
      best_rank_group: 1,
      best_rank_absolute: 1,
      best_url: 'https://www.alanranger.com/gift',
      crawl_incomplete: true,
      organic_count: 6,
      dfs_cost: 0.002,
      se_results_count: 6,
      serp_depth: 50,
      location_code: 2826,
      serp_surface_stack: [{ type: 'organic', owners: [] }],
      error: SERP_CRAWL_INCOMPLETE_ERROR,
      serp_features: { local_pack: false },
    },
    {
      keyword: 'free photography classes near me',
      best_rank_group: null,
      best_rank_absolute: null,
      best_url: null,
      crawl_incomplete: false,
      organic_count: 49,
      dfs_cost: 0.008,
      serp_depth: 50,
      location_code: 9215523,
      local_pack_position: 1,
      serp_surface_stack: [{ type: 'organic' }, { type: 'local_pack' }],
      serp_features: { local_pack: true },
    },
  ], []);

  assert.equal(rows[0].best_rank_group, null);
  assert.equal(rows[0].serp_features.capture_status, 'incomplete');
  assert.equal(rows[0].serp_features.organic_count, 6);
  assert.equal(rows[0].crawl_incomplete, true);

  assert.equal(rows[1].best_rank_group, null);
  assert.equal(rows[1].serp_features.capture_status, 'complete_no_match');
  assert.equal(rows[1].local_pack_position, 1);
  assert.equal(isFailedSerpCapture(rows[1]), false);
});

test('empty stub marks capture_status empty and is saveable marker', () => {
  const stub = buildTrackedEmptySerpStub({
    keyword: 'beginners photography courses coventry',
    best_rank_group: null,
    serp_surface_stack: [],
    location_code: 9215523,
  });
  assert.equal(stub.serp_features.capture_status, 'empty');
  assert.equal(stub.serp_features.stub, true);
  assert.equal(stub.error, EMPTY_SERP_STUB_ERROR);
  const applied = applyTrackedEmptySerpStubs([{
    keyword: 'beginners photography courses coventry',
    best_rank_group: null,
    serp_surface_stack: [],
    class_unmapped: false,
  }]);
  assert.equal(applied[0].serp_features.capture_status, 'empty');
});

test('organicDepthLabel defaults to 50', () => {
  assert.equal(organicDepthLabel({}), 50);
  assert.equal(organicDepthLabel({ serp_depth: 50 }), 50);
  assert.equal(organicDepthLabel({ serp_features: { serp_depth_requested: 50 } }), 50);
});

test('quality kind: legacy unverified vs known complete vs empty stub', () => {
  assert.equal(resolveCaptureQualityKind({
    best_rank_group: 22,
    serp_surface_stack: [{ type: 'organic' }],
  }), CAPTURE_LEGACY_UNVERIFIED);
  assert.equal(resolveCaptureQualityKind({
    best_rank_group: 1,
    serp_surface_stack: [{ type: 'organic' }],
    serp_features: { capture_status: 'complete_ranked' },
  }), CAPTURE_STATUS.COMPLETE_RANKED);
  assert.equal(resolveCaptureQualityKind({
    best_rank_group: null,
    serp_surface_stack: null,
    serp_features: { stub: true, fetch_error: EMPTY_SERP_STUB_ERROR },
  }), CAPTURE_STATUS.EMPTY);
  assert.equal(isFailedCaptureQuality({
    serp_features: { stub: true, fetch_error: EMPTY_SERP_STUB_ERROR },
  }), true);
  assert.equal(isMeasurableForRollup({
    best_rank_group: 22,
    serp_surface_stack: [{ type: 'organic' }],
  }), true);
  assert.equal(isMeasurableForRollup({
    serp_features: { capture_status: 'empty', stub: true },
  }), false);
});

test('coverage summary + geo break date', () => {
  const cov = summarizeSerpCaptureCoverage([
    { keyword: 'a', best_rank_group: 1, serp_surface_stack: [{ type: 'organic' }], serp_features: { capture_status: 'complete_ranked' } },
    { keyword: 'b', best_rank_group: 22, serp_surface_stack: [{ type: 'organic' }] },
    { keyword: 'c', serp_features: { stub: true, fetch_error: EMPTY_SERP_STUB_ERROR }, best_rank_group: null, serp_surface_stack: null },
    { keyword: 'd', crawl_incomplete: true, best_rank_group: null, serp_surface_stack: [{ type: 'organic' }], serp_features: { capture_status: 'incomplete' } },
  ]);
  assert.equal(cov.tracked, 4);
  assert.equal(cov.measurable, 2);
  assert.equal(cov.known_complete, 1);
  assert.equal(cov.legacy_unverified, 1);
  assert.equal(cov.failed, 2);
  assert.equal(cov.provisional, true);
  assert.match(formatCaptureCoverageLine(cov), /2 measured of 4 tracked/);
  assert.equal(isPreGeoMethodBreakDate('2026-09-14'), false);
  assert.equal(isPreGeoMethodBreakDate(GEO_METHOD_BREAK_DATE), true);
  assert.equal(isPreGeoMethodBreakDate('2026-09-28'), true);
});

test('Top-of-Page rollup excludes empty/incomplete from mean and keeps coverage', () => {
  const rollup = computeTopOfPageRollup([
    {
      keyword: 'photography gift card',
      keyword_class: 'national-money',
      search_volume: 50,
      best_rank_group: 1,
      serp_surface_stack: [{ type: 'organic', slot: 1, ours: true, our_position: 1 }],
      serp_features: { capture_status: 'complete_ranked' },
    },
    {
      keyword: 'beginners photography courses coventry',
      keyword_class: 'local-money',
      search_volume: 70,
      best_rank_group: null,
      serp_surface_stack: null,
      serp_features: { capture_status: 'empty', stub: true, fetch_error: EMPTY_SERP_STUB_ERROR },
    },
  ]);
  assert.equal(rollup.coverage.tracked, 2);
  assert.equal(rollup.coverage.measurable, 1);
  assert.equal(rollup.coverage.failed, 1);
  assert.equal(rollup.provisional, true);
  assert.equal(rollup.perKeyword.length, 1);
  assert.equal(rollup.perKeyword[0].keyword, 'photography gift card');
  assert.ok(rollup.overall > 0);
});
