/** D23 — Current Month Pulse (evidence-or-silence). */

import { TIER_DEFINITIONS, tierFromBookingCategory } from './revenue-tier-mapping.js';
import { pctChange } from './revenue-truth-gsc-deltas.mjs';
import { sumRecurringForMonth } from './revenue-truth-recurring-baseline.mjs';
import {
  EXEC_SUMMARY_TIER_KEYS,
  passesExecDiagGate,
  execSeasonalImpressionDelta
} from './revenue-truth-exec-filters.mjs';
import { VOLATILE_TIER_KEYS } from './revenue-truth-ui-core.mjs';

export function classifyBand(amount, bands) {
  const b = bands || { survival: 3000, comfortable: 5000, thrive: 8000 };
  if (amount >= b.thrive) return 'thrive';
  if (amount >= b.comfortable) return 'comfortable';
  if (amount >= b.survival) return 'survival';
  return 'below_survival';
}

function round2(n) { return Number((Number(n) || 0).toFixed(2)); }

function monthOfIso(iso) { return Number(String(iso || '').slice(5, 7)); }

function dayOfIso(iso) { return Number(String(iso || '').slice(8, 10)); }

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthName(year, month) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function isCountableTxn(t) {
  return !t.is_jlr && !t.is_redemption;
}

function sumNonJlrThroughDay(txns, year, month, maxDay) {
  let s = 0;
  for (const t of txns) {
    if (!isCountableTxn(t)) continue;
    if (Number(t.year) !== year) continue;
    if (monthOfIso(t.txn_date) !== month) continue;
    if (dayOfIso(t.txn_date) > maxDay) continue;
    s += Number(t.amount) || 0;
  }
  return round2(s);
}

function shiftMonth(year, month, delta) {
  let y = year;
  let m = month + delta;
  while (m <= 0) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return { year: y, month: m };
}

function trailing6SameDayAvg(txns, year, month, maxDay) {
  const vals = [];
  for (let i = 1; i <= 6; i++) {
    const p = shiftMonth(year, month, -i);
    vals.push(sumNonJlrThroughDay(txns, p.year, p.month, maxDay));
  }
  return vals.length ? round2(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
}

/** Full-month non-JLR total for one calendar month. */
function sumNonJlrFullMonth(txns, year, month) {
  let s = 0;
  for (const t of txns) {
    if (!isCountableTxn(t)) continue;
    if (Number(t.year) !== year) continue;
    if (monthOfIso(t.txn_date) !== month) continue;
    s += Number(t.amount) || 0;
  }
  return round2(s);
}

/** Trailing 6 occurrences of the same calendar month (full month totals). */
export function trailing6SameCalendarMonthAvg(txns, year, month) {
  const vals = [];
  for (let i = 1; i <= 6; i++) {
    vals.push(sumNonJlrFullMonth(txns, year - i, month));
  }
  const nonzero = vals.filter((v) => v > 0);
  return nonzero.length ? round2(nonzero.reduce((a, b) => a + b, 0) / nonzero.length) : round2(vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length));
}

/** Prior calendar year same month — primary non-JLR blend anchor (avoids stale strong years). */
export function priorYearSameMonthFullNonJlr(txns, year, month) {
  return sumNonJlrFullMonth(txns, year - 1, month);
}

/** Monotonic blend: early month trusts history; late month trusts pace. */
export function blendProjectionWeights(dayOfMonth) {
  if (dayOfMonth <= 10) return { trailing: 0.6, pace: 0.4 };
  if (dayOfMonth <= 20) return { trailing: 0.5, pace: 0.5 };
  return { trailing: 0.3, pace: 0.7 };
}

export function paceMonthEndProjection(actualSoFar, dayElapsed, daysInMonth) {
  if (!dayElapsed) return 0;
  return round2((actualSoFar / dayElapsed) * daysInMonth);
}

export function blendedMonthEndProjection(actualSoFar, dayElapsed, daysInMonth, trailingMonthAvg) {
  const w = blendProjectionWeights(dayElapsed);
  const pace = paceMonthEndProjection(actualSoFar, dayElapsed, daysInMonth);
  return round2(w.trailing * trailingMonthAvg + w.pace * pace);
}

export const DEFCON_SURVIVAL_LINE = 3000;

const DEFCON_META = [
  { level: 5, label: 'EXTREME', minPct: 0, maxPct: 30, colour: '#dc2626', pips: 5, pulse: true },
  { level: 4, label: 'CRITICAL', minPct: 30, maxPct: 45, colour: '#ef4444', pips: 4, pulse: false },
  { level: 3, label: 'SEVERE', minPct: 45, maxPct: 75, colour: '#f59e0b', pips: 3, pulse: false },
  { level: 2, label: 'WARNING', minPct: 75, maxPct: 100, colour: '#eab308', pips: 2, pulse: false },
  { level: 1, label: 'STABLE', minPct: 100, maxPct: Infinity, colour: '#22c55e', pips: 1, pulse: false }
];

export function computeDefcon(projectedMonthEnd, survivalLine = DEFCON_SURVIVAL_LINE) {
  const projected = Number(projectedMonthEnd) || 0;
  const survival = Number(survivalLine) || DEFCON_SURVIVAL_LINE;
  const pctOfSurvival = survival > 0 ? round2((projected / survival) * 100) : 0;
  const missGbp = round2(survival - projected);
  let meta = DEFCON_META[4];
  if (pctOfSurvival < 30) meta = DEFCON_META[0];
  else if (pctOfSurvival < 45) meta = DEFCON_META[1];
  else if (pctOfSurvival < 75) meta = DEFCON_META[2];
  else if (pctOfSurvival < 100) meta = DEFCON_META[3];
  return {
    level: meta.level,
    status: meta.label,
    colour: meta.colour,
    pips: meta.pips,
    pulse: meta.pulse === true,
    pct_of_survival: pctOfSurvival,
    projected_month_end: projected,
    survival_line: survival,
    miss_vs_survival_gbp: missGbp,
    pip_display: '●'.repeat(meta.pips) + '○'.repeat(5 - meta.pips)
  };
}

export function buildDefconGauge(dayElapsed, blendedProjection, paceProjection, survivalLine = DEFCON_SURVIVAL_LINE) {
  if (dayElapsed < 5) {
    return {
      active: false,
      placeholder: 'Insufficient data — too early for projection (DEFCON from day 5).'
    };
  }
  const best = computeDefcon(blendedProjection, survivalLine);
  const worst = computeDefcon(paceProjection, survivalLine);
  const overall = worst.level >= best.level ? worst : best;
  return {
    active: true,
    ...overall,
    scenario: 'worst_case',
    best_case: best,
    worst_case: worst,
    exec_worry: overall.level >= 3
  };
}

function monthlyNonJlrTotals(txns) {
  const map = new Map();
  for (const t of txns) {
    if (!isCountableTxn(t)) continue;
    const y = Number(t.year);
    const m = monthOfIso(t.txn_date);
    const k = `${y}|${m}`;
    map.set(k, round2((map.get(k) || 0) + (Number(t.amount) || 0)));
  }
  return map;
}

function tierSoFar(txns, year, month, maxDay) {
  const out = new Map();
  for (const t of txns) {
    if (!isCountableTxn(t)) continue;
    if (Number(t.year) !== year) continue;
    if (monthOfIso(t.txn_date) !== month) continue;
    if (dayOfIso(t.txn_date) > maxDay) continue;
    const tier = tierFromBookingCategory(t.category_label);
    if (!tier) continue;
    out.set(tier, round2((out.get(tier) || 0) + (Number(t.amount) || 0)));
  }
  return out;
}

function compareMetric(actual, baseline) {
  const deltaGbp = round2(actual - baseline);
  const deltaPct = pctChange(actual, baseline);
  return { amount: baseline, deltaGbp, deltaPct };
}

export function buildCurrentMonthPulse(txns, cfg, monthly, forecast, seasonalityByProduct = new Map()) {
  const now = cfg?.now || {};
  const year = now.year || new Date().getUTCFullYear();
  const month = now.month || (new Date().getUTCMonth() + 1);
  const today = new Date(now.iso || Date.now());
  const dim = daysInMonth(year, month);
  const dayElapsed = Math.min(dim, today.getUTCDate());
  const daysRemaining = Math.max(0, dim - dayElapsed);

  const bookedSoFar = sumNonJlrThroughDay(txns, year, month, dayElapsed);
  const priorYearSameDay = sumNonJlrThroughDay(txns, year - 1, month, dayElapsed);
  const priorYearSameMonthFull = priorYearSameMonthFullNonJlr(txns, year, month);
  const trailing6Avg = trailing6SameDayAvg(txns, year, month, dayElapsed);
  const trailing6MonthAvg = trailing6SameCalendarMonthAvg(txns, year, month);
  const bands = cfg?.tierBands || { survival: 3000, comfortable: 5000, thrive: 8000 };
  const comfortableProRata = round2(bands.comfortable * dayElapsed / dim);

  const dailyRunRate = dayElapsed > 0 ? bookedSoFar / dayElapsed : 0;
  const linearMonthEnd = paceMonthEndProjection(bookedSoFar, dayElapsed, dim);
  const blendAnchor = priorYearSameMonthFull > 0 ? priorYearSameMonthFull : trailing6MonthAvg;
  const blendedMonthEnd = blendedMonthEndProjection(bookedSoFar, dayElapsed, dim, blendAnchor);
  const projectedMonthEnd = Math.min(blendedMonthEnd, linearMonthEnd);
  const projectedBand = classifyBand(projectedMonthEnd, bands);
  const blendWeights = blendProjectionWeights(dayElapsed);
  const defcon = buildDefconGauge(dayElapsed, blendedMonthEnd, linearMonthEnd, bands.survival);

  const history = monthlyNonJlrTotals(txns);
  const historicalMonths = [...history.entries()]
    .filter(([k]) => {
      const [y, m] = k.split('|').map(Number);
      return !(y === year && m === month);
    })
    .map(([, v]) => v);
  const historicalLow = historicalMonths.length ? Math.min(...historicalMonths) : null;
  const isWorstInHistory = historicalMonths.length > 0 && projectedMonthEnd <= historicalLow;

  const currentSoFar = tierSoFar(txns, year, month, dayElapsed);
  const priorSoFar = tierSoFar(txns, year - 1, month, dayElapsed);
  const tierGaps = [];
  const volatileTiers = [];
  for (const tierKey of Object.keys(TIER_DEFINITIONS)) {
    const cur = currentSoFar.get(tierKey) || 0;
    const pri = priorSoFar.get(tierKey) || 0;
    const gap = round2(cur - pri);
    const row = {
      tier_key: tierKey,
      label: TIER_DEFINITIONS[tierKey].label,
      current_so_far: cur,
      prior_year_same_day: pri,
      gap_gbp: gap,
      gap_pct: pctChange(cur, pri)
    };
    if (VOLATILE_TIER_KEYS.has(tierKey)) {
      volatileTiers.push(row);
      continue;
    }
    if (!EXEC_SUMMARY_TIER_KEYS.has(tierKey)) continue;
    tierGaps.push(row);
  }
  tierGaps.sort((a, b) => Math.abs(b.gap_gbp) - Math.abs(a.gap_gbp));

  const gapSurvival = round2(projectedMonthEnd - bands.survival);
  const ragPartial = (actual) => classifyBand(dayElapsed > 0 ? actual * dim / dayElapsed : 0, bands);
  const leadMessage = defcon.active && defcon.level >= 3
    ? `${monthName(year, month)} worst-case ${fmtPlain(defcon.projected_month_end)} projected (${defcon.pct_of_survival.toFixed(0)}% of £${bands.survival.toLocaleString('en-GB')} survival) — DEFCON ${defcon.level} ${defcon.status}.`
    : (gapSurvival < 0
      ? `${monthName(year, month)} is tracking ${fmtPlain(Math.abs(gapSurvival))} below survival on worst-case projection.`
      : `${monthName(year, month)} is above survival on current worst-case projection.`);

  const revised = buildRevisedForecast(
    monthly, cfg, forecast, linearMonthEnd, blendedMonthEnd
  );

  const recurringSoFar = sumRecurringForMonth(txns, seasonalityByProduct, year, month, dayElapsed);
  const recurringLinear = paceMonthEndProjection(recurringSoFar.recurringBaseline, dayElapsed, dim);
  const recurringDefcon = buildDefconGauge(dayElapsed, recurringLinear, recurringLinear, bands.survival);
  const closedThisYear = (monthly || []).filter((m) => m.year === year && m.isClosed);
  const janApr = closedThisYear.filter((m) => m.month >= 1 && m.month <= 4);
  const janAprRecurringAvg = janApr.length
    ? round2(janApr.reduce((s, m) => s + (m.recurringBaseline || 0), 0) / janApr.length)
    : null;

  return {
    month_label: monthName(year, month),
    year,
    month,
    days_elapsed: dayElapsed,
    days_in_month: dim,
    days_remaining: daysRemaining,
    is_partial: true,
    booked_nonjlr_so_far: bookedSoFar,
    recurring_baseline_so_far: recurringSoFar.recurringBaseline,
    recurring_lumpy_excluded: recurringSoFar.lumpyExcluded,
    recurring_baseline: {
      booked_so_far: recurringSoFar.recurringBaseline,
      lumpy_excluded: recurringSoFar.lumpyExcluded,
      linear_month_end: recurringLinear,
      defcon: recurringDefcon,
      jan_apr_avg: janAprRecurringAvg
    },
    band_so_far: classifyBand(bookedSoFar * (dim / Math.max(1, dayElapsed)), bands),
    defcon,
    comparisons: {
      prior_year_same_month: { ...compareMetric(bookedSoFar, priorYearSameDay), rag: ragPartial(bookedSoFar), basis: 'nonjlr_net' },
      trailing_6_same_day_avg: { ...compareMetric(bookedSoFar, trailing6Avg), rag: ragPartial(bookedSoFar), basis: 'nonjlr_net' },
      comfortable_pro_rata: { target: comfortableProRata, ...compareMetric(bookedSoFar, comfortableProRata), rag: ragPartial(bookedSoFar), basis: 'closed_only' }
    },
    projection: {
      blended_month_end: blendedMonthEnd,
      linear_month_end: linearMonthEnd,
      worst_case_month_end: projectedMonthEnd,
      band: projectedBand,
      daily_run_rate: round2(dailyRunRate),
      blend_anchor: blendAnchor,
      blend_anchor_label: priorYearSameMonthFull > 0 ? 'Prior-year same month (non-JLR full)' : '6-yr same-month avg (non-JLR)',
      prior_year_same_month_full: priorYearSameMonthFull,
      trailing_6_same_month_avg: trailing6MonthAvg,
      trailing_6_same_day_avg: trailing6Avg,
      blend_weights: blendWeights,
      is_worst_in_history: isWorstInHistory,
      historical_low: historicalLow,
      historical_month_count: historicalMonths.length,
      days_remaining: daysRemaining
    },
    tier_gaps: tierGaps,
    volatile_tiers: volatileTiers.filter((t) => t.current_so_far > 0 || t.prior_year_same_day > 0),
    forecast_impact: revised,
    lead_message: leadMessage,
    urgency: buildUrgency(defcon, projectedMonthEnd, isWorstInHistory)
  };
}

function buildRevisedForecast(monthly, cfg, forecast, projectedCurrentNonJlr, blendedMonthEnd) {
  if (!forecast) return null;
  const year = cfg?.now?.year || forecast.year;
  const closed = (monthly || []).filter((m) => m.year === year && m.isClosed);
  const ytdClosed = round2(closed.reduce((s, m) => s + (m.headlineRevenue || 0), 0));
  const avg = forecast.runRateMonthly || 0;
  const monthsAfterCurrent = Math.max(0, (forecast.monthsRemaining || 0) - 1);
  const revisedPace = round2(ytdClosed + projectedCurrentNonJlr + avg * monthsAfterCurrent);
  const revisedBlended = blendedMonthEnd != null
    ? round2(ytdClosed + blendedMonthEnd + avg * monthsAfterCurrent)
    : null;
  const primary = Math.min(revisedBlended ?? revisedPace, revisedPace);
  return {
    current_forecast: forecast.forecastCentral,
    revised_forecast: revisedPace,
    revised_forecast_blended: revisedBlended,
    revised_forecast_primary: primary,
    delta_gbp: round2(primary - forecast.forecastCentral),
    delta_linear_gbp: round2(revisedPace - forecast.forecastCentral),
    current_label: 'Closed-months-only (trailing-3 × remaining)',
    revised_label: 'Incl. current-month pace (non-JLR)',
    revised_blended_label: 'Incl. current-month blended (non-JLR, recommended)'
  };
}

function buildUrgency(defcon, projected, isWorstInHistory) {
  const lead = defcon?.active && defcon.exec_worry === true;
  return {
    lead_worry: lead,
    defcon_level: defcon?.level ?? null,
    score: lead ? 300000 - (defcon.level || 0) * 1000 : 0,
    is_worst_in_history: isWorstInHistory,
    projected_month_end: projected
  };
}

function fmtPlain(n) {
  return '£' + Math.abs(Number(n) || 0).toLocaleString('en-GB', { maximumFractionDigits: 0 });
}

export function computePulseGscSignals(diagnosis) {
  const slugMonthly = buildSlugMonthlyMap(diagnosis);
  const diags = (diagnosis?.diagnostics || []).filter(passesExecDiagGate);
  const hubRows = [];
  const productRows = [];
  for (const d of diags) {
    const { delta, insufficient } = execSeasonalImpressionDelta(d);
    if (insufficient || delta == null || delta >= 0) continue;
    const fw = d.metrics?.full_window || {};
    const slug = d.page_slug;
    hubRows.push({
      slug,
      tier_key: d.tier_key,
      impressions: fw.impressions || 0,
      delta_pct: delta,
      trend_shape: classifyGscTrendShape(slugMonthly.get(slug)?.monthly_series)
    });
  }
  hubRows.sort((a, b) => (a.delta_pct - b.delta_pct) || (b.impressions - a.impressions));

  for (const t of diagnosis?.tier_rollup || []) {
    if (!EXEC_SUMMARY_TIER_KEYS.has(t.tier_key)) continue;
    for (const s of t.product_gsc_trend?.slugs || []) {
      const imp = Number(s.impressions) || 0;
      const d = s.pct_change_impressions;
      if (d == null || d >= 0 || imp < 100) continue;
      productRows.push({
        slug: s.slug,
        tier_key: t.tier_key,
        impressions: imp,
        delta_pct: d,
        trend_shape: classifyGscTrendShape(s.monthly_series || slugMonthly.get(s.slug)?.monthly_series)
      });
    }
  }
  productRows.sort((a, b) => (a.delta_pct - b.delta_pct) || (b.impressions - a.impressions));

  return {
    hub_declines: hubRows.slice(0, 3),
    product_declines: productRows.slice(0, 3)
  };
}

function buildSlugMonthlyMap(diagnosis) {
  const map = new Map();
  for (const t of diagnosis?.tier_rollup || []) {
    for (const block of [t.hub_gsc_trend, t.product_gsc_trend]) {
      for (const s of block?.slugs || []) {
        if (s.slug && s.monthly_series?.length) map.set(s.slug, s);
      }
    }
  }
  return map;
}

function classifyGscTrendShape(monthlySeries) {
  const rows = (monthlySeries || []).slice().sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)));
  if (rows.length < 4) return 'insufficient history';
  const imps = rows.map((r) => Number(r.impressions) || 0);
  const last = imps[imps.length - 1];
  const prev = imps[imps.length - 2];
  const mom = prev > 0 ? (last - prev) / prev : 0;
  if (mom < -0.35) {
    const ps = String(rows[rows.length - 1].period_start || '').slice(0, 7);
    const mo = Number(ps.slice(5, 7));
    const yr = ps.slice(0, 4);
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `step (${names[mo - 1] || mo} ${yr})`;
  }
  const tail = imps.slice(-12);
  if (tail.length >= 6) {
    const mid = Math.floor(tail.length / 2);
    const first = avg(tail.slice(0, mid));
    const second = avg(tail.slice(mid));
    const chg = pctChange(second, first);
    if (chg != null && chg < -15) return tail.length >= 10 ? 'gradual 12-mo decline' : 'gradual 6-mo decline';
  }
  const prior3 = imps.slice(-4, -1);
  if (mom < -0.25 && prior3.length >= 2 && coefVar(prior3) < 0.18) return 'stable then drop month';
  return 'mixed';
}

function avg(nums) {
  if (!nums.length) return 0;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function coefVar(nums) {
  const m = avg(nums);
  if (!m) return 0;
  const v = avg(nums.map((n) => (n - m) ** 2));
  return Math.sqrt(v) / m;
}

export function isLiveMonthLeadWorry(pulse) {
  return pulse?.defcon?.active && pulse.defcon.exec_worry === true;
}

export function liveMonthWorryText(pulse) {
  if (!pulse?.defcon?.active) return '';
  const d = pulse.defcon;
  const worst = pulse.projection?.is_worst_in_history
    ? ' Worst month on record if it lands here.'
    : '';
  const mo = pulse.month_label?.replace(/\s+\d{4}$/, '') || 'This month';
  const pace = pulse.projection?.linear_month_end;
  const blended = pulse.projection?.blended_month_end;
  const paceNote = pace != null && blended != null && Math.abs(pace - d.projected_month_end) >= 50
    ? ` Pace ${fmtPlain(pace)} · blended ${fmtPlain(blended)}.`
    : '';
  return `🚨 DEFCON ${d.level} — ${mo} tracking ${fmtPlain(d.projected_month_end)} worst-case projected (${d.pct_of_survival.toFixed(0)}% of survival).${paceNote}${worst}`;
}

export function defconTileClass(defcon) {
  if (!defcon?.active) return 'defcon-inactive';
  return `defcon-${defcon.level}${defcon.pulse ? ' defcon-pulse' : ''}`;
}
