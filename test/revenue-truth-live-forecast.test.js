import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveSeasonalForecast } from '../lib/revenue-truth-findings.mjs';
import { resolveExecYearForecast } from '../lib/revenue-truth-live-forecast.mjs';

describe('revenue-truth live forecast', () => {
  it('extends seasonal forecast with current-month blended projection', () => {
    const seasonal = {
      closed_months_current_year: 4,
      total_full_year_mid: 55000,
      forecast_per_category: [
        {
          ytd_closed_nonjlr: 16000,
          monthly_weights: [0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.1, 0.09, 0.08, 0.07]
        },
        {
          ytd_closed_nonjlr: 4000,
          monthly_weights: [0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.1, 0.09, 0.09]
        }
      ]
    };
    const live = buildLiveSeasonalForecast(seasonal, 900);
    assert.ok(live);
    assert.equal(live.basis, 'incl_current_month');
    assert.ok(live.total_full_year_mid > seasonal.total_full_year_mid * 0.85);
    assert.ok(live.total_full_year_mid < seasonal.total_full_year_mid * 1.15);
  });

  it('resolveExecYearForecast prefers live seasonal over closed-month run-rate', () => {
    const summary = {
      config: { now: { year: 2026 } },
      forecast: { forecastCentral: 55348 },
      currentMonthPulse: {
        projection: { blended_month_end: 863, linear_month_end: 863 },
        forecast_impact: { revised_forecast_primary: 51598 }
      }
    };
    const findings = {
      currentYear: 2026,
      seasonal_forecast: {
        closed_months_current_year: 4,
        total_full_year_mid: 52000,
        total_full_year_low: 46800,
        total_full_year_high: 57200,
        method_label: 'Seasonal base',
        forecast_per_category: [{
          ytd_closed_nonjlr: 18000,
          monthly_weights: [0.06, 0.07, 0.08, 0.09, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.05, 0.05]
        }]
      }
    };
    const out = resolveExecYearForecast(summary, findings);
    assert.equal(out.basis, 'incl_current_month');
    assert.notEqual(out.value, 55348);
    assert.notEqual(out.value, 51598);
  });
});
