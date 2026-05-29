/** Exec summary — 4-card digest (D22). */

import { fmtMoney } from './revenue-truth-ui-core.mjs';
import { isSeasonalAnnualisationProduct } from './revenue-truth-recurring-baseline.mjs';
import { classifyBand } from './revenue-truth-current-month-pulse.mjs';
import {
  isExecInvestigateCandidate,
  investigateScore
} from './revenue-truth-exec-filters.mjs';

const WORKING_MAX = 2;
const INVESTIGATE_MAX = 2;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BAND_CHIP = {
  below_survival: { text: 'Below £3k', cls: 'rt-band-below_survival' },
  survival: { text: 'Survival', cls: 'rt-band-survival' },
  comfortable: { text: 'Comfortable', cls: 'rt-band-comfortable' },
  thrive: { text: 'Thrive', cls: 'rt-band-thrive' }
};

function buildMonthlyTracker(summary) {
  const monthly = summary?.monthly || [];
  const bands = summary?.config?.tierBands || { survival: 3000, comfortable: 5000, thrive: 8000 };
  const closed = monthly.filter((m) => m.isClosed);
  const partial = monthly.find((m) => m.isPartial) || null;
  const rows = closed.slice(-2).map((m) => closedMonthRow(m, bands));
  if (partial) rows.push(currentMonthRow(partial, summary?.currentMonthPulse, bands));
  return { survivalLine: bands.survival, rows };
}

function monthLabel(m, mtd) {
  const name = MONTH_NAMES[(m.month || 1) - 1] || String(m.month);
  return `${name} ${m.year}${mtd ? ' (MTD)' : ''}`;
}

function bandChip(band) {
  return BAND_CHIP[band] || BAND_CHIP.below_survival;
}

function gapText(gap, suffix = '') {
  const sfx = suffix ? ` ${suffix}` : '';
  if (gap < 0) return `▼ ${fmtMoney(Math.abs(gap), 0)} below £3k${sfx}`;
  if (gap > 0) return `▲ ${fmtMoney(gap, 0)} above £3k${sfx}`;
  return 'On £3k line';
}

function closedMonthRow(m, bands) {
  const actual = Number(m.headlineRevenue) || 0;
  const gap = actual - bands.survival;
  return {
    label: monthLabel(m, false),
    actual: fmtMoney(actual, 0),
    gapText: gapText(gap),
    chip: bandChip(classifyBand(actual, bands)),
    belowSurvival: actual < bands.survival,
    isPartial: false
  };
}

function currentMonthRow(m, pulse, bands) {
  const booked = Number(pulse?.booked_nonjlr_so_far) || Number(m.headlineRevenue) || 0;
  const defcon = pulse?.defcon;
  if (defcon?.active) {
    const proj = Number(defcon.projected_month_end) || 0;
    return {
      label: monthLabel(m, true),
      actual: `${fmtMoney(booked, 0)} booked · ${fmtMoney(proj, 0)} proj.`,
      gapText: gapText(proj - bands.survival, '(proj.)'),
      chip: { text: `DEFCON ${defcon.level}`, cls: `rt-defcon-chip rt-defcon-${defcon.level}` },
      belowSurvival: proj < bands.survival,
      isPartial: true
    };
  }
  const dim = pulse?.days_in_month || 31;
  const elapsed = pulse?.days_elapsed || 1;
  const pace = booked * dim / Math.max(1, elapsed);
  return {
    label: monthLabel(m, true),
    actual: `${fmtMoney(booked, 0)} booked`,
    gapText: gapText(pace - bands.survival, '(pace)'),
    chip: bandChip(classifyBand(pace, bands)),
    belowSurvival: pace < bands.survival,
    isPartial: true
  };
}

function buildWorryCard(tracker) {
  const offTarget = tracker.rows.filter((r) => r.belowSurvival);
  const items = offTarget.length
    ? offTarget
    : [{ label: 'Recent months', actual: 'On or above £3k', gapText: 'No off-target months in window', chip: bandChip('survival'), belowSurvival: false, isPartial: false }];
  return { title: 'Recent months off target', items };
}

function buildTrendsCard(summary, findings) {
  const items = [];
  const bands = summary?.config?.tierBands || { survival: 3000 };
  const avg = Number(summary?.headlineStrip?.trailing3MonthAverage) || 0;
  if (avg > 0 && avg < bands.survival) {
    items.push({ label: 'Trailing 3-mo avg', value: fmtMoney(avg, 0), detail: gapText(avg - bands.survival) });
  } else if (avg > 0) {
    items.push({ label: 'Trailing 3-mo avg', value: fmtMoney(avg, 0), detail: `Above £3k survival (${fmtMoney(avg - bands.survival, 0)} headroom)` });
  }
  buildTrendsFromFindings(items, findings);
  const fc = summary?.forecast;
  if (fc) {
    const central = Number(fc.forecastCentral) || 0;
    if (central < 36000) {
      items.push({ label: 'Full-year forecast', value: fmtMoney(central, 0), detail: `${fmtMoney(36000 - central, 0)} below £36k survival band` });
    } else if (central < 60000) {
      items.push({ label: 'Full-year forecast', value: fmtMoney(central, 0), detail: `${fmtMoney(60000 - central, 0)} below £60k comfortable target` });
    }
  }
  return { title: 'Trajectory', items };
}

function buildTrendsFromFindings(items, findings) {
  if (!findings) return;
  const d = Number(findings.headline?.nonjlr?.delta_2024_to_2025) || 0;
  if (d < -5000) {
    items.push({ label: '2024 → 2025 non-JLR', value: fmtMoney(Math.abs(d), 0), detail: 'Decline on Booking Sheet headline' });
  }
}

function buildWorkingCard(findings) {
  const items = [];
  if (!findings) return { title: 'Recent wins', items, footer: null };
  const growth = findings.products?.growingTop5_2025_to_2026 || findings.products?.growingTop5_2024_to_2025 || [];
  for (const f of growth) {
    if (items.length >= WORKING_MAX) break;
    const sn = f.series_nonjlr || {};
    const seasonal = isSeasonalAnnualisationProduct(f.meta?.seasonality_type);
    if (seasonal) {
      const ytd = sn.y2026_ytd_closed || sn.y2026_ytd || 0;
      if (ytd > 0) items.push({ label: f.unit_id, value: fmtMoney(ytd, 0), detail: `YTD ${findings.currentYear} (seasonal)` });
      continue;
    }
    const ann = sn.y2026_annualised || 0;
    const y25 = sn.y2025 || 0;
    if (ann > y25 && ann > 1000) {
      items.push({ label: f.unit_id, value: fmtMoney(ann, 0), detail: `${fmtMoney(y25, 0)} in 2025 → annualised` });
    }
  }
  return {
    title: 'Recent wins',
    items,
    footer: items.length ? { text: 'Product detail in §4b →', section: 'rt-movers' } : null
  };
}

function buildInvestigateCard(diagnosis, windowMonths) {
  const items = [];
  const diags = (diagnosis?.diagnostics || [])
    .filter(isExecInvestigateCandidate)
    .sort((a, b) => investigateScore(b) - investigateScore(a))
    .slice(0, INVESTIGATE_MAX);
  for (const d of diags) {
    const fw = d.metrics?.full_window || {};
    items.push({
      label: d.page_slug || 'unknown',
      value: `${fmtN(fw.impressions)} impr.`,
      detail: `${fmtN(fw.clicks)} clicks · £0 mapped revenue (${windowMonths}mo)`
    });
  }
  return {
    title: 'Check next',
    items,
    footer: { text: 'Open §9 diagnosis →', section: 'rt-diag-section' }
  };
}

function fmtN(n) {
  return (Number(n) || 0).toLocaleString('en-GB');
}

export function buildExecSummary({ summary, findings, diagnosis, windowMonths = 12 }) {
  const rec = diagnosis?.tier_reconciliation || {};
  const meta = {
    asOf: (summary?.asOf || findings?.asOf || diagnosis?.asOf || '').slice(0, 19).replace('T', ' '),
    windowMonths,
    reconciliation: rec.passes ? '✓ penny-exact non-JLR' : 'Reconciliation FAIL'
  };
  const tracker = buildMonthlyTracker(summary);
  return {
    meta,
    tracker,
    cards: {
      worry: buildWorryCard(tracker),
      trends: buildTrendsCard(summary, findings),
      working: buildWorkingCard(findings),
      investigate: buildInvestigateCard(diagnosis, windowMonths)
    }
  };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

function renderTrackerHtml(tracker) {
  if (!tracker?.rows?.length) return '';
  const survival = fmtMoney(tracker.survivalLine, 0);
  const head = `<div class="rt-exec-tracker-head">Monthly vs ${escapeHtml(survival)} survival</div>`;
  const body = tracker.rows.map((r) => {
    const chip = r.chip ? `<span class="rt-exec-chip ${escapeAttr(r.chip.cls)}">${escapeHtml(r.chip.text)}</span>` : '';
    return `<tr><td>${escapeHtml(r.label)}</td><td class="rt-exec-num">${escapeHtml(r.actual)}</td>`
      + `<td class="rt-exec-gap">${escapeHtml(r.gapText)}</td><td>${chip}</td></tr>`;
  }).join('');
  return `<div class="rt-exec-tracker">${head}<table class="rt-exec-tracker-table"><thead><tr>`
    + '<th>Month</th><th>Actual</th><th>vs £3k</th><th>Band</th></tr></thead><tbody>'
    + body + '</tbody></table></div>';
}

function renderMetricCard(title, cls, card) {
  const items = card?.items || [];
  if (!items.length && !card?.footer) return '';
  const rows = items.map((it) => {
    if (it.gapText) {
      return `<div class="rt-exec-metric-row"><span class="rt-exec-metric-label">${escapeHtml(it.label)}</span>`
        + `<span class="rt-exec-metric-value">${escapeHtml(it.actual)}</span>`
        + `<span class="rt-exec-metric-detail">${escapeHtml(it.gapText)}</span>`
        + (it.chip ? `<span class="rt-exec-chip ${escapeAttr(it.chip.cls)}">${escapeHtml(it.chip.text)}</span>` : '')
        + '</div>';
    }
    return `<div class="rt-exec-metric-row"><span class="rt-exec-metric-label">${escapeHtml(it.label)}</span>`
      + `<span class="rt-exec-metric-value">${escapeHtml(it.value || '')}</span>`
      + `<span class="rt-exec-metric-detail">${escapeHtml(it.detail || '')}</span></div>`;
  }).join('');
  const footer = card?.footer
    ? `<div class="rt-exec-card-footer"><a href="#${escapeAttr(card.footer.section)}" data-rt-scroll="${escapeAttr(card.footer.section)}">${escapeHtml(card.footer.text)}</a></div>`
    : '';
  return `<div class="rt-exec-block rt-exec-${cls}"><h4>${escapeHtml(title)}</h4><div class="rt-exec-metrics">${rows}</div>${footer}</div>`;
}

export function renderExecSummaryHtml(ctx) {
  const { meta, tracker, cards } = buildExecSummary(ctx);
  const metaLine = `Last updated: ${meta.asOf} UTC · Window: ${meta.windowMonths}mo · Reconciliation: ${meta.reconciliation}`;
  return `<div class="rt-exec-meta">${escapeHtml(metaLine)}</div>`
    + renderTrackerHtml(tracker)
    + '<div class="rt-exec-grid">'
    + renderMetricCard(cards.worry.title, 'worry', cards.worry)
    + renderMetricCard(cards.trends.title, 'trends', cards.trends)
    + renderMetricCard(cards.working.title, 'working', cards.working)
    + renderMetricCard(cards.investigate.title, 'investigate', cards.investigate)
    + '</div>';
}
