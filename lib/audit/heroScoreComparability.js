/**
 * Shared rules for when Surface / Top-of-Page historical deltas are comparable.
 * Used by Site AI Health hero tiles, Ranking hero, and CEO weekly chips.
 */

import {
  GEO_METHOD_BREAK_DATE,
  GEO_METHOD_BREAK_NOTE,
  isPreGeoMethodBreakDate,
  summarizeSerpCaptureCoverage,
  formatCaptureCoverageLine,
} from '../keyword-ranking/dfs-serp-quality.js';

export { GEO_METHOD_BREAK_DATE, GEO_METHOD_BREAK_NOTE, formatCaptureCoverageLine };

/**
 * @param {string|null|undefined} priorDate
 * @param {{ coverage?: object, provisional?: boolean }} [opts]
 */
export function qualifyHistoricalScoreDelta(priorDate, opts = {}) {
  const coverage = opts.coverage || null;
  const provisional = !!(opts.provisional || coverage?.provisional);
  if (isPreGeoMethodBreakDate(priorDate)) {
    return {
      withhold: true,
      reason: 'geo_method_break',
      note: GEO_METHOD_BREAK_NOTE,
      provisional,
      priorDate: priorDate ? String(priorDate).slice(0, 10) : null,
    };
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
  const score = rollup?.overall != null && Number.isFinite(Number(rollup.overall))
    ? Math.round(Number(rollup.overall))
    : null;
  return {
    score,
    coverage,
    provisional: !!(rollup?.provisional || coverage.provisional),
    coverageLine: formatCaptureCoverageLine(coverage),
    byClass: rollup?.byClass || null,
  };
}
