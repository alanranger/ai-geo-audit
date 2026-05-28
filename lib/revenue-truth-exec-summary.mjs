/** Exec summary — evidence-derived bullets only (D22). */

import { fmtMoney, slugLink, VOLATILE_TIER_KEYS, RECURRING_TIER_KEYS } from './revenue-truth-ui-core.mjs';
import { pctChange } from './revenue-truth-gsc-deltas.mjs';

const STATE_PLAIN = {
  traffic_with_zero_conversion: 'traffic with zero mapped revenue',
  visibility_loss_with_low_ctr_baseline: 'visibility loss with weak CTR',
  visibility_loss_normal_ctr: 'visibility loss'
};

export function buildExecSummary({ summary, findings, diagnosis, windowMonths = 12 }) {
  const bullets = { worry: [], trends: [], working: [], investigate: [] };
  const rec = diagnosis?.tier_reconciliation || {};
  const meta = {
    asOf: (summary?.asOf || findings?.asOf || diagnosis?.asOf || '').slice(0, 19).replace('T', ' '),
    windowMonths,
    reconciliation: rec.passes
      ? '✓ penny-exact non-JLR'
      : 'Reconciliation FAIL'
  };

  addHeadlineTrends(bullets, summary);
  addForecastBullets(bullets, summary);
  addFindingsBullets(bullets, findings);
  addDiagnosisBullets(bullets, diagnosis, windowMonths);
  addVolatileNotes(bullets);

  return { meta, bullets };
}

function addHeadlineTrends(b, summary) {
  const strip = summary?.headlineStrip;
  if (!strip) return;
  const avg = strip.trailing3MonthAverage || 0;
  const cfg = summary?.config?.tierBands || { survival: 3000, comfortable: 5000 };
  if (avg < cfg.comfortable) {
    b.trends.push({
      text: `Trailing 3-mo avg ${fmtMoney(avg, 0)} — ${avg < cfg.survival ? 'below survival' : 'survival band'}, below £5k comfortable target.`,
      section: 'rt-headline'
    });
  }
}

function addForecastBullets(b, summary) {
  const fc = summary?.forecast;
  if (!fc) return;
  const central = Number(fc.forecastCentral) || 0;
  const gap = 60000 - central;
  if (central < 36000) {
    b.worry.push({ text: `Full-year forecast ${fmtMoney(central, 0)} is below the £36k survival band.`, section: 'rt-forecast' });
  } else if (central < 60000) {
    b.trends.push({ text: `Forecast ${fmtMoney(central, 0)} — ${fmtMoney(gap, 0)} below £60k comfortable target.`, section: 'rt-forecast' });
  } else {
    b.working.push({ text: `Forecast ${fmtMoney(central, 0)} reaches the £60k comfortable band.`, section: 'rt-forecast' });
  }
}

function addFindingsBullets(b, findings) {
  if (!findings) return;
  const s = findings.headline?.nonjlr;
  if (s) {
    const d = s.delta_2024_to_2025 || 0;
    if (d < -5000) {
      b.trends.push({ text: `Non-JLR fell ${fmtMoney(Math.abs(d), 0)} from 2024 to 2025 (Booking Sheet).`, section: 'rt-movers' });
    }
  }
  const decline = findings.products?.decliningTop5_2024_to_2025 || [];
  for (const f of decline.slice(0, 2)) {
    const d = f.deltas?.nonjlr_2024_to_2025?.delta_gbp;
    if (d != null && d < -1000) {
      b.worry.push({ text: `${f.unit_id}: ${fmtMoney(Math.abs(d), 0)} decline 2024→2025.`, section: 'rt-movers' });
    }
  }
  const growth = findings.products?.growingTop5_2025_to_2026 || findings.products?.growingTop5_2024_to_2025 || [];
  for (const f of growth.slice(0, 2)) {
    const sn = f.series_nonjlr || {};
    const ann = sn.y2026_annualised || 0;
    const y25 = sn.y2025 || 0;
    if (ann > y25 && ann > 1000) {
      b.working.push({ text: `${f.unit_id}: ${fmtMoney(y25, 0)} → ${fmtMoney(ann, 0)} (${findings.currentYear} ann.).`, section: 'rt-movers' });
    }
  }
}

const INVESTIGATE_SLUG_BLOCK = new Set([
  'about-alan-ranger',
  'testimonials-customer-reviews',
  'free-photography-tips',
  'jaguar-land-rover-els'
]);

function isExcludedInvestigateSlug(pageSlug) {
  const s = String(pageSlug || '').toLowerCase();
  if (!s || INVESTIGATE_SLUG_BLOCK.has(s)) return true;
  if (/jaguar-land-rover|(^|\/)blog|calculator|news|testimonial|about-alan|free-photography-tips/.test(s)) return true;
  return false;
}

function addDiagnosisBullets(b, diagnosis, windowMonths) {
  const tiers = diagnosis?.tier_rollup || [];
  const diags = diagnosis?.diagnostics || [];
  for (const t of tiers) {
    if (VOLATILE_TIER_KEYS.has(t.tier_key)) continue;
    if (t.severity === 'critical' && (t.pages_at_risk_gbp || 0) > 500) {
      b.worry.push({ text: `${t.label}: ${fmtMoney(t.pages_at_risk_gbp, 0)} at risk on diagnostic pages.`, section: 'rt-diag-section' });
    }
  }
  for (const d of diags) {
    if (VOLATILE_TIER_KEYS.has(d.tier_key)) continue;
    const fw = d.metrics?.full_window || {};
    const impD = d.deltas?.impressions?.adjusted;
    const slug = '/' + d.page_slug;
    if (impD != null && impD < -25 && (fw.impressions || 0) > 500) {
      b.worry.push({
        text: `${slugLink(slug, slug)}: impressions ${impD.toFixed(0)}% (season-adjusted).`,
        section: 'rt-diag-section',
        html: true
      });
    }
  }
  const investigate = diags
    .filter((d) => !VOLATILE_TIER_KEYS.has(d.tier_key))
    .filter((d) => RECURRING_TIER_KEYS.has(d.tier_key))
    .filter((d) => d.state === 'traffic_with_zero_conversion')
    .filter((d) => !isExcludedInvestigateSlug(d.page_slug))
    .filter((d) => (d.metrics?.full_window?.impressions || 0) > 1000)
    .sort((a, b) => (Number(b.metrics?.full_window?.impressions) || 0) - (Number(a.metrics?.full_window?.impressions) || 0))
    .slice(0, 5);
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
