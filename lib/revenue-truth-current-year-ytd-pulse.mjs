/** Current Year YTD Pulse — annual projection vs annual GP survival (DEFCON). */

import { TIER_BAND_TARGETS } from './revenue-truth-ui-core.mjs';
import {
  computeDefcon,
  formatDefconLegend
} from './revenue-truth-current-month-pulse.mjs';

function round2(n) {
  return Number((Number(n) || 0).toFixed(2));
}

function fmtPlain(n) {
  return '£' + Math.abs(Number(n) || 0).toLocaleString('en-GB', { maximumFractionDigits: 0 });
}

function classifyAnnualBand(amount, annual) {
  const a = annual || TIER_BAND_TARGETS;
  if (amount >= a.thrive) return 'thrive';
  if (amount >= a.comfortable) return 'comfortable';
  if (amount >= a.survival) return 'survival';
  return 'below_survival';
}

/**
 * Build a year-level pulse parallel to Current Month Pulse.
 * Projection prefers live-month-aware forecast_impact from the month pulse.
 */
export function buildCurrentYearYtdPulse(monthly, cfg, forecast, currentMonthPulse) {
  const year = cfg?.now?.year || new Date().getUTCFullYear();
  const month = cfg?.now?.month || (new Date().getUTCMonth() + 1);
  const includeJlr = cfg?.includeJlr === true || currentMonthPulse?.include_jlr === true;
  const annual = cfg?.annualGpTargets || cfg?.annualTargets || TIER_BAND_TARGETS;
  const survival = Number(annual.survival) || TIER_BAND_TARGETS.survival;

  const closed = (monthly || []).filter((m) => m.year === year && m.isClosed);
  const ytdClosed = round2(closed.reduce((s, m) => s + (Number(m.headlineRevenue) || 0), 0));
  const bookedSoFar = Number(currentMonthPulse?.booked_nonjlr_so_far) || 0;
  const ytdActual = round2(ytdClosed + bookedSoFar);

  const fi = currentMonthPulse?.forecast_impact || null;
  const paceYear = fi?.revised_forecast != null
    ? Number(fi.revised_forecast)
    : Number(forecast?.forecastInclCurrent ?? forecast?.forecastCentral) || 0;
  const blendedYear = fi?.revised_forecast_blended != null
    ? Number(fi.revised_forecast_blended)
    : paceYear;
  const projectedYear = fi?.revised_forecast_primary != null
    ? Number(fi.revised_forecast_primary)
    : Math.min(blendedYear || paceYear, paceYear || blendedYear);

  const monthsRemaining = Math.max(0, 12 - month);
  const defconWorst = computeDefcon(paceYear || projectedYear, survival);
  const defconBest = computeDefcon(blendedYear || projectedYear, survival);
  const defcon = {
    active: true,
    ...defconWorst,
    scenario: 'worst_case',
    best_case: defconBest,
    worst_case: defconWorst,
    exec_worry: defconWorst.level >= 3,
    projected_month_end: projectedYear
  };

  const gapSurvival = round2(projectedYear - survival);
  const leadMessage = gapSurvival < 0
    ? `${year} is tracking ${fmtPlain(Math.abs(gapSurvival))} below annual survival on worst-case projection.`
    : `${year} is above annual survival on current worst-case projection.`;

  return {
    year_label: String(year),
    year,
    month,
    months_elapsed: month,
    months_remaining: monthsRemaining,
    closed_months: closed.length,
    include_jlr: includeJlr,
    ytd_closed: ytdClosed,
    ytd_actual_incl_partial: ytdActual,
    booked_current_month_so_far: bookedSoFar,
    projection: {
      worst_case_year_end: paceYear || projectedYear,
      blended_year_end: blendedYear || projectedYear,
      primary_year_end: projectedYear,
      band: classifyAnnualBand(projectedYear, {
        survival,
        comfortable: Number(annual.comfortable) || TIER_BAND_TARGETS.comfortable,
        thrive: Number(annual.thrive) || TIER_BAND_TARGETS.thrive
      })
    },
    defcon,
    annual_survival: survival,
    annual_comfortable: Number(annual.comfortable) || TIER_BAND_TARGETS.comfortable,
    annual_thrive: Number(annual.thrive) || TIER_BAND_TARGETS.thrive,
    survival_label: `Survival ${fmtPlain(survival)}/yr GP — 12 × monthly survival`,
    defcon_legend: formatDefconLegend(survival),
    lead_message: leadMessage
  };
}
