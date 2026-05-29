/** Live full-year forecast — seasonally adjusted YTD + current month (exec summary + signals). */

import { buildLiveSeasonalForecast } from './revenue-truth-findings.mjs';

export const YEAR_SURVIVAL = 36000;
export const YEAR_COMFORTABLE = 60000;

function currentMonthProjection(pulse) {
  const p = pulse?.projection;
  if (!p) return null;
  const blended = Number(p.blended_month_end);
  const linear = Number(p.linear_month_end);
  if (Number.isFinite(blended) && Number.isFinite(linear)) return Math.min(blended, linear);
  if (Number.isFinite(blended)) return blended;
  if (Number.isFinite(linear)) return linear;
  return null;
}

export function resolveExecYearForecast(summary, findings) {
  const year = summary?.config?.now?.year || findings?.currentYear || new Date().getUTCFullYear();
  const pulse = summary?.currentMonthPulse;
  const liveSeasonal = buildLiveSeasonalForecast(findings?.seasonal_forecast, currentMonthProjection(pulse));
  if (liveSeasonal?.total_full_year_mid != null) {
    return {
      year,
      value: liveSeasonal.total_full_year_mid,
      low: liveSeasonal.total_full_year_low,
      high: liveSeasonal.total_full_year_high,
      basis: liveSeasonal.basis || 'seasonally_adjusted',
      detail: liveSeasonal.method_label,
      section: 'rt-headline-forecast'
    };
  }
  const fi = pulse?.forecast_impact;
  const fallback = fi?.revised_forecast_primary ?? summary?.forecast?.forecastInclCurrent ?? summary?.forecast?.forecastCentral;
  if (fallback == null) return null;
  return {
    year,
    value: Number(fallback) || 0,
    basis: fi ? 'live_month_headline' : 'closed_months_run_rate',
    detail: fi?.revised_blended_label || summary?.forecast?.forecastCentralLabel || 'Headline forecast',
    section: 'rt-headline-forecast'
  };
}
