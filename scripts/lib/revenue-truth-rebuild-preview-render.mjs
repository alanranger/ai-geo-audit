// Static HTML for REVENUE-TRUTH-REBUILD-PREVIEW gate (matches live tab section order).

import {
  escapeHtml,
  filterByVisible,
  fmtMoney,
  monthLabel,
  visibleMonthKeys
} from './snapshot-utils.mjs';
import { slugLink } from '../../lib/revenue-truth-ui-core.mjs';
import { renderSection9Html } from './section9-snapshot-render.mjs';

const BAND_LABEL = {
  thrive: 'Thrive (£8k+)',
  comfortable: 'Comfortable (£5k-£8k)',
  survival: 'Survival (£3k-£5k)',
  below_survival: 'Below survival (<£3k)'
};

function fmt(n, decimals = 0) {
  return fmtMoney(n, decimals);
}

function bandClass(b) {
  return 'band-' + (b || 'below_survival');
}

function fmtDelta(v) {
  const n = Number(v) || 0;
  const sign = n > 0 ? '+' : (n < 0 ? '-' : '');
  return sign + '£' + Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function seriesFor(finding, includeJlr) {
  return includeJlr ? finding.series_total : finding.series_nonjlr;
}

function deltaKeyFor(includeJlr, window) {
  const stem = includeJlr ? 'total_' : 'nonjlr_';
  return stem + (window === '2024->2025' ? '2024_to_2025' : '2025_to_2026');
}

function stripCard(label, value, meta, band) {
  const cls = band ? ' ' + bandClass(band) : '';
  return `<div class="rt-strip-card${cls}"><div class="rt-strip-label">${label}</div><div class="rt-strip-value">${value}</div><div class="rt-strip-meta">${meta || ''}</div></div>`;
}

function renderHeadlineStrip(strip, cfg) {
  if (!strip) return '';
  const latest = strip.latestClosedMonth;
  const ytd = strip.ytd;
  return [
    stripCard('Latest closed month', latest ? fmt(latest.headlineRevenue, 0) : '—', latest ? `${monthLabel(latest.year, latest.month)} · ${BAND_LABEL[latest.band] || latest.band}` : '', latest?.band),
    stripCard(`YTD ${ytd.year} headline`, fmt(ytd.ytdRevenue, 0), `Pro-rata target ${fmt(ytd.proRataTarget, 0)} (£60k year)`, null),
    stripCard('Trailing 3-month avg', fmt(strip.trailing3MonthAverage, 0), BAND_LABEL[strip.trailing3Band] || strip.trailing3Band, strip.trailing3Band),
    stripCard('Tier bands', `£${cfg.tierBands.survival} / £${cfg.tierBands.comfortable} / £${cfg.tierBands.thrive}`, 'Survival / Comfortable / Thrive (monthly)', null)
  ].join('');
}

function renderForecast(forecast) {
  if (!forecast) return '';
  const bands = [
    { label: 'Survival £36k', target: 36000 },
    { label: 'Comfortable £60k', target: 60000 },
    { label: 'Thrive £96k', target: 96000 }
  ];
  const central = forecast.forecastCentral;
  const bandCards = bands.map((b) => {
    const v = central - b.target;
    const vSign = v >= 0 ? '+' : '';
    return `<div class="rt-forecast-card"><div class="rt-fc-label">vs ${b.label}</div><div class="rt-fc-value ${v >= 0 ? 'is-positive' : 'is-negative'}">${vSign}${fmt(v, 0)}</div></div>`;
  }).join('');
  return `<div class="rt-forecast-grid">
<div class="rt-forecast-card"><div class="rt-fc-label">YTD actual</div><div class="rt-fc-value">${fmt(forecast.ytdActual, 0)}</div><div class="rt-fc-meta">${forecast.closedMonths} closed months · <span class="rt-basis-badge">Closed months only</span></div></div>
<div class="rt-forecast-card"><div class="rt-fc-label">Full-year forecast</div><div class="rt-fc-value">${fmt(central, 0)}</div><div class="rt-fc-meta">Range ${fmt(forecast.forecastLow, 0)} – ${fmt(forecast.forecastHigh, 0)}</div></div>
</div><div class="rt-forecast-grid">${bandCards}</div><div class="rt-forecast-formula"><strong>Formula:</strong> <code>${escapeHtml(forecast.formula)}</code></div>`;
}

function renderFindingRow(f, findings, window) {
  const s = seriesFor(f, false);
  const dk = deltaKeyFor(false, window);
  const d = f.deltas[dk] || { delta_gbp: 0 };
  const titleHtml = f.unit_type === 'page'
    ? slugLink(f.unit_id, String(f.unit_id).replace(/^https?:\/\/[^/]+/, ''))
    : escapeHtml(f.unit_id);
  return `<div class="rt-finding-row"><div class="rt-finding-title">${titleHtml}</div>
<div class="rt-finding-numbers">2024 ${fmt(s.y2024)} · 2025 ${fmt(s.y2025)} · 2026 ann. ${fmt(s.y2026_annualised)} · <span class="${d.delta_gbp < 0 ? 'is-negative' : 'is-positive'}">${fmtDelta(d.delta_gbp)}</span></div>
<div class="rt-finding-text">${escapeHtml(f.plain_text || '')}</div></div>`;
}

function renderMovers(findings, window = '2024->2025') {
  const winKey = window === '2024->2025' ? '2024_to_2025' : '2025_to_2026';
  const block = (title, list) => `<div class="rt-findings-card"><h4>${title}</h4>${!list.length ? '<p class="rt-sub">None in window.</p>' : list.map((f) => renderFindingRow(f, findings, window)).join('')}</div>`;
  return `<div class="rt-findings-grid">${block('Top 5 declining products', findings.products[`decliningTop5_${winKey}`] || [])}${block('Top 5 declining pages', findings.pages[`decliningTop5_${winKey}`] || [])}${block('Top 5 growing products', findings.products[`growingTop5_${winKey}`] || [])}</div>`;
}

function renderExecSummary(diagnosis, forecast) {
  const rec = diagnosis?.tier_reconciliation;
  const bullets = [];
  if (forecast && forecast.forecastCentral < 36000) {
    bullets.push(`Full-year forecast ${fmt(forecast.forecastCentral, 0)} is below the £36k survival band.`);
  }
  if (rec?.passes) bullets.push('Tier rollup reconciles penny-exact to booking sheet (non-JLR).');
  const body = bullets.length
    ? `<ul>${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`
    : '<p class="rt-sub">No worry points flagged from current data.</p>';
  return `<div id="rt-exec-summary" class="rt-exec-summary"><div class="rt-exec-head"><h3>Exec Summary — Revenue Truth</h3><span class="rt-basis-badge">Non-JLR / Net</span></div>
<div class="rt-exec-meta">Reconciliation: ${rec?.passes ? '✓ penny-exact non-JLR' : 'FAIL'}</div>${body}</div>`;
}

export function renderRebuildPreviewHtml({ summary, findings, diagnosis, breakdownSample, expandTiers, generatedAt, css = '' }) {
  const cfg = summary.config;
  const keys = visibleMonthKeys(summary.monthly, 'rolling13', cfg.now);
  const section9 = renderSection9Html(diagnosis, { expandTiers, breakdownSample });
  const ts = generatedAt || new Date().toISOString().slice(0, 19).replace('T', ' ');

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Revenue Truth rebuild preview</title>
<style>${css}</style>
</head>
<body>
<div class="wrap">
<div class="banner">
<strong>REVENUE TRUTH REBUILD PREVIEW</strong> — ${ts} UTC · hash gate file · <strong>NOT DEPLOYED</strong><br>
<span class="muted">Section order matches D1–D22 spec · §9 expanded: ${escapeHtml(section9.expandedLabels || 'none')}</span>
</div>

<div class="rt-page-header"><h2>Revenue Truth</h2></div>

${renderExecSummary(diagnosis, summary.forecast)}

<div class="rt-section"><h3>2. Headline</h3><span class="rt-basis-badge">Headline (12-category gross)</span><div class="rt-strip">${renderHeadlineStrip(summary.headlineStrip, cfg)}</div></div>

<div class="rt-section"><h3>1. Monthly revenue against tier bands</h3><p class="rt-sub">Thrive=purple · Comfortable=green · Survival=orange · Below survival=red</p></div>

<div class="rt-section rt-forecast"><h3>F. Forecast (full year)</h3><span class="rt-forecast-pill">PROJECTION</span>${renderForecast(summary.forecast)}</div>

<div class="rt-section rt-movers"><h3>Top declines &amp; growth</h3><span class="rt-analysis-pill">RECURRING ONLY</span>${renderMovers(findings)}</div>

<div class="rt-section rt-diag-section"><h3>9. Revenue Funnel Diagnosis</h3><div class="rt-diag-status">${escapeHtml(section9.statusLine)}</div><div class="rt-diag-tier-list">${section9.tierRowsHtml}</div></div>

<div class="rt-section"><h3>4 + 5. Category breakdown</h3><p class="rt-sub">Live dashboard includes sparkline + reversed month columns.</p></div>

<div class="rt-section"><h3>4b / 4c. Product &amp; page breakdown</h3><p class="rt-sub">${findings.products.all.length} products · ${findings.pages.all.length} pages</p></div>

<details class="rt-section rt-collapsible"><summary><h3 style="display:inline;">3. Market split</h3></summary><p class="rt-sub">Collapsed by default in live tab.</p></details>
<details class="rt-section rt-collapsible"><summary><h3 style="display:inline;">6–8. Reconciliation tables</h3></summary><p class="rt-sub">Collapsed by default in live tab.</p></details>

</div>
</body>
</html>`;
}
