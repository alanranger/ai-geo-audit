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
  const rec = diagnosis?.tier_reconciliation || {};
  const meta = {
    asOf: (summary?.asOf || findings?.asOf || diagnosis?.asOf || '').slice(0, 19).replace('T', ' '),
    windowMonths,
    reconciliation: rec.passes ? '✓ penny-exact non-JLR' : 'Reconciliation FAIL'
  };
  const tracker = buildMonthlyTracker(summary);

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
  addForecastTrends(bullets, summary);
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

function addForecastTrends(b, summary) {
  const fc = summary?.forecast;
  if (!fc) return;
  const central = Number(fc.forecastCentral) || 0;
  if (central < 36000) {
    b.trends.push({
      text: `Full-year forecast ${fmtMoney(central, 0)} — below £36k year survival`,
      sub: `${fmtMoney(36000 - central, 0)} short of year survival band`
    });
    return;
  }
  if (central < 60000) {
    b.trends.push({
      text: `Full-year forecast ${fmtMoney(central, 0)} — ${fmtMoney(60000 - central, 0)} below £60k comfortable`,
      sub: 'Above £36k year survival band'
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
      if (seasonal) {
        const ytd = sn.y2026_ytd_closed || sn.y2026_ytd || 0;
        if (ytd > 0) {
          b.working.push({
            text: `${f.unit_id}: ${fmtMoney(ytd, 0)} YTD (${findings.currentYear})`,
            sub: 'Seasonal event — not annualised'
          });
        }
        continue;
      }
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
  const fc = summary?.forecast;
  if (!fc || b.working.length >= WORKING_MAX) return;
  const central = Number(fc.forecastCentral) || 0;
  if (central >= 36000 && central < 60000) {
    b.working.push({
      text: `Forecast ${fmtMoney(central, 0)} reaches above £36k year survival`,
      sub: `${fmtMoney(60000 - central, 0)} below £60k comfortable target`
    });
  } else if (central >= 60000) {
    b.working.push({
      text: `Forecast ${fmtMoney(central, 0)} reaches the £60k comfortable band`,
      sub: 'Full-year trajectory positive'
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

function buildMonthlyTracker(summary) {
  const monthly = summary?.monthly || [];
  const bands = summary?.config?.tierBands || { survival: 3000, comfortable: 5000, thrive: 8000 };
  const closed = monthly.filter((m) => m.isClosed);
  const partial = monthly.find((m) => m.isPartial) || null;
  const rows = closed.slice(-2).map((m) => closedMonthRow(m, bands));
  if (partial) rows.push(currentMonthRow(partial, summary?.currentMonthPulse, bands));
  return { survivalLine: survivalLine(bands), rows };
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
  if (!tracker?.rows?.length) return '';
  const survival = fmtMoney(tracker.survivalLine, 0);
  const head = `<div class="rt-exec-tracker-head">Monthly vs ${escapeHtml(survival)} survival</div>`;
  const body = tracker.rows.map((r) => {
    const chip = r.chip ? `<span class="rt-exec-chip ${escapeAttr(r.chip.cls)}">${escapeHtml(r.chip.text)}</span>` : '';
    return `<tr><td>${escapeHtml(r.label)}</td><td class="rt-exec-num">${escapeHtml(r.actual)}</td>`
      + `<td class="rt-exec-gap rt-exec-gap-${escapeAttr(r.gapDir || 'neutral')}">${escapeHtml(r.gapText)}</td><td>${chip}</td></tr>`;
  }).join('');
  return `<div class="rt-exec-tracker">${head}<table class="rt-exec-tracker-table"><thead><tr>`
    + '<th>Month</th><th>Actual</th><th>vs £3k</th><th>Band</th></tr></thead><tbody>'
    + body + '</tbody></table></div>';
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
  const metaLine = `Last updated: ${meta.asOf} UTC · Window: ${meta.windowMonths}mo · Reconciliation: ${meta.reconciliation}`;
  return `<div class="rt-exec-meta">${escapeHtml(metaLine)}</div>`
    + renderTrackerHtml(tracker)
    + '<div class="rt-exec-grid">'
    + blockHtml('🔴 Worry points', 'worry', bullets.worry)
    + blockHtml('🟠 Trends going the wrong way', 'trends', bullets.trends)
    + blockHtml('🟢 What\'s working', 'working', bullets.working, footers.working)
    + blockHtml('→ Next to investigate', 'investigate', bullets.investigate, footers.investigate)
    + '</div>';
}
