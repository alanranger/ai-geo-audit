/** Exec summary — tracker strip + four curated insight cards (D22). */

import { fmtMoney } from './revenue-truth-ui-core.mjs';
import { isSeasonalAnnualisationProduct } from './revenue-truth-recurring-baseline.mjs';
import { classifyBand, isLiveMonthLeadWorry, liveMonthWorryText } from './revenue-truth-current-month-pulse.mjs';
import {
  WORRY_MAX_BULLETS,
  isExecSummaryTier,
  isGenuineVisibilityWorry,
  visibilityWorryScore,
  tierCriticalWorryScore,
  isExecFindingsDecline,
  findingsDeclineScore,
  isExecInvestigateCandidate,
  investigateScore,
  execImpressionDelta
} from './revenue-truth-exec-filters.mjs';
import { resolveExecYearForecast, YEAR_SURVIVAL, YEAR_COMFORTABLE } from './revenue-truth-live-forecast.mjs';
import {
  formatReconciliationBadge,
  reconciliationTraceHtml
} from './revenue-truth-headline-reconciliation.mjs';

const WORRY_INSIGHT_MAX = 4;
const TRENDS_MAX = 4;
const WORKING_MAX = 3;
const INVESTIGATE_PAGES_MAX = 2;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BAND_CHIP = {
  below_survival: { text: 'Below £3k', cls: 'rt-band-below_survival' },
  survival: { text: 'Survival', cls: 'rt-band-survival' },
  comfortable: { text: 'Comfortable', cls: 'rt-band-comfortable' },
  thrive: { text: 'Thrive', cls: 'rt-band-thrive' }
};

export function buildExecSummary({ summary, findings, diagnosis, windowMonths = 12 }) {
  const worryCandidates = [];
  const bullets = { worry: [], trends: [], working: [], investigate: [] };
  const rec = summary?.headlineReconciliation;
  const meta = {
    asOf: (summary?.asOf || findings?.asOf || diagnosis?.asOf || '').slice(0, 19).replace('T', ' '),
    windowMonths,
    reconciliation: rec ? formatReconciliationBadge(rec) : (rec === null ? 'JLR-included view' : 'Reconciliation unknown'),
    reconciliationPasses: rec?.passes === true,
    reconciliationTrace: rec
  };
  const tracker = buildMonthlyTracker(summary, findings);

  addLiveMonthWorry(worryCandidates, summary);
  addRecurringBaselineWorry(worryCandidates, summary);
  addTierAtRiskWorry(worryCandidates, diagnosis);
  addProductDeclineWorry(worryCandidates, findings);

  bullets.worry = worryCandidates
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(WORRY_INSIGHT_MAX, WORRY_MAX_BULLETS))
    .map(({ score, ...item }) => item);

  addHeadlineTrends(bullets, summary);
  addFindingsTrends(bullets, findings);
  addForecastTrends(bullets, summary, findings);
  addTopVisibilityTrend(bullets, diagnosis, windowMonths);
  bullets.trends = bullets.trends.slice(0, TRENDS_MAX);

  addWorkingBullets(bullets, findings, summary);
  bullets.working = bullets.working.slice(0, WORKING_MAX);

  addInvestigateBullets(bullets, diagnosis, windowMonths);
  addVolatileNotes(bullets);

  return {
    meta,
    tracker,
    bullets,
    footers: {
      working: bullets.working.length
        ? { text: 'Product detail in §4b →', section: 'rt-movers' }
        : null,
      investigate: { text: 'Open §9 diagnosis →', section: 'rt-diag-section' }
    }
  };
}

function pushWorry(candidates, item, score) {
  candidates.push({ ...item, score: Number(score) || 0 });
}

function addLiveMonthWorry(candidates, summary) {
  const pulse = summary?.currentMonthPulse;
  if (!isLiveMonthLeadWorry(pulse)) return;
  const sub = buildDefconSubline(pulse);
  pushWorry(candidates, {
    text: liveMonthWorryText(pulse),
    sub,
    section: 'rt-current-month-pulse',
    linked: true
  }, pulse.urgency?.score || 296000);
}

function buildDefconSubline(pulse) {
  const pace = pulse.projection?.linear_month_end;
  const blended = pulse.projection?.blended_month_end;
  const parts = [];
  if (pace != null && blended != null) {
    parts.push(`Pace ${fmtMoney(pace, 0)} · blended ${fmtMoney(blended, 0)}`);
  }
  if (pulse.projection?.is_worst_in_history) parts.push('Worst month on record if it lands here');
  return parts.join(' · ') || undefined;
}

function addRecurringBaselineWorry(candidates, summary) {
  const rb = summary?.recurringBaseline || summary?.headlineStrip?.recurring;
  const avg = rb?.janAprRecurringAvg;
  if (!avg || avg >= 3000) return;
  const yr = summary?.config?.now?.year || '';
  pushWorry(candidates, {
    text: `Recurring baseline ${fmtMoney(avg, 0)}/mo (Jan–Apr ${yr}) — below £3k survival`,
    sub: 'Not a one-off blip; high-margin recurring tiers need rescue, not workshops alone.',
    section: 'rt-current-month-pulse'
  }, 350000);
}

function addTierAtRiskWorry(candidates, diagnosis) {
  const tiers = diagnosis?.tier_rollup || [];
  let best = null;
  for (const t of tiers) {
    if (!isExecSummaryTier(t.tier_key)) continue;
    if (t.severity !== 'critical' || (t.pages_at_risk_gbp || 0) <= 500) continue;
    const score = tierCriticalWorryScore(t);
    if (!best || score > best.score) best = { t, score };
  }
  if (!best) return;
  pushWorry(candidates, {
    text: `${best.t.label}: ${fmtMoney(best.t.pages_at_risk_gbp, 0)} at risk on diagnostic pages`,
    sub: 'Tier rollup · critical severity',
    section: 'rt-diag-section'
  }, best.score);
}

function addProductDeclineWorry(candidates, findings) {
  if (!findings) return;
  const decline = (findings.products?.decliningTop5_2024_to_2025 || [])
    .filter(isExecFindingsDecline)
    .sort((a, b) => findingsDeclineScore(b) - findingsDeclineScore(a));
  const f = decline[0];
  if (!f) return;
  const d = f.deltas?.nonjlr_2024_to_2025?.delta_gbp;
  if (d == null || d >= -1000) return;
  pushWorry(candidates, {
    text: `${f.unit_id}: ${fmtMoney(Math.abs(d), 0)} decline 2024→2025`,
    sub: 'Top product decline · Booking Sheet',
    section: 'rt-movers'
  }, findingsDeclineScore(f));
}

function addHeadlineTrends(b, summary) {
  const strip = summary?.headlineStrip;
  if (!strip) return;
  const avg = strip.trailing3MonthAverage || 0;
  const cfg = summary?.config?.tierBands || { survival: 3000, comfortable: 5000 };
  if (avg <= 0) return;
  if (avg < cfg.survival) {
    b.trends.push({
      text: `Trailing 3-mo avg ${fmtMoney(avg, 0)} — ${fmtMoney(cfg.survival - avg, 0)} below £3k survival`,
      sub: 'Primary monthly target is £3k survival'
    });
  } else {
    b.trends.push({
      text: `Trailing 3-mo avg ${fmtMoney(avg, 0)} — above £3k survival`,
      sub: avg < cfg.comfortable ? `Still ${fmtMoney(cfg.comfortable - avg, 0)} below £5k comfortable` : 'At or above comfortable band'
    });
  }
}

function addFindingsTrends(b, findings) {
  if (!findings) return;
  const d = findings.headline?.nonjlr?.delta_2024_to_2025 || 0;
  if (d < -5000) {
    b.trends.push({
      text: `Non-JLR fell ${fmtMoney(Math.abs(d), 0)} from 2024 to 2025`,
      sub: 'Booking Sheet headline'
    });
  }
}

function addForecastTrends(b, summary, findings) {
  const live = resolveExecYearForecast(summary, findings);
  const central = (live?.value ?? Number(summary?.forecast?.forecastCentral)) || 0;
  if (central <= 0) return;
  const basis = live?.detail || 'Full-year projection';
  if (central < YEAR_SURVIVAL) {
    b.trends.push({
      text: `Full-year projected ${fmtMoney(central, 0)} — below £36k year survival`,
      sub: basis
    });
    return;
  }
  if (central < YEAR_COMFORTABLE) {
    b.trends.push({
      text: `Full-year projected ${fmtMoney(central, 0)} — ${fmtMoney(YEAR_COMFORTABLE - central, 0)} below £60k comfortable`,
      sub: basis
    });
  }
}

function addTopVisibilityTrend(b, diagnosis, windowMonths) {
  const diags = diagnosis?.diagnostics || [];
  let best = null;
  for (const d of diags) {
    if (!isGenuineVisibilityWorry(d, windowMonths)) continue;
    const score = visibilityWorryScore(d, windowMonths);
    if (!best || score > best.score) best = { d, score };
  }
  if (!best) return;
  const { delta } = execImpressionDelta(best.d, windowMonths);
  const slug = '/' + best.d.page_slug;
  b.trends.push({
    text: `${slug}: impressions ${delta.toFixed(0)}% (season-adjusted)`,
    sub: 'Top visibility loss in window'
  });
}

function addWorkingBullets(b, findings, summary) {
  if (findings) {
    const growth = findings.products?.growingTop5_2025_to_2026 || findings.products?.growingTop5_2024_to_2025 || [];
    for (const f of growth) {
      if (b.working.length >= WORKING_MAX - 1) break;
      const sn = f.series_nonjlr || {};
      const seasonal = isSeasonalAnnualisationProduct(f.meta?.seasonality_type);
      if (seasonal) continue;
      const ann = sn.y2026_annualised || 0;
      const y25 = sn.y2025 || 0;
      if (ann > y25 && ann > 1000) {
        b.working.push({
          text: `${f.unit_id}: ${fmtMoney(y25, 0)} → ${fmtMoney(ann, 0)} (${findings.currentYear} ann.)`,
          sub: 'Growing product'
        });
      }
    }
  }
  const live = resolveExecYearForecast(summary, findings);
  const central = (live?.value ?? Number(summary?.forecast?.forecastCentral)) || 0;
  if (central <= 0 || b.working.length >= WORKING_MAX) return;
  const basis = live?.detail || 'Full-year projection';
  if (central >= YEAR_SURVIVAL && central < YEAR_COMFORTABLE) {
    b.working.push({
      text: `Projected ${fmtMoney(central, 0)} reaches above £36k year survival`,
      sub: `${fmtMoney(YEAR_COMFORTABLE - central, 0)} below £60k comfortable · ${basis}`
    });
  } else if (central >= YEAR_COMFORTABLE) {
    b.working.push({
      text: `Projected ${fmtMoney(central, 0)} reaches the £60k comfortable band`,
      sub: basis
    });
  }
}

function addInvestigateBullets(b, diagnosis, windowMonths) {
  const diags = (diagnosis?.diagnostics || [])
    .filter(isExecInvestigateCandidate)
    .sort((a, b) => investigateScore(b) - investigateScore(a))
    .slice(0, INVESTIGATE_PAGES_MAX);
  for (const d of diags) {
    const fw = d.metrics?.full_window || {};
    b.investigate.push({
      text: `${d.page_slug}: ${fmtN(fw.impressions)} impressions, ${fmtN(fw.clicks)} clicks, £0 mapped revenue (${windowMonths}mo)`,
      sub: 'Traffic with zero conversion'
    });
  }
}

function addVolatileNotes(b) {
  b.investigate.push({
    text: 'Residential workshops are intermittent — excluded from growth/decline rankings.',
    sub: 'Context note'
  });
}

function fmtN(n) {
  return (Number(n) || 0).toLocaleString('en-GB');
}

function buildMonthlyTracker(summary, findings) {
  const monthly = summary?.monthly || [];
  const bands = summary?.config?.tierBands || { survival: 3000, comfortable: 5000, thrive: 8000 };
  const closed = monthly.filter((m) => m.isClosed);
  const partial = monthly.find((m) => m.isPartial) || null;
  const rows = closed.slice(-2).map((m) => closedMonthRow(m, bands));
  if (partial) rows.push(currentMonthRow(partial, summary?.currentMonthPulse, bands));
  const yearForecast = buildYearForecastRow(summary, findings);
  return { survivalLine: survivalLine(bands), rows, yearForecast };
}

function buildYearForecastRow(summary, findings) {
  const live = resolveExecYearForecast(summary, findings);
  if (!live?.value) return null;
  const gap = live.value - YEAR_SURVIVAL;
  return {
    label: `${live.year} full-year projected`,
    actual: fmtMoney(live.value, 0),
    gapText: yearGapText(gap),
    gapDir: gapDir(gap),
    chip: yearForecastChip(live.value),
    detail: live.detail
  };
}

function yearGapText(gap) {
  if (gap < 0) return `▼ ${fmtMoney(Math.abs(gap), 0)} below £36k yr survival`;
  if (gap > 0) return `▲ ${fmtMoney(gap, 0)} above £36k yr survival`;
  return 'On £36k year survival line';
}

function yearForecastChip(value) {
  if (value < YEAR_SURVIVAL) return { text: 'Below £36k yr', cls: 'rt-band-below_survival' };
  if (value < YEAR_COMFORTABLE) return { text: 'Above £36k yr', cls: 'rt-band-survival' };
  return { text: 'Comfortable yr', cls: 'rt-band-comfortable' };
}

function monthLabel(m, mtd) {
  const name = MONTH_NAMES[(m.month || 1) - 1] || String(m.month);
  return `${name} ${m.year}${mtd ? ' (MTD)' : ''}`;
}

function bandChip(band) {
  return BAND_CHIP[band] || BAND_CHIP.below_survival;
}

function survivalLine(bands) {
  return Number(bands?.survival) || 3000;
}

function gapText(gap, suffix = '') {
  const sfx = suffix ? ` ${suffix}` : '';
  if (gap < 0) return `▼ ${fmtMoney(Math.abs(gap), 0)} below £3k${sfx}`;
  if (gap > 0) return `▲ ${fmtMoney(gap, 0)} above £3k${sfx}`;
  return 'On £3k line';
}

function gapDir(gap) {
  if (gap < 0) return 'below';
  if (gap > 0) return 'above';
  return 'neutral';
}

function closedMonthRow(m, bands) {
  const actual = Number(m.headlineRevenue) || 0;
  const survival = survivalLine(bands);
  const gap = actual - survival;
  return {
    label: monthLabel(m, false),
    actual: fmtMoney(actual, 0),
    gapText: gapText(gap),
    gapDir: gapDir(gap),
    chip: bandChip(classifyBand(actual, bands)),
    belowSurvival: actual < survival,
    isPartial: false
  };
}

function currentMonthRow(m, pulse, bands) {
  const booked = Number(pulse?.booked_nonjlr_so_far) || Number(m.headlineRevenue) || 0;
  const survival = survivalLine(bands);
  const defcon = pulse?.defcon;
  if (defcon?.active) {
    const proj = Number(defcon.projected_month_end) || 0;
    const gap = proj - survival;
    return {
      label: monthLabel(m, true),
      actual: `${fmtMoney(booked, 0)} booked · ${fmtMoney(proj, 0)} proj.`,
      gapText: gapText(gap, '(proj.)'),
      gapDir: gapDir(gap),
      chip: { text: `DEFCON ${defcon.level}`, cls: `rt-defcon-chip rt-defcon-${defcon.level}` },
      belowSurvival: proj < survival,
      isPartial: true
    };
  }
  const dim = pulse?.days_in_month || 31;
  const elapsed = pulse?.days_elapsed || 1;
  const pace = booked * dim / Math.max(1, elapsed);
  const gap = pace - survival;
  return {
    label: monthLabel(m, true),
    actual: `${fmtMoney(booked, 0)} booked`,
    gapText: gapText(gap, '(pace)'),
    gapDir: gapDir(gap),
    chip: bandChip(classifyBand(pace, bands)),
    belowSurvival: pace < survival,
    isPartial: true
  };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

function renderTrackerHtml(tracker) {
  if (!tracker?.rows?.length && !tracker?.yearForecast) return '';
  const survival = fmtMoney(tracker.survivalLine, 0);
  const head = `<div class="rt-exec-tracker-head">Monthly vs ${escapeHtml(survival)} survival</div>`;
  const body = (tracker.rows || []).map((r) => {
    const chip = r.chip ? `<span class="rt-exec-chip ${escapeAttr(r.chip.cls)}">${escapeHtml(r.chip.text)}</span>` : '';
    return `<tr><td>${escapeHtml(r.label)}</td><td class="rt-exec-num">${escapeHtml(r.actual)}</td>`
      + `<td class="rt-exec-gap rt-exec-gap-${escapeAttr(r.gapDir || 'neutral')}">${escapeHtml(r.gapText)}</td><td>${chip}</td></tr>`;
  }).join('');
  const yf = tracker.yearForecast;
  const yearRow = yf
    ? `<tr class="rt-exec-tracker-year"><td>${escapeHtml(yf.label)}<div class="rt-exec-tracker-year-note">${escapeHtml(yf.detail || '')}</div></td>`
      + `<td class="rt-exec-num">${escapeHtml(yf.actual)}</td>`
      + `<td class="rt-exec-gap rt-exec-gap-${escapeAttr(yf.gapDir || 'neutral')}">${escapeHtml(yf.gapText)}</td>`
      + `<td>${yf.chip ? `<span class="rt-exec-chip ${escapeAttr(yf.chip.cls)}">${escapeHtml(yf.chip.text)}</span>` : ''}</td></tr>`
    : '';
  return `<div class="rt-exec-tracker">${head}<table class="rt-exec-tracker-table"><thead><tr>`
    + '<th>Month</th><th>Actual / projected</th><th>vs target</th><th>Band</th></tr></thead><tbody>'
    + body + yearRow + '</tbody></table></div>';
}

function renderBullet(it) {
  const main = it.linked
    ? `<a href="#${escapeAttr(it.section)}" data-rt-scroll="${escapeAttr(it.section)}">${escapeHtml(it.text)}</a>`
    : escapeHtml(it.text);
  const sub = it.sub ? `<div class="rt-exec-bullet-sub">${escapeHtml(it.sub)}</div>` : '';
  return `<li>${main}${sub}</li>`;
}

function blockHtml(title, cls, items, footer) {
  if (!items.length && !footer) return '';
  const list = items.length ? `<ul>${items.map(renderBullet).join('')}</ul>` : '';
  const foot = footer
    ? `<div class="rt-exec-card-footer"><a href="#${escapeAttr(footer.section)}" data-rt-scroll="${escapeAttr(footer.section)}">${escapeHtml(footer.text)}</a></div>`
    : '';
  return `<div class="rt-exec-block rt-exec-${cls}"><h4>${title}</h4>${list}${foot}</div>`;
}

export function renderExecSummaryHtml(ctx) {
  const { meta, tracker, bullets, footers } = buildExecSummary(ctx);
  const recCls = meta.reconciliationPasses ? 'rt-recon-pass' : 'rt-recon-fail';
  const recBadge = meta.reconciliationTrace
    ? `<details class="rt-recon-badge ${recCls}"><summary>${escapeHtml(meta.reconciliation)}</summary>`
      + `<div class="rt-recon-trace">${reconciliationTraceHtml(meta.reconciliationTrace)}</div></details>`
    : `<span class="rt-recon-badge ${recCls}">${escapeHtml(meta.reconciliation)}</span>`;
  const metaLine = `Last updated: ${meta.asOf} UTC · Window: ${meta.windowMonths}mo · Reconciliation: ${recBadge}`;
  return `<div class="rt-exec-meta">${metaLine}</div>`
    + renderTrackerHtml(tracker)
    + '<div class="rt-exec-grid">'
    + blockHtml('🔴 Worry points', 'worry', bullets.worry)
    + blockHtml('🟠 Trends going the wrong way', 'trends', bullets.trends)
    + blockHtml('🟢 What\'s working', 'working', bullets.working, footers.working)
    + blockHtml('→ Next to investigate', 'investigate', bullets.investigate, footers.investigate)
    + '</div>';
}
