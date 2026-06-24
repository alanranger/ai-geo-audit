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
  liveMonthWorryText,
  priorYearSameMonthFullNonJlr,
  trailing6SameCalendarMonthAvg
} from '../lib/revenue-truth-current-month-pulse.mjs';
import { buildExecSummary } from '../lib/revenue-truth-exec-summary.mjs';
import { buildPulseRescueActions, RESCUE_PLAYBOOK } from '../lib/revenue-truth-current-month-pulse-ui.mjs';

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

  it('strips JLR from same-day last year and trailing-6 same-day avg', () => {
    const txns = [
      txn('2025-05-15', 2000, '1. Courses/masterclasses', true),
      txn('2025-05-15', 300),
      txn('2026-05-15', 400),
      txn('2026-04-15', 5000),
      txn('2026-04-15', 8000, '2. Workshops Non Residential', true),
      txn('2026-03-15', 1000)
    ];
    const cfg = { tierBands: bands, now: { iso: '2026-05-28T12:00:00.000Z', year: 2026, month: 5 } };
    const pulse = buildCurrentMonthPulse(txns, cfg, [], null);
    assert.equal(pulse.comparisons.prior_year_same_month.amount, 300);
    assert.ok(pulse.comparisons.trailing_6_same_day_avg.amount < 2000);
    assert.equal(pulse.comparisons.prior_year_same_month.basis, 'nonjlr_net');
  });

  it('includes JLR in booked-so-far when cfg.includeJlr is true', () => {
    const txns = [
      txn('2026-05-10', 600),
      txn('2026-05-12', 942, '2. Workshops Non Residential', true), // JLR
      txn('2026-05-15', 200, '1. Courses/masterclasses', false)
    ];
    const now = { iso: '2026-05-20T12:00:00.000Z', year: 2026, month: 5 };
    const excl = buildCurrentMonthPulse(txns, { tierBands: bands, now }, [], null);
    const incl = buildCurrentMonthPulse(txns, { tierBands: bands, now, includeJlr: true }, [], null);
    assert.equal(excl.booked_nonjlr_so_far, 800);   // JLR stripped (default)
    assert.equal(excl.include_jlr, false);
    assert.equal(incl.booked_nonjlr_so_far, 1742);  // JLR included via toggle
    assert.equal(incl.include_jlr, true);
  });

  it('always excludes redemptions even when includeJlr is true', () => {
    const txns = [
      txn('2026-05-10', 600),
      { ...txn('2026-05-11', 500), is_redemption: true }
    ];
    const now = { iso: '2026-05-20T12:00:00.000Z', year: 2026, month: 5 };
    const incl = buildCurrentMonthPulse(txns, { tierBands: bands, now, includeJlr: true }, [], null);
    assert.equal(incl.booked_nonjlr_so_far, 600);
  });

  it('blend anchor prefers prior-year same month non-JLR over 6yr average', () => {
    const txns = [
      txn('2024-05-20', 5000),
      txn('2025-05-20', 1000),
      txn('2026-05-20', 700)
    ];
    assert.equal(priorYearSameMonthFullNonJlr(txns, 2026, 5), 1000);
    assert.equal(trailing6SameCalendarMonthAvg(txns, 2026, 5), 3000);
    const cfg = { tierBands: bands, now: { iso: '2026-05-28T12:00:00.000Z', year: 2026, month: 5 } };
    const pulse = buildCurrentMonthPulse(txns, cfg, [], null);
    assert.equal(pulse.projection.blend_anchor, 1000);
    assert.ok(pulse.projection.blended_month_end < pulse.projection.trailing_6_same_month_avg);
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
    const g = buildDefconGauge(3, 900, 700);
    assert.equal(g.active, false);
    assert.match(g.placeholder, /too early/i);
  });

  it('DEFCON dual scenario uses worse of pace and blended', () => {
    const g = buildDefconGauge(28, 1461, 871);
    assert.equal(g.active, true);
    assert.equal(g.level, 5);
    assert.equal(g.projected_month_end, 871);
    assert.equal(g.best_case.projected_month_end, 1461);
    assert.equal(g.worst_case.projected_month_end, 871);
  });

  it('DEFCON 5 at ~29% of survival (narrowed 4–5 band)', () => {
    const d = computeDefcon(871, 3000);
    assert.equal(d.level, 5);
    assert.equal(d.status, 'EXTREME');
    assert.equal(d.pips, 5);
    assert.equal(d.pulse, true);
    assert.equal(d.pip_display, '●●●●●');
  });

  it('DEFCON 4 between 30% and 45%', () => {
    const d = computeDefcon(1200, 3000);
    assert.equal(d.level, 4);
    assert.equal(d.status, 'CRITICAL');
    assert.equal(d.pips, 4);
  });

  it('DEFCON 5 below 30% with pulse flag', () => {
    const d = computeDefcon(700, 3000);
    assert.equal(d.level, 5);
    assert.equal(d.pulse, true);
  });

  it('blend weights shift toward pace late in month', () => {
    assert.equal(blendProjectionWeights(8).pace, 0.4);
    assert.equal(blendProjectionWeights(15).pace, 0.5);
    assert.equal(blendProjectionWeights(28).pace, 0.7);
    const blend = blendedMonthEndProjection(787, 28, 31, 1058);
    assert.ok(blend > 850 && blend < 980);
  });

  it('exec summary surfaces DEFCON in tracker when level >= 3', () => {
    const pulse = {
      month_label: 'May 2026',
      year: 2026,
      month: 5,
      booked_nonjlr_so_far: 807,
      defcon: {
        active: true,
        level: 5,
        status: 'EXTREME',
        projected_month_end: 871,
        pct_of_survival: 29,
        exec_worry: true
      },
      projection: { linear_month_end: 871, blended_month_end: 927, is_worst_in_history: true },
      urgency: { lead_worry: true, score: 296000 }
    };
    assert.equal(isLiveMonthLeadWorry(pulse), true);
    assert.match(liveMonthWorryText(pulse), /DEFCON 5/);
    assert.match(liveMonthWorryText(pulse), /worst-case/i);
    const out = buildExecSummary({
      summary: {
        monthly: [
          { year: 2026, month: 3, headlineRevenue: 2800, isClosed: true },
          { year: 2026, month: 4, headlineRevenue: 2600, isClosed: true },
          { year: 2026, month: 5, headlineRevenue: 807, isPartial: true }
        ],
        config: { tierBands: bands, now: { year: 2026, month: 5 } },
        currentMonthPulse: pulse,
        forecast: { forecastCentral: 56247 }
      },
      findings: null,
      diagnosis: { tier_reconciliation: { passes: true }, diagnostics: [] },
      windowMonths: 3
    });
    assert.ok(out.tracker.rows.some((r) => r.chip?.text === 'DEFCON 5'));
    assert.ok(out.bullets.worry.some((w) => /DEFCON 5/.test(w.text)));
  });

  it('classifies bands consistently', () => {
    assert.equal(classifyBand(900, bands), 'below_survival');
    assert.equal(classifyBand(4000, bands), 'survival');
    assert.equal(classifyBand(6000, bands), 'comfortable');
  });

  it('pulse rescue chips derive from live at-risk and rank high-margin tiers first', () => {
    const diagnosis = {
      tier_rollup: [
        { tier_key: 'commissions', label: 'Commissions', pages_at_risk_gbp: 10282, revenue_trend: { y2024: { non_jlr: 7056 }, y2025: { non_jlr: 2680 }, y2026_ytd: { non_jlr: 2245 } } },
        { tier_key: 'one_to_one_lessons', label: '1-2-1 Lessons', pages_at_risk_gbp: 14157, revenue_trend: { y2024: { non_jlr: 10022 }, y2025: { non_jlr: 4330 }, y2026_ytd: { non_jlr: 1440 } } },
        { tier_key: 'courses_masterclasses', label: 'Courses / Masterclasses', pages_at_risk_gbp: 8495, revenue_trend: { y2024: { non_jlr: 5580 }, y2025: { non_jlr: 2580 }, y2026_ytd: { non_jlr: 2390 } } },
        { tier_key: 'academy', label: 'Academy', pages_at_risk_gbp: 0, revenue_trend: { y2024: { non_jlr: 757 }, y2025: { non_jlr: 1200 }, y2026_ytd: { non_jlr: 1303 } } },
        { tier_key: 'workshops_residential', label: 'Workshops Residential', pages_at_risk_gbp: 99999, revenue_trend: { y2024: { non_jlr: 100 }, y2025: { non_jlr: 50 }, y2026_ytd: { non_jlr: 10 } } }
      ]
    };
    const pulse = { include_jlr: false, tier_gaps: [{ tier_key: 'commissions', gap_gbp: -1500 }] };
    const chips = buildPulseRescueActions(diagnosis, pulse, false);
    assert.ok(chips.length >= 1 && chips.length <= 4);
    // Volatile workshop tier must never surface even with huge at-risk £.
    assert.ok(!chips.some((c) => c.tierScroll === 'workshops_residential'));
    // Highest combined score (1-2-1 £14,157 at risk) ranks first.
    assert.equal(chips[0].tierScroll, 'one_to_one_lessons');
    // Curated strategy text is attached from the playbook.
    assert.equal(chips[0].text, RESCUE_PLAYBOOK.one_to_one_lessons.headline);
    assert.ok(chips[0].measures.length >= 2);
    // Live numbers are computed and exposed for rendering.
    assert.equal(chips[0].live.at_risk_gbp, 14157);
    assert.equal(chips.find((c) => c.tierScroll === 'commissions').live.yoy_25_26 < 0, true);
  });

  it('rescue chips empty when no diagnosis supplied', () => {
    assert.deepEqual(buildPulseRescueActions(null, null, false), []);
  });
});
