/**
 * Shared rules for when Surface / Top-of-Page historical deltas are comparable.
 * Used by Site AI Health hero tiles, Ranking hero, and CEO weekly chips.
 */

import {
  GEO_METHOD_BREAK_DATE,
  GEO_METHOD_BREAK_NOTE,
  GEO_METHOD_CITY_ONLY_DATE,
  isCityOnlyLocalGeoDate,
  isPreGeoMethodBreakDate,
  summarizeSerpCaptureCoverage,
  formatCaptureCoverageLine,
} from '../keyword-ranking/dfs-serp-quality.js';
import { summarizeConfirmationCoverage } from '../keyword-ranking/rank-confirmation.js';

export {
  GEO_METHOD_BREAK_DATE,
  GEO_METHOD_BREAK_NOTE,
  GEO_METHOD_CITY_ONLY_DATE,
  formatCaptureCoverageLine,
  summarizeConfirmationCoverage,
  isPreGeoMethodBreakDate,
  isCityOnlyLocalGeoDate,
};

/**
 * @param {string|null|undefined} priorDate
 * @param {{ coverage?: object, provisional?: boolean, metric?: 'surface'|'top'|'brand', applyGeoBreak?: boolean, currentDate?: string|null, currentGeoMethod?: string|null, priorGeoMethod?: string|null }} [opts]
 *
 * Surface/Top: withhold when city-only island date is on either side, when
 * methods mismatch, or when comparable cohorts cannot be established
 * (partial/missing method — including later city / mixed / unknown).
 * Date-only callers (dashboard Monopoly / CEO chips) typically omit methods;
 * they still get the Sep28 either-side date rule, but later city days are
 * not detectable from dates alone unless geo_method is passed in.
 * Brand is GBP+GSC — keep real deltas.
 */
export function qualifyHistoricalScoreDelta(priorDate, opts = {}) {
  const coverage = opts.coverage || null;
  const provisional = !!(opts.provisional || coverage?.provisional);
  const metric = opts.metric || 'surface';
  const applyGeoBreak = opts.applyGeoBreak != null
    ? !!opts.applyGeoBreak
    : (metric === 'surface' || metric === 'top');
  const currentDate = opts.currentDate || null;
  const priorMethod = opts.priorGeoMethod ? String(opts.priorGeoMethod) : null;
  const currentMethod = opts.currentGeoMethod ? String(opts.currentGeoMethod) : null;
  const priorIso = priorDate ? String(priorDate).slice(0, 10) : null;
  const currentIso = currentDate ? String(currentDate).slice(0, 10) : null;

  if (applyGeoBreak) {
    const cityIsland =
      isCityOnlyLocalGeoDate(priorIso) || isCityOnlyLocalGeoDate(currentIso);
    const eitherMethod = !!(priorMethod || currentMethod);
    const bothMethods = !!(priorMethod && currentMethod);
    const methodsMismatch = bothMethods && priorMethod !== currentMethod;
    // Partial method OR any city stamp without a matching peer → cannot prove cohort.
    const cohortUnknown = eitherMethod && !bothMethods;
    const cityWithoutPeer = eitherMethod
      && (priorMethod === 'coventry_city_code' || currentMethod === 'coventry_city_code')
      && (!bothMethods || methodsMismatch);
    if (cityIsland || methodsMismatch || cohortUnknown || cityWithoutPeer) {
      return {
        withhold: true,
        reason: 'geo_method_break',
        note: GEO_METHOD_BREAK_NOTE,
        provisional,
        priorDate: priorIso,
        currentDate: currentIso,
      };
    }
  }
  if (provisional) {
    return {
      withhold: false,
      qualify: true,
      reason: 'provisional_coverage',
      note: 'Score includes legacy-unverified and/or incomplete cohorts — delta is not a verified like-for-like change.',
      provisional: true,
      priorDate: priorIso,
    };
  }
  return {
    withhold: false,
    qualify: false,
    reason: null,
    note: null,
    provisional: false,
    priorDate: priorIso,
  };
}

export function coverageFromRows(rows) {
  return summarizeSerpCaptureCoverage(rows);
}

/**
 * Build display fields for Site AI Health Surface/Top tiles.
 * Pure — safe to unit-test without DOM.
 */
export function buildSiteAiHealthScorePresentation(rollup, rows) {
  const coverage = rollup?.coverage || summarizeSerpCaptureCoverage(rows || []);
  const confirm = summarizeConfirmationCoverage(rows || []);
  const score = rollup?.overall != null && Number.isFinite(Number(rollup.overall))
    ? Math.round(Number(rollup.overall))
    : null;
  return {
    score,
    coverage,
    confirmation: confirm,
    provisional: !!(rollup?.provisional || coverage.provisional || confirm.pending_or_unknown > 0),
    coverageLine: formatCaptureCoverageLine(coverage),
    confirmationLine: confirm.pending_or_unknown > 0
      ? `${confirm.pending_or_unknown} pending/unknown confirmation · ${confirm.with_last_confirmed} with dated last-confirmed`
      : null,
    byClass: rollup?.byClass || null,
  };
}
