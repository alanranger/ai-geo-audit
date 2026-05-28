/** Exec summary — evidence-derived bullets only (D22). */

import { fmtMoney, slugLink } from './revenue-truth-ui-core.mjs';
import { isSeasonalAnnualisationProduct } from './revenue-truth-recurring-baseline.mjs';
import {
  WORRY_MAX_BULLETS,
  INVESTIGATE_MAX_BULLETS,
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
import { isLiveMonthLeadWorry, liveMonthWorryText } from './revenue-truth-current-month-pulse.mjs';

export function buildExecSummary({ summary, findings, diagnosis, windowMonths = 12 }) {
  const worryCandidates = [];
  const bullets = { worry: [], trends: [], working: [], investigate: [] };
  const rec = diagnosis?.tier_reconciliation || {};
  const meta = {
    asOf: (summary?.asOf || findings?.asOf || diagnosis?.asOf || '').slice(0, 19).replace('T', ' '),
    windowMonths,
    reconciliation: rec.passes
      ? '✓ penny-exact non-JLR'
      : 'Reconciliation FAIL'
  };

  addRecurringBaselineWorry(worryCandidates, summary);
  addHeadlineTrends(bullets, summary);
  addLiveMonthWorry(worryCandidates, summary);
  addForecastBullets(bullets, summary, worryCandidates);
  addFindingsBullets(bullets, findings, worryCandidates);
  addDiagnosisBullets(bullets, diagnosis, windowMonths, worryCandidates);
  addVolatileNotes(bullets);

  bullets.worry = worryCandidates
    .sort((a, b) => b.score - a.score)
    .slice(0, WORRY_MAX_BULLETS)
    .map(({ score, ...item }) => item);

  return { meta, bullets };
}

function pushWorry(candidates, item, score) {
  candidates.push({ ...item, score: Number(score) || 0 });
}

function addLiveMonthWorry(candidates, summary) {
  const pulse = summary?.currentMonthPulse;
  if (!isLiveMonthLeadWorry(pulse)) return;
  pushWorry(candidates, {
    text: liveMonthWorryText(pulse),
    section: 'rt-current-month-pulse'
  }, pulse.urgency?.score || 296000);
}

function addRecurringBaselineWorry(candidates, summary) {
  const rb = summary?.recurringBaseline;
  if (!rb?.janAprRecurringAvg || rb.janAprRecurringAvg >= 3000) return;
  pushWorry(candidates, {
    text: `Recurring baseline ${fmtMoney(rb.janAprRecurringAvg, 0)}/mo across Jan-Apr ${summary?.config?.now?.year || ''} - already below £3k survival for 4 months. May is not an anomaly; residentials and event-bound products had been masking the structural position. Rescue high-margin recurring tiers, not workshops.`,
    section: 'rt-current-month-pulse'
  }, 350000);
}

function addHeadlineTrends(b, summary) {
  const strip = summary?.headlineStrip;
  if (!strip) return;
  const avg = strip.trailing3MonthAverage || 0;
  const cfg = summary?.config?.tierBands || { survival: 3000, comfortable: 5000 };
  if (avg < cfg.comfortable) {
    b.trends.push({
      text: `Trailing 3-mo avg ${fmtMoney(avg, 0)} — ${avg < cfg.survival ? 'below survival' : 'survival band'}, below £5k comfortable target.`,
      section: 'rt-headline-forecast'
    });
  }
}

function addForecastBullets(b, summary, worryCandidates) {
  const fc = summary?.forecast;
  if (!fc) return;
  const central = Number(fc.forecastCentral) || 0;
  const gap = 60000 - central;
  if (central < 36000) {
    pushWorry(worryCandidates, {
      text: `Full-year forecast ${fmtMoney(central, 0)} is below the £36k survival band.`,
      section: 'rt-headline-forecast'
    }, 100000);
  } else if (central < 60000) {
    b.trends.push({ text: `Forecast ${fmtMoney(central, 0)} — ${fmtMoney(gap, 0)} below £60k comfortable target.`, section: 'rt-forecast' });
  } else {
    b.working.push({ text: `Forecast ${fmtMoney(central, 0)} reaches the £60k comfortable band.`, section: 'rt-forecast' });
  }
}

function addFindingsBullets(b, findings, worryCandidates) {
  if (!findings) return;
  const s = findings.headline?.nonjlr;
  if (s) {
    const d = s.delta_2024_to_2025 || 0;
    if (d < -5000) {
      b.trends.push({ text: `Non-JLR fell ${fmtMoney(Math.abs(d), 0)} from 2024 to 2025 (Booking Sheet).`, section: 'rt-movers' });
    }
  }
  const decline = (findings.products?.decliningTop5_2024_to_2025 || [])
    .filter(isExecFindingsDecline)
    .sort((a, b) => findingsDeclineScore(b) - findingsDeclineScore(a));
  for (const f of decline.slice(0, 2)) {
    const d = f.deltas?.nonjlr_2024_to_2025?.delta_gbp;
    if (d != null && d < -1000) {
      pushWorry(worryCandidates, {
        text: `${f.unit_id}: ${fmtMoney(Math.abs(d), 0)} decline 2024→2025.`,
        section: 'rt-movers'
      }, findingsDeclineScore(f));
    }
  }
  const growth = findings.products?.growingTop5_2025_to_2026 || findings.products?.growingTop5_2024_to_2025 || [];
  for (const f of growth.slice(0, 2)) {
    const sn = f.series_nonjlr || {};
    const ann = sn.y2026_annualised || 0;
    const y25 = sn.y2025 || 0;
    const seasonal = isSeasonalAnnualisationProduct(f.meta?.seasonality_type);
    if (seasonal) {
      const ytd = sn.y2026_ytd_closed || sn.y2026_ytd || 0;
      if (ytd > 0) {
        b.working.push({
          text: `${f.unit_id}: ${fmtMoney(ytd, 0)} YTD (${findings.currentYear}) — seasonal event, not annualised.`,
          section: 'rt-movers'
        });
      }
      continue;
    }
    if (ann > y25 && ann > 1000) {
      b.working.push({ text: `${f.unit_id}: ${fmtMoney(y25, 0)} → ${fmtMoney(ann, 0)} (${findings.currentYear} ann.).`, section: 'rt-movers' });
    }
  }
}

function addDiagnosisBullets(b, diagnosis, windowMonths, worryCandidates) {
  const tiers = diagnosis?.tier_rollup || [];
  const diags = diagnosis?.diagnostics || [];

  for (const t of tiers) {
    if (!isExecSummaryTier(t.tier_key)) continue;
    if (t.severity === 'critical' && (t.pages_at_risk_gbp || 0) > 500) {
      pushWorry(worryCandidates, {
        text: `${t.label}: ${fmtMoney(t.pages_at_risk_gbp, 0)} at risk on diagnostic pages.`,
        section: 'rt-diag-section'
      }, tierCriticalWorryScore(t));
    }
  }

  for (const d of diags) {
    if (!isGenuineVisibilityWorry(d, windowMonths)) continue;
    const { delta } = execImpressionDelta(d, windowMonths);
    const slug = '/' + d.page_slug;
    pushWorry(worryCandidates, {
      text: `${slugLink(slug, slug)}: impressions ${delta.toFixed(0)}% (season-adjusted).`,
      section: 'rt-diag-section',
      html: true
    }, visibilityWorryScore(d, windowMonths));
  }

  const investigate = diags
    .filter(isExecInvestigateCandidate)
    .sort((a, b) => investigateScore(b) - investigateScore(a))
    .slice(0, INVESTIGATE_MAX_BULLETS);
  for (const d of investigate) {
    const fw = d.metrics?.full_window || {};
    const slug = '/' + d.page_slug;
    b.investigate.push({
      text: `${slugLink(slug, slug)}: ${fmtN(fw.impressions)} impressions, ${fmtN(fw.clicks)} clicks, £0 mapped revenue (${windowMonths}mo window).`,
      section: 'rt-diag-section',
      html: true
    });
  }
}

function fmtN(n) {
  return (Number(n) || 0).toLocaleString('en-GB');
}

function addVolatileNotes(b) {
  b.investigate.push({
    text: 'Residential workshops are intermittent — excluded from growth/decline rankings.',
    section: 'rt-diag-section'
  });
}

function blockHtml(title, cls, items) {
  if (!items.length) return '';
  return `<div class="rt-exec-block rt-exec-${cls}"><h4>${title}</h4><ul>`
    + items.map((it) => {
      if (it.html) return `<li>${it.text}</li>`;
      return `<li><a href="#${escapeAttr(it.section)}" data-rt-scroll="${escapeAttr(it.section)}">${escapeHtml(it.text)}</a></li>`;
    }).join('')
    + '</ul></div>';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

export function renderExecSummaryHtml(ctx) {
  const { meta, bullets } = buildExecSummary(ctx);
  const metaLine = `Last updated: ${meta.asOf} UTC · Window: ${meta.windowMonths}mo · Reconciliation: ${meta.reconciliation}`;
  return `<div class="rt-exec-meta">${escapeHtml(metaLine)}</div><div class="rt-exec-grid">`
    + blockHtml('🔴 Worry points', 'worry', bullets.worry)
    + blockHtml('🟠 Trends going the wrong way', 'trends', bullets.trends)
    + blockHtml('🟢 What\'s working', 'working', bullets.working)
    + blockHtml('→ Next to investigate', 'investigate', bullets.investigate)
    + '</div>';
}
