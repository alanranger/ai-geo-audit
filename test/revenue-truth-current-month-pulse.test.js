import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCurrentMonthPulse,
  classifyBand,
  computeDefcon,
  blendedMonthEndProjection,
  blendProjectionWeights,
  buildDefconGauge,
  isLiveMonthLeadWorry,
  liveMonthWorryText
} from '../lib/revenue-truth-current-month-pulse.mjs';
import { buildExecSummary } from '../lib/revenue-truth-exec-summary.mjs';

const bands = { survival: 3000, comfortable: 5000, thrive: 8000 };

function txn(date, amount, cat = '1. Courses/masterclasses', jlr = false) {
  const y = Number(date.slice(0, 4));
  return {
    year: y,
    txn_date: date,
    amount,
    category_label: cat,
    is_jlr: jlr,
    is_redemption: false
  };
}

describe('revenue-truth current month pulse', () => {
  it('same-day-of-month compares only through elapsed day', () => {
    const txns = [
      txn('2025-05-10', 1000),
      txn('2025-05-29', 5000),
      txn('2026-05-10', 200),
      txn('2026-05-28', 600)
    ];
    const cfg = { tierBands: bands, now: { iso: '2026-05-28T12:00:00.000Z', year: 2026, month: 5 } };
    const monthly = [{ year: 2026, month: 5, headlineRevenue: 800, isPartial: true }];
    const forecast = { forecastCentral: 56247, runRateMonthly: 5000, monthsRemaining: 8, ytdActual: 20000 };
    const pulse = buildCurrentMonthPulse(txns, cfg, monthly, forecast);
    assert.equal(pulse.booked_nonjlr_so_far, 800);
    assert.equal(pulse.comparisons.prior_year_same_month.amount, 1000);
    assert.equal(pulse.comparisons.prior_year_same_month.deltaGbp, -200);
  });

  it('flags worst month when projection below historical low', () => {
    const txns = [];
    for (let m = 1; m <= 12; m++) {
      txns.push(txn(`2024-${String(m).padStart(2, '0')}-15`, 5000));
      txns.push(txn(`2025-${String(m).padStart(2, '0')}-15`, 4000));
    }
    txns.push(txn('2026-05-20', 100));
    const cfg = { tierBands: bands, now: { iso: '2026-05-28T12:00:00.000Z', year: 2026, month: 5 } };
    const monthly = [{ year: 2026, month: 5, headlineRevenue: 100, isPartial: true }];
    const forecast = { forecastCentral: 50000, runRateMonthly: 4000, monthsRemaining: 8, ytdActual: 20000 };
    const pulse = buildCurrentMonthPulse(txns, cfg, monthly, forecast);
    assert.equal(pulse.projection.is_worst_in_history, true);
    assert.ok(pulse.projection.linear_month_end < pulse.projection.historical_low);
  });

  it('DEFCON hidden before day 5', () => {
    const cfg = { tierBands: bands, now: { iso: '2026-05-03T12:00:00.000Z', year: 2026, month: 5 } };
    const g = buildDefconGauge(3, 900);
    assert.equal(g.active, false);
    assert.match(g.placeholder, /too early/i);
  });

  it('DEFCON 4 at ~29% of survival', () => {
    const d = computeDefcon(871, 3000);
    assert.equal(d.level, 4);
    assert.equal(d.status, 'CRITICAL');
    assert.equal(d.pips, 4);
    assert.equal(d.pip_display, '●●●●○');
  });

  it('DEFCON 5 below 25% with pulse flag', () => {
    const d = computeDefcon(700, 3000);
    assert.equal(d.level, 5);
    assert.equal(d.pulse, true);
  });

  it('blend weights shift toward pace late in month', () => {
    assert.equal(blendProjectionWeights(8).pace, 0.4);
    assert.equal(blendProjectionWeights(15).pace, 0.5);
    assert.equal(blendProjectionWeights(28).pace, 0.7);
    const blend = blendedMonthEndProjection(787, 28, 31, 1200);
    assert.ok(blend > 850 && blend < 980);
  });

  it('exec summary leads with DEFCON line when level >= 3', () => {
    const pulse = {
      month_label: 'May 2026',
      defcon: {
        active: true,
        level: 4,
        status: 'CRITICAL',
        projected_month_end: 871,
        pct_of_survival: 29,
        exec_worry: true
      },
      projection: { is_worst_in_history: true },
      urgency: { lead_worry: true, score: 296000 }
    };
    assert.equal(isLiveMonthLeadWorry(pulse), true);
    assert.match(liveMonthWorryText(pulse), /DEFCON 4/);
    const out = buildExecSummary({
      summary: { currentMonthPulse: pulse, forecast: { forecastCentral: 56247 } },
      findings: null,
      diagnosis: { tier_reconciliation: { passes: true }, diagnostics: [] },
      windowMonths: 3
    });
    assert.match(out.bullets.worry[0].text, /DEFCON 4/);
  });

  it('classifies bands consistently', () => {
    assert.equal(classifyBand(900, bands), 'below_survival');
    assert.equal(classifyBand(4000, bands), 'survival');
    assert.equal(classifyBand(6000, bands), 'comfortable');
  });
});
