/**
 * Ranking reliability: geo method isolation, confirmation state machine,
 * spend caps — fixture/mock only (no paid DFS).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveLocalCaptureFields,
  preflightLocalCapture,
  stampLocalCaptureOnRow,
  EXPECTED_PIN_PREFIX,
} from '../lib/keyword-ranking/local-capture-preflight.js';
import {
  GEO_METHOD_GBP_PIN,
  GEO_METHOD_CITY_CODE,
  GEO_METHOD_NATIONAL,
  GEO_METHOD_CITY_ONLY_DATE,
  METHOD_VERSION_LOCAL_PIN,
  isCityOnlyLocalGeoDate,
  isPreGeoMethodBreakDate,
  geoMethodsComparable,
  resolveGeoMethod,
  buildSerpCaptureFeatures,
  CAPTURE_STATUS,
} from '../lib/keyword-ranking/dfs-serp-quality.js';
import {
  isSignificantWorsening,
  resolveConfirmationState,
  buildConfirmationFeatures,
  summarizeConfirmationCoverage,
  CONFIRM_STATE,
} from '../lib/keyword-ranking/rank-confirmation.js';
import { createDfsSpendTracker, getDfsSpendLimits, estimateDfsCallCost } from '../lib/keyword-ranking/dfs-spend-limits.js';
import { buildBaselinesMap } from '../lib/keyword-ranking/load-rank-baselines.js';
import { qualifyHistoricalScoreDelta } from '../lib/audit/heroScoreComparability.js';

const PIN = '52.3991769,-1.5937149,14z';

function pinRow(rank, extra = {}) {
  return {
    keyword: extra.keyword || 'photography classes',
    best_rank_group: rank,
    best_rank_absolute: rank,
    best_url: 'https://www.alanranger.com/x',
    audit_date: extra.audit_date || '2026-09-21',
    location_code: 9215523,
    location_coordinate: PIN,
    serp_features: {
      capture_status: CAPTURE_STATUS.COMPLETE_RANKED,
      geo_method: GEO_METHOD_GBP_PIN,
      method_version: METHOD_VERSION_LOCAL_PIN,
      ...(extra.feats || {}),
    },
    ...extra,
  };
}

function cityRow(rank, extra = {}) {
  return {
    keyword: extra.keyword || 'photography classes',
    best_rank_group: rank,
    best_url: 'https://www.alanranger.com/x',
    audit_date: extra.audit_date || GEO_METHOD_CITY_ONLY_DATE,
    location_code: 9215523,
    location_coordinate: null,
    serp_features: {
      capture_status: rank == null ? CAPTURE_STATUS.COMPLETE_NO_MATCH : CAPTURE_STATUS.COMPLETE_RANKED,
      geo_method: GEO_METHOD_CITY_CODE,
      method_version: 'local_city_code_v1',
      ...(extra.feats || {}),
    },
    ...extra,
  };
}

function nationalRow(rank, extra = {}) {
  return {
    keyword: extra.keyword || 'photography vouchers',
    best_rank_group: rank,
    audit_date: extra.audit_date || '2026-09-21',
    location_code: 2826,
    location_coordinate: null,
    serp_features: {
      capture_status: rank == null ? CAPTURE_STATUS.COMPLETE_NO_MATCH : CAPTURE_STATUS.COMPLETE_RANKED,
      geo_method: GEO_METHOD_NATIONAL,
      ...(extra.feats || {}),
    },
    ...extra,
  };
}

test('old pin / current city isolation — never mix or relabel', () => {
  const old = pinRow(1);
  const cur = cityRow(null);
  assert.equal(resolveGeoMethod(old), GEO_METHOD_GBP_PIN);
  assert.equal(resolveGeoMethod(cur), GEO_METHOD_CITY_CODE);
  assert.equal(geoMethodsComparable(old, cur), false);
  assert.equal(isSignificantWorsening(old, cur), false);

  const stamped = stampLocalCaptureOnRow({
    keyword: 'beginners photography courses coventry',
    location_code: 9215523,
    location_coordinate: null,
    serp_features: { geo_method: GEO_METHOD_CITY_CODE, method_version: 'local_city_code_v1' },
  });
  assert.equal(stamped.location_coordinate, null);
  assert.equal(stamped.serp_features.geo_method, GEO_METHOD_CITY_CODE);
});

test('primary Local preflight restores verified GBP pin (not guessed)', () => {
  const meta = resolveLocalCaptureFields('beginners photography courses coventry');
  assert.equal(meta.tier, 'L');
  assert.ok(String(meta.location_coordinate || '').startsWith(EXPECTED_PIN_PREFIX));
  assert.equal(meta.geo_method, GEO_METHOD_GBP_PIN);
  assert.equal(meta.method_version, METHOD_VERSION_LOCAL_PIN);
  const pf = preflightLocalCapture(['beginners photography courses coventry']);
  assert.equal(pf.ok, true);
  assert.ok(String(pf.pin || '').startsWith(EXPECTED_PIN_PREFIX));

  const cityPf = preflightLocalCapture(['beginners photography courses coventry'], { forceCityCode: true });
  assert.equal(cityPf.ok, true);
  assert.equal(cityPf.pin, null);
  assert.equal(cityPf.geo_method, GEO_METHOD_CITY_CODE);
});

test('national unchanged — mapped other locations correct', () => {
  const n = resolveLocalCaptureFields('photography vouchers');
  assert.notEqual(n.tier, 'L');
  assert.equal(n.location_coordinate, null);
  const feats = buildSerpCaptureFeatures({}, {
    capture_status: CAPTURE_STATUS.COMPLETE_RANKED,
    location_code: 2826,
    location_coordinate: null,
    best_rank_group: 1,
  });
  assert.equal(feats.geo_method, GEO_METHOD_NATIONAL);
  assert.equal(feats.method_version, 'national_uk_v1');
});

test('transient top1-null-top1 → unconfirmed_unstable; never picks best', () => {
  const baseline = pinRow(1);
  const primary = pinRow(null, {
    serp_features: {
      capture_status: CAPTURE_STATUS.COMPLETE_NO_MATCH,
      geo_method: GEO_METHOD_GBP_PIN,
    },
  });
  primary.best_rank_group = null;
  const confirm = pinRow(1);
  const resolved = resolveConfirmationState(baseline, primary, confirm);
  assert.equal(resolved.state, CONFIRM_STATE.UNCONFIRMED_UNSTABLE);
  const feats = buildConfirmationFeatures({}, {
    state: resolved.state,
    baseline,
    primary,
    confirmation: confirm,
  });
  assert.equal(feats.last_confirmed_rank_group, 1);
  assert.equal(feats.last_confirmed_at, '2026-09-21');
  assert.equal(feats.best_rank_group, undefined);
});

test('conflicting fuller captures (national mixed) stay unconfirmed', () => {
  const baseline = nationalRow(1);
  const primary = nationalRow(null);
  primary.best_rank_group = null;
  const confirm = nationalRow(1);
  const resolved = resolveConfirmationState(baseline, primary, confirm);
  assert.equal(resolved.state, CONFIRM_STATE.UNCONFIRMED_UNSTABLE);
});

test('consistent drop across primary+confirm → confirmed_change', () => {
  const baseline = pinRow(2);
  const primary = pinRow(null);
  primary.best_rank_group = null;
  primary.serp_features.capture_status = CAPTURE_STATUS.COMPLETE_NO_MATCH;
  const confirm = pinRow(null);
  confirm.best_rank_group = null;
  confirm.serp_features.capture_status = CAPTURE_STATUS.COMPLETE_NO_MATCH;
  const resolved = resolveConfirmationState(baseline, primary, confirm);
  assert.equal(resolved.state, CONFIRM_STATE.CONFIRMED_CHANGE);
  assert.equal(isSignificantWorsening(baseline, primary), true);
});

test('thin/failed primary → unknown; not treated as absence loss', () => {
  const baseline = pinRow(1);
  const primary = {
    best_rank_group: null,
    location_code: 9215523,
    location_coordinate: PIN,
    serp_features: {
      capture_status: CAPTURE_STATUS.INCOMPLETE,
      geo_method: GEO_METHOD_GBP_PIN,
      crawl_incomplete: true,
    },
    crawl_incomplete: true,
  };
  const resolved = resolveConfirmationState(baseline, primary, null);
  assert.equal(resolved.state, CONFIRM_STATE.UNKNOWN);
  assert.equal(isSignificantWorsening(baseline, primary), false);
});

test('capped confirmation — per-run and per-keyword bounds', () => {
  const prev = process.env.DFS_CONFIRM_MAX_PER_RUN;
  const prevKw = process.env.DFS_CONFIRM_MAX_PER_KEYWORD;
  process.env.DFS_CONFIRM_MAX_PER_RUN = '2';
  process.env.DFS_CONFIRM_MAX_PER_KEYWORD = '1';
  const spend = createDfsSpendTracker(getDfsSpendLimits());
  assert.equal(spend.canConfirm(0).ok, true);
  spend.recordConfirm();
  assert.equal(spend.canConfirm(1).ok, false);
  assert.equal(spend.canConfirm(1).reason, 'confirm_per_keyword_cap');
  spend.recordConfirm();
  assert.equal(spend.canConfirm(0).ok, false);
  assert.equal(spend.canConfirm(0).reason, 'confirm_per_run_cap');
  if (prev == null) delete process.env.DFS_CONFIRM_MAX_PER_RUN;
  else process.env.DFS_CONFIRM_MAX_PER_RUN = prev;
  if (prevKw == null) delete process.env.DFS_CONFIRM_MAX_PER_KEYWORD;
  else process.env.DFS_CONFIRM_MAX_PER_KEYWORD = prevKw;
});

test('reserveAttempt prevents concurrent canAttempt overshoot', () => {
  const prev = process.env.DFS_RUN_ATTEMPT_CAP;
  process.env.DFS_RUN_ATTEMPT_CAP = '2';
  const spend = createDfsSpendTracker(getDfsSpendLimits());
  const a = spend.reserveAttempt(0.008);
  const b = spend.reserveAttempt(0.008);
  const c = spend.reserveAttempt(0.008);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(c.ok, false);
  assert.equal(c.reason, 'run_attempt_cap');
  assert.equal(spend.snapshot().attempts_used, 2);
  spend.settleAttempt(a.reserved, 0.002);
  assert.ok(spend.snapshot().cost_usd_used < 0.02);
  if (prev == null) delete process.env.DFS_RUN_ATTEMPT_CAP;
  else process.env.DFS_RUN_ATTEMPT_CAP = prev;
});

test('settleAttempt retains reservation when actual cost missing (null/blank/NaN)', () => {
  const spend = createDfsSpendTracker(getDfsSpendLimits());
  const gate = spend.reserveAttempt(0.008);
  assert.equal(gate.ok, true);
  const reservedCost = spend.snapshot().cost_usd_used;
  assert.ok(reservedCost > 0);
  // Number(null)===0 must NOT wipe the reservation.
  spend.settleAttempt(gate.reserved, null);
  assert.equal(spend.snapshot().cost_usd_used, reservedCost);
  spend.settleAttempt(gate.reserved, undefined);
  assert.equal(spend.snapshot().cost_usd_used, reservedCost);
  spend.settleAttempt(gate.reserved, '');
  assert.equal(spend.snapshot().cost_usd_used, reservedCost);
  spend.settleAttempt(gate.reserved, Number.NaN);
  assert.equal(spend.snapshot().cost_usd_used, reservedCost);
  spend.settleAttempt(gate.reserved, -1);
  assert.equal(spend.snapshot().cost_usd_used, reservedCost);
  // Finite non-negative actual replaces reservation.
  spend.settleAttempt(gate.reserved, 0.003);
  assert.equal(spend.snapshot().cost_usd_used, 0.003);
});

test('spend tracker hydrates prior snapshot across logical-run batches', () => {
  const first = createDfsSpendTracker(getDfsSpendLimits());
  first.reserveAttempt(0.008);
  first.reserveAttempt(0.008);
  const snap = first.snapshot();
  const second = createDfsSpendTracker(getDfsSpendLimits(), snap);
  assert.equal(second.snapshot().attempts_used, 2);
  assert.ok(second.snapshot().cost_usd_used > 0);
});

test('AIO expand estimate is not unsafe 0.008', () => {
  const limits = getDfsSpendLimits();
  assert.ok(limits.aio_expand_cost_est_usd >= 0.02);
  assert.notEqual(limits.aio_expand_cost_est_usd, limits.unit_cost_est_usd);
  assert.equal(estimateDfsCallCost(limits, { expandAiOverview: true }), limits.aio_expand_cost_est_usd);
  assert.equal(estimateDfsCallCost(limits, {}), limits.unit_cost_est_usd);
});

test('exhausted budget state when significant but no confirmation run', () => {
  const baseline = pinRow(1);
  const primary = pinRow(null);
  primary.best_rank_group = null;
  primary.serp_features.capture_status = CAPTURE_STATUS.COMPLETE_NO_MATCH;
  const resolved = resolveConfirmationState(baseline, primary, null, { budgetExhausted: true });
  assert.equal(resolved.state, CONFIRM_STATE.EXHAUSTED_BUDGET);
});

test('persistence/readback — confirmation + method fields survive feature build', () => {
  const feats = buildSerpCaptureFeatures({ local_pack: true }, {
    capture_status: CAPTURE_STATUS.COMPLETE_NO_MATCH,
    location_code: 9215523,
    location_coordinate: PIN,
    geo_method: GEO_METHOD_GBP_PIN,
    method_version: METHOD_VERSION_LOCAL_PIN,
    confirmation_state: CONFIRM_STATE.CONFIRMED_CHANGE,
    last_confirmed_rank_group: 1,
    last_confirmed_at: '2026-09-21',
    last_confirmed_geo_method: GEO_METHOD_GBP_PIN,
    confirmation_observations: [{ role: 'primary', best_rank_group: null }],
    best_rank_group: null,
  });
  assert.equal(feats.geo_method, GEO_METHOD_GBP_PIN);
  assert.equal(feats.method_version, METHOD_VERSION_LOCAL_PIN);
  assert.equal(feats.confirmation_state, CONFIRM_STATE.CONFIRMED_CHANGE);
  assert.equal(feats.last_confirmed_rank_group, 1);
  assert.equal(feats.capture_status, CAPTURE_STATUS.COMPLETE_NO_MATCH);
});

test('legacy rows without capture_status still usable as baseline when ranked', () => {
  const legacy = {
    keyword: 'photography classes',
    best_rank_group: 1,
    location_code: 9215523,
    location_coordinate: PIN,
    audit_date: '2026-09-14',
    serp_features: {},
  };
  const map = buildBaselinesMap([legacy, cityRow(1, { keyword: 'photography classes' })], {
    preferGeoMethod: GEO_METHOD_GBP_PIN,
  });
  assert.ok(map['photography classes']);
  assert.equal(map['photography classes'].best_rank_group, 1);
  assert.notEqual(resolveGeoMethod(map['photography classes']), GEO_METHOD_CITY_CODE);
});

test('geo break: only city-only day withheld; pre-Sep28 pin history comparable again', () => {
  assert.equal(isCityOnlyLocalGeoDate('2026-09-28'), true);
  assert.equal(isCityOnlyLocalGeoDate('2026-09-14'), false);
  assert.equal(isPreGeoMethodBreakDate('2026-09-14'), false);
  const withhold = qualifyHistoricalScoreDelta('2026-09-28', {});
  assert.equal(withhold.withhold, true);
  const allow = qualifyHistoricalScoreDelta('2026-09-14', {
    coverage: { provisional: false, tracked: 10, measurable: 10, failed: 0, legacy_unverified: 0 },
  });
  assert.equal(allow.withhold, false);
  // Current city-only day vs older pin prior must also withhold (not prior-only check).
  const currentCity = qualifyHistoricalScoreDelta('2026-09-14', {
    currentDate: '2026-09-28',
    coverage: { provisional: false, tracked: 10, measurable: 10, failed: 0, legacy_unverified: 0 },
  });
  assert.equal(currentCity.withhold, true);
  // Explicit method mismatch (later city vs pin) remains separate.
  const methodMismatch = qualifyHistoricalScoreDelta('2026-09-14', {
    currentDate: '2026-09-29',
    priorGeoMethod: GEO_METHOD_GBP_PIN,
    currentGeoMethod: GEO_METHOD_CITY_CODE,
  });
  assert.equal(methodMismatch.withhold, true);
  // Partial method (later city / unknown peer) → conservative withhold.
  const partialCity = qualifyHistoricalScoreDelta('2026-09-14', {
    currentDate: '2026-09-29',
    currentGeoMethod: GEO_METHOD_CITY_CODE,
  });
  assert.equal(partialCity.withhold, true);
  // Date-only path without methods: non-Sep28 stays allowed (later city undetectable from dates).
  const dateOnlyLater = qualifyHistoricalScoreDelta('2026-09-14', {
    currentDate: '2026-09-29',
  });
  assert.equal(dateOnlyLater.withhold, false);
  // Brand metric ignores geo break.
  const brandOk = qualifyHistoricalScoreDelta('2026-09-28', { metric: 'brand' });
  assert.equal(brandOk.withhold, false);
});

test('baselines exclude pending/unconfirmed observations', () => {
  const pending = pinRow(1, {
    feats: { confirmation_state: CONFIRM_STATE.UNCONFIRMED_UNSTABLE },
  });
  const confirmed = pinRow(2, {
    audit_date: '2026-09-14',
    feats: { confirmation_state: CONFIRM_STATE.AGREEMENT },
  });
  const map = buildBaselinesMap([pending, confirmed], { preferGeoMethod: GEO_METHOD_GBP_PIN });
  assert.equal(map['photography classes'].best_rank_group, 2);
  assert.equal(map['photography classes'].audit_date, '2026-09-14');
});

test('shared confirmation coverage summary for Ranking/Health/CEO', () => {
  const cov = summarizeConfirmationCoverage([
    pinRow(1, { feats: { confirmation_state: CONFIRM_STATE.AGREEMENT } }),
    pinRow(null, {
      feats: {
        capture_status: CAPTURE_STATUS.COMPLETE_NO_MATCH,
        confirmation_state: CONFIRM_STATE.UNCONFIRMED_UNSTABLE,
        last_confirmed_rank_group: 1,
        geo_method: GEO_METHOD_GBP_PIN,
      },
    }),
    {
      serp_features: { capture_status: CAPTURE_STATUS.INCOMPLETE, confirmation_state: CONFIRM_STATE.UNKNOWN },
      crawl_incomplete: true,
    },
  ]);
  assert.equal(cov.tracked, 3);
  assert.equal(cov.unconfirmed_unstable, 1);
  assert.equal(cov.unknown, 1);
  assert.equal(cov.with_last_confirmed, 1);
  assert.ok(cov.pending_or_unknown >= 2);
});

test('defaults for spend limits are conservative and visible', () => {
  const limits = getDfsSpendLimits();
  assert.equal(limits.run_cost_cap_usd, 2);
  assert.equal(limits.confirm_max_per_run, 12);
  assert.equal(limits.confirm_max_per_keyword, 1);
  assert.equal(limits.thin_max_attempts, 3);
  assert.ok(limits.run_attempt_cap <= 180);
});
