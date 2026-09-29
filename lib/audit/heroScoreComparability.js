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
 * Geo city-only day (2026-09-28) is incomparable to pin Local series for Surface/Top.
 * Checks BOTH prior and current dates/methods — city vs pin must stay separate.
 * Brand is GBP+GSC — keep real deltas. Pre-Sep28 pin history is comparable again after pin restore.
 */
export function qualifyHistoricalScoreDelta(priorDate, opts = {}) {
  const coverage = opts.coverage || null;
  const provisional = !!(opts.provisional || coverage?.provisional);
  const metric = opts.metric || 'surface';
  const applyGeoBreak = opts.applyGeoBreak != null
    ? !!opts.applyGeoBreak
    : (metric === 'surface' || metric === 'top');
  const currentDate = opts.currentDate || null;
  const priorMethod = opts.priorGeoMethod || null;
  const currentMethod = opts.currentGeoMethod || null;

  if (applyGeoBreak) {
    const cityIsland =
      isCityOnlyLocalGeoDate(priorDate) || isCityOnlyLocalGeoDate(currentDate);
    const methodsKnown = !!(priorMethod && currentMethod);
    const methodsMismatch = methodsKnown && priorMethod !== currentMethod;
    // Conservative unknown: one side city-stamped / other missing method → withhold.
    const unknownMethodFallback = !methodsKnown
      && (priorMethod === 'coventry_city_code' || currentMethod === 'coventry_city_code');
    if (cityIsland || methodsMismatch || unknownMethodFallback) {
      return {
        withhold: true,
        reason: 'geo_method_break',
        note: GEO_METHOD_BREAK_NOTE,
        provisional,
        priorDate: priorDate ? String(priorDate).slice(0, 10) : null,
        currentDate: currentDate ? String(currentDate).slice(0, 10) : null,
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
      priorDate: priorDate ? String(priorDate).slice(0, 10) : null,
    };
  }
  return {
    withhold: false,
    qualify: false,
    reason: null,
    note: null,
    provisional: false,
    priorDate: priorDate ? String(priorDate).slice(0, 10) : null,
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
