// Static HTML renderers for Revenue Truth tab sections (snapshot use only).

import {
  escapeHtml,
  filterByVisible,
  fmtMoney,
  fmtN,
  monthLabel,
  monthShortByIndex,
  visibleMonthKeys
} from './snapshot-utils.mjs';
import { renderSection9Html } from './section9-snapshot-render.mjs';

const BAND_COLOURS = {
  thrive: '#22c55e',
  comfortable: '#f59e0b',
  survival: '#ea7e10',
  below_survival: '#ef4444',
  partial: '#64748b'
};

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

function marketPill(market) {
  const cls = market === 'D2C' ? 'd2c' : (market === 'B2B' ? 'b2b' : (market === 'ADJUSTMENT' ? 'adj' : ''));
  return `<span class="rt-pill ${cls}">${market}</span>`;
}

function fmtDelta(v) {
  const n = Number(v) || 0;
  const sign = n > 0 ? '+' : (n < 0 ? '-' : '');
  return sign + '£' + Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function deltaClass(v) {
  return v > 0 ? 'is-positive' : (v < 0 ? 'is-negative' : '');
}

function seriesFor(finding, includeJlr) {
  return includeJlr ? finding.series_total : finding.series_nonjlr;
}

function deltaKeyFor(includeJlr, window) {
  const stem = includeJlr ? 'total_' : 'nonjlr_';
  return stem + (window === '2024->2025' ? '2024_to_2025' : '2025_to_2026');
}

function renderTierChartTable(monthlyAll, cfg, keys) {
  const monthly = filterByVisible(monthlyAll, keys);
  const rows = monthly.map((m) => {
    const colour = m.isPartial ? BAND_COLOURS.partial : (BAND_COLOURS[m.band] || '#64748b');
    const partial = m.isPartial ? ' <span class="rt-pill partial">in progress</span>' : '';
    return `<tr><td>${monthLabel(m.year, m.month)}${partial}</td><td style="font-weight:700;">${fmt(m.headlineRevenue, 2)}</td><td>${BAND_LABEL[m.band] || m.band || '—'}</td><td><span class="rt-bar-swatch" style="background:${colour}"></span></td></tr>`;
  }).join('');
  const legend = ['thrive', 'comfortable', 'survival', 'below_survival'].map((b) =>
    `<span><span class="swatch" style="background:${BAND_COLOURS[b]}"></span>${BAND_LABEL[b]}</span>`
  ).join('') + `<span><span class="swatch" style="background:${BAND_COLOURS.partial}"></span>Month in progress</span>`;
  const note = `Showing rolling ${monthly.length} months. Chart.js bar chart in live dashboard; table below is the same data.`;
  return `<p class="rt-sub">${note}</p><div class="chart-placeholder">[Section 1 — Chart.js tier band chart placeholder]</div><div class="rt-table-scroll"><table class="rt-table"><thead><tr><th>Month</th><th>Headline £</th><th>Band</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><div class="rt-tier-legend">${legend}</div>`;
}

function renderHeadlineStrip(strip, cfg) {
  if (!strip) return '';
  const latest = strip.latestClosedMonth;
  const ytd = strip.ytd;
  const cards = [
    stripCard('Latest closed month', latest ? fmt(latest.headlineRevenue, 0) : '—', latest ? `${monthLabel(latest.year, latest.month)} · ${BAND_LABEL[latest.band] || latest.band}` : '', latest?.band),
    stripCard(`YTD ${ytd.year} headline`, fmt(ytd.ytdRevenue, 0), `Pro-rata target ${fmt(ytd.proRataTarget, 0)} (£60k year)`, null),
    stripCard('Trailing 3-month avg', fmt(strip.trailing3MonthAverage, 0), BAND_LABEL[strip.trailing3Band] || strip.trailing3Band, strip.trailing3Band),
    stripCard('Tier bands', `£${cfg.tierBands.survival} / £${cfg.tierBands.comfortable} / £${cfg.tierBands.thrive}`, 'Survival / Comfortable / Thrive (monthly)', null)
  ];
  return cards.join('');
}

function stripCard(label, value, meta, band) {
  const cls = band ? ' ' + bandClass(band) : '';
  return `<div class="rt-strip-card${cls}"><div class="rt-strip-label">${label}</div><div class="rt-strip-value">${value}</div><div class="rt-strip-meta">${meta || ''}</div></div>`;
}

function renderForecast(forecast) {
  if (!forecast) return '';
  const variance = forecast.varianceToAnnualTarget;
  const vCls = variance >= 0 ? 'is-positive' : 'is-negative';
  const vSign = variance >= 0 ? '+' : '';
  const monthlyVar = forecast.varianceToMonthlyTarget;
  const mvCls = monthlyVar >= 0 ? 'is-positive' : 'is-negative';
  const mvSign = monthlyVar >= 0 ? '+' : '';
  const cards = [
    forecastCard('YTD actual (closed months)', fmt(forecast.ytdActual, 0), `${forecast.closedMonths} closed months banked`, ''),
    forecastCard('Run rate', `${fmt(forecast.runRateMonthly, 0)} / month`, forecast.runRateBasis, ''),
    forecastCard('Months remaining', `${forecast.monthsRemaining} months`, `Current partial month + the rest of ${forecast.year}`, ''),
    forecastCard('Full-year forecast', fmt(forecast.forecastCentral, 0), `Range ${fmt(forecast.forecastLow, 0)} – ${fmt(forecast.forecastHigh, 0)} (trailing-3 min/max)`, ''),
    forecastCard('Variance vs £60k annual', vSign + fmt(variance, 0), `Annual target ${fmt(forecast.annualTarget, 0)} (= £${forecast.monthlyTarget.toLocaleString('en-GB')} × 12)`, vCls),
    forecastCard('Run rate vs £5k comfortable', mvSign + fmt(monthlyVar, 0) + ' / month', `Comfortable monthly target ${fmt(forecast.monthlyTarget, 0)}`, mvCls)
  ].join('');
  return `<div class="rt-forecast-grid">${cards}</div><div class="rt-forecast-formula"><strong>Formula:</strong> <code>${escapeHtml(forecast.formula)}</code></div><div class="rt-forecast-caveat">${escapeHtml(forecast.caveat)}</div>`;
}

function forecastCard(label, value, meta, valueCls) {
  return `<div class="rt-forecast-card"><div class="rt-fc-label">${label}</div><div class="rt-fc-value ${valueCls || ''}">${value}</div><div class="rt-fc-meta">${meta}</div></div>`;
}

function renderMarketTable(monthlyAll, keys) {
  const monthly = filterByVisible(monthlyAll, keys);
  const rows = monthly.map((m) => {
    const partial = m.isPartial ? '<span class="rt-pill partial">in progress</span>' : '';
    return `<tr><td>${monthLabel(m.year, m.month)} ${partial}</td><td>${fmt(m.d2c)}</td><td>${fmt(m.b2b)}</td><td>${fmt(m.operationalRevenue)}</td><td class="${m.adjustmentNet < 0 ? 'is-negative' : ''}">${fmt(m.adjustmentNet)}</td><td style="font-weight:700;">${fmt(m.headlineRevenue)}</td></tr>`;
  }).join('');
  return `<table class="rt-table"><thead><tr><th>Month</th><th>D2C</th><th>B2B</th><th>Operational</th><th>Adjustment</th><th>Headline</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderPivotTable(rows, dimensionHeader, labelFn, keys) {
  const visible = filterByVisible(rows, keys);
  const pivot = pivotMonthRows(visible, labelFn);
  const head = `<thead><tr><th>${dimensionHeader}</th>${pivot.months.map((m) => `<th>${monthLabel(m.year, m.month)}</th>`).join('')}<th>Total revenue</th><th>Total units</th></tr></thead>`;
  const body = pivot.dims.map((dim) => pivotRowHtml(dim, pivot)).join('');
  const foot = pivotTotalRow(pivot);
  return `<table class="rt-table">${head}<tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;
}

function pivotMonthRows(rows, labelFn) {
  const monthSet = new Map();
  const dimSet = new Map();
  const cellMap = new Map();
  for (const r of rows) {
    monthSet.set(r.year * 100 + r.month, { year: r.year, month: r.month });
    const lbl = labelFn(r);
    dimSet.set(lbl, lbl);
    cellMap.set(`${r.year}|${r.month}|${lbl}`, r);
  }
  return {
    months: [...monthSet.values()].sort((a, b) => (a.year - b.year) || (a.month - b.month)),
    dims: [...dimSet.keys()].sort(),
    cellMap
  };
}

function pivotRowHtml(dim, pivot) {
  let totalRev = 0;
  let totalUnits = 0;
  const cells = pivot.months.map((m) => {
    const r = pivot.cellMap.get(`${m.year}|${m.month}|${dim}`);
    if (!r) return '<td></td>';
    totalRev += r.revenue;
    totalUnits += r.units;
    return `<td title="${r.units} units">${fmt(r.revenue)}</td>`;
  }).join('');
  return `<tr><td>${escapeHtml(dim)}</td>${cells}<td style="font-weight:700;">${fmt(totalRev)}</td><td>${totalUnits}</td></tr>`;
}

function pivotTotalRow(pivot) {
  let grandRev = 0;
  let grandUnits = 0;
  const cells = pivot.months.map((m) => {
    let monthRev = 0;
    let monthUnits = 0;
    for (const dim of pivot.dims) {
      const r = pivot.cellMap.get(`${m.year}|${m.month}|${dim}`);
      if (r) { monthRev += r.revenue; monthUnits += r.units; }
    }
    grandRev += monthRev;
    grandUnits += monthUnits;
    return `<td title="${monthUnits} units">${fmt(monthRev)}</td>`;
  }).join('');
  return `<tr><td>Total</td>${cells}<td>${fmt(grandRev)}</td><td>${grandUnits}</td></tr>`;
}

function renderCategoryTable(catsAll, keys) {
  const cats = filterByVisible(catsAll, keys);
  const pivot = pivotCategoryByMonth(cats, 'market');
  const head = categoryTableHead(pivot.months);
  const body = pivot.categories.map((cat) => categoryRow(cat, pivot)).join('');
  const foot = categoryTotalRow(pivot);
  return `<table class="rt-table">${head}<tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;
}

function pivotCategoryByMonth(cats, sortMode) {
  const monthSet = new Map();
  const catSet = new Map();
  const cellMap = new Map();
  for (const c of cats) {
    monthSet.set(c.year * 100 + c.month, { year: c.year, month: c.month });
    catSet.set(c.category_order, { order: c.category_order, label: c.category_label, market: c.market });
    cellMap.set(`${c.year}|${c.month}|${c.category_order}`, c);
  }
  const months = [...monthSet.values()].sort((a, b) => (a.year - b.year) || (a.month - b.month));
  const categories = sortMode === 'market'
    ? [...catSet.values()].sort((a, b) => {
      const rank = { D2C: 0, B2B: 1, ADJUSTMENT: 2, UNKNOWN: 3 };
      const ra = rank[a.market] ?? 4;
      const rb = rank[b.market] ?? 4;
      return ra !== rb ? ra - rb : a.order - b.order;
    })
    : [...catSet.values()].sort((a, b) => a.order - b.order);
  return { months, categories, cellMap };
}

function categoryTableHead(months) {
  const monthHeaders = months.map((m) => `<th>${monthLabel(m.year, m.month)}</th>`).join('');
  return `<thead><tr><th>Category</th><th>Market</th>${monthHeaders}<th>Total</th></tr></thead>`;
}

function categoryRow(cat, pivot) {
  let rowTotal = 0;
  const cells = pivot.months.map((m) => {
    const c = pivot.cellMap.get(`${m.year}|${m.month}|${cat.order}`);
    const value = c ? c.revenue : null;
    if (value != null) rowTotal += value;
    if (value == null) return '<td></td>';
    return `<td class="${value < 0 ? 'is-negative' : ''}">${fmt(value)}</td>`;
  }).join('');
  return `<tr><td>${escapeHtml(cat.label)}</td><td>${marketPill(cat.market)}</td>${cells}<td style="font-weight:700;">${fmt(rowTotal)}</td></tr>`;
}

function categoryTotalRow(pivot) {
  let grand = 0;
  const cells = pivot.months.map((m) => {
    let mTotal = 0;
    for (const cat of pivot.categories) {
      const c = pivot.cellMap.get(`${m.year}|${m.month}|${cat.order}`);
      if (c) mTotal += c.revenue;
    }
    grand += mTotal;
    return `<td class="${mTotal < 0 ? 'is-negative' : ''}">${fmt(mTotal)}</td>`;
  }).join('');
  return `<tr><td>Total</td><td></td>${cells}<td>${fmt(grand)}</td></tr>`;
}

function renderFundingTable(funding, keys) {
  const visible = filterByVisible(funding, keys);
  const months = uniqueMonths(visible);
  const fundings = uniqueValues(visible, (r) => r.funding);
  const cellMap = new Map();
  for (const r of visible) cellMap.set(`${r.year}|${r.month}|${r.funding}`, r);
  const head = `<thead><tr><th>Funding</th>${months.map((m) => `<th>${monthLabel(m.year, m.month)}</th>`).join('')}<th>Total gross</th><th>Total fees</th><th>Total net</th></tr></thead>`;
  const body = fundings.map((f) => fundingRowHtml(f, months, cellMap)).join('');
  const foot = fundingTotalRow(fundings, months, cellMap);
  return `<table class="rt-table">${head}<tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;
}

function fundingRowHtml(f, months, cellMap) {
  let totalGross = 0;
  let totalFees = 0;
  const cells = months.map((m) => {
    const r = cellMap.get(`${m.year}|${m.month}|${f}`);
    if (!r) return '<td></td>';
    totalGross += r.revenue;
    totalFees += r.feesEstimated;
    return `<td class="${r.revenue < 0 ? 'is-negative' : ''}">${fmt(r.revenue)}</td>`;
  }).join('');
  return `<tr><td>${escapeHtml(f)}</td>${cells}<td style="font-weight:700;">${fmt(totalGross)}</td><td>${fmt(totalFees, 2)}</td><td style="font-weight:700;">${fmt(totalGross - totalFees)}</td></tr>`;
}

function fundingTotalRow(fundings, months, cellMap) {
  let grandGross = 0;
  let grandFees = 0;
  const cells = months.map((m) => {
    let monthGross = 0;
    for (const f of fundings) {
      const r = cellMap.get(`${m.year}|${m.month}|${f}`);
      if (r) monthGross += r.revenue;
    }
    grandGross += monthGross;
    return `<td>${fmt(monthGross)}</td>`;
  }).join('');
  for (const f of fundings) {
    for (const m of months) {
      const r = cellMap.get(`${m.year}|${m.month}|${f}`);
      if (r) grandFees += r.feesEstimated;
    }
  }
  return `<tr><td>Total</td>${cells}<td>${fmt(grandGross)}</td><td>${fmt(grandFees, 2)}</td><td>${fmt(grandGross - grandFees)}</td></tr>`;
}

function uniqueMonths(rows) {
  const set = new Map();
  for (const r of rows) set.set(r.year * 100 + r.month, { year: r.year, month: r.month });
  return [...set.values()].sort((a, b) => (a.year - b.year) || (a.month - b.month));
}

function uniqueValues(rows, keyFn) {
  const set = new Set();
  for (const r of rows) set.add(keyFn(r));
  return [...set].sort();
}

function buildHeadlineCard(label, value, meta, deltaValue) {
  const deltaHtml = deltaValue == null ? '' : `<div class="rt-delta ${deltaClass(deltaValue)}" style="font-size:0.8rem; margin-top:0.2rem; font-weight:700;">${fmtDelta(deltaValue)}</div>`;
  return `<div class="rt-findings-headline-card"><div class="rt-fhc-label">${label}</div><div class="rt-fhc-value">£${Math.round(value).toLocaleString('en-GB')}</div>${deltaHtml}${meta ? `<div class="rt-fhc-meta">${meta}</div>` : ''}</div>`;
}

function buildForecastCard(forecast) {
  if (!forecast) return '';
  const mid = Math.round(forecast.total_full_year_mid).toLocaleString('en-GB');
  const lo = Math.round(forecast.total_full_year_low).toLocaleString('en-GB');
  const hi = Math.round(forecast.total_full_year_high).toLocaleString('en-GB');
  const pct = Math.round((forecast.range_pct || 0) * 100);
  return `<div class="rt-findings-headline-card rt-fhc-forecast"><div class="rt-fhc-label">${forecast.base_years[0]}-${forecast.base_years[1]}-seasonally-adjusted forecast</div><div class="rt-fhc-value">£${mid}</div><div class="rt-fhc-range">range ±${pct}% &nbsp; £${lo} – £${hi}</div><div class="rt-fhc-meta">Non-JLR. Closed months only (Jan-${monthShortByIndex(forecast.closed_months_current_year)}).</div></div>`;
}

function renderFindingRow(f, findings, includeJlr, window) {
  const s = seriesFor(f, includeJlr);
  const dk = deltaKeyFor(includeJlr, window);
  const d = f.deltas[dk] || { delta_gbp: 0, delta_pct: null };
  const title = f.unit_type === 'page' ? String(f.unit_id).replace(/^https?:\/\/[^/]+/, '') : f.unit_id;
  const numbers = `<span>£${Math.round(s.y2024).toLocaleString('en-GB')} → £${Math.round(s.y2025).toLocaleString('en-GB')} → £${Math.round(s.y2026_annualised).toLocaleString('en-GB')} (${findings.currentYear} ann.)</span><span class="rt-num-delta ${deltaClass(d.delta_gbp)}" style="margin-left:0.5rem;">${fmtDelta(d.delta_gbp)}${d.delta_pct != null ? ` (${d.delta_pct > 0 ? '+' : ''}${d.delta_pct}%)` : ''}</span>`;
  return `<div class="rt-finding-row"><div class="rt-finding-title">${escapeHtml(title)}</div><div class="rt-finding-numbers">${numbers}</div><div class="rt-finding-text">${escapeHtml(f.plain_text || '')}</div></div>`;
}

function renderFindingsSection(findings, includeJlr = false, window = '2024->2025') {
  const s = includeJlr ? findings.headline.total : findings.headline.nonjlr;
  const closedM = findings.closedMonthsCurrentYear;
  const cards = [
    buildHeadlineCard('2024 actual', s.y2024, '', null),
    buildHeadlineCard('2025 actual', s.y2025, '', s.delta_2024_to_2025),
    buildHeadlineCard(`${findings.currentYear} YTD (closed months)`, s.y2026_ytd_closed, `£${Math.round(s.y2026_ytd_closed).toLocaleString('en-GB')} from ${closedM} closed months`, null),
    includeJlr ? buildHeadlineCard(`${findings.currentYear} annualised`, s.y2026_annualised, 'JLR-included naive run-rate', s.delta_2025_to_2026) : buildForecastCard(findings.seasonal_forecast)
  ].join('');
  const winKey = window === '2024->2025' ? '2024_to_2025' : '2025_to_2026';
  const declineProducts = findings.products[`decliningTop5_${winKey}`] || [];
  const declinePages = findings.pages[`decliningTop5_${winKey}`] || [];
  const growthProducts = findings.products[`growingTop5_${winKey}`] || [];
  const mapRows = (list, mode) => !list.length
    ? `<p class="rt-sub" style="margin:0;">No ${mode} candidates in this window.</p>`
    : list.map((f) => renderFindingRow(f, findings, includeJlr, window)).join('');
  const flags = findings.flags || {};
  const flagsHtml = ['one_offs', 'retired_wind_downs', 'new_launches'].map((key) => {
    const rows = flags[key] || [];
    const title = key.replace(/_/g, ' ');
    if (!rows.length) return `<div><strong style="font-size:0.78rem;">${title}:</strong> <span class="rt-sub" style="display:inline;">none</span></div>`;
    return `<div><strong style="font-size:0.78rem;">${title} (${rows.length}):</strong><ul style="margin:0.2rem 0 0 1rem; font-size:0.76rem; color:#94a3b8;">${rows.slice(0, 6).map((r) => `<li>${escapeHtml(r.note || r.unit_id || '')}</li>`).join('')}</ul></div>`;
  }).join('');
  return `<div class="rt-findings-headline"><div class="rt-findings-headline-strip">${cards}</div><div class="rt-findings-summary"><strong>JLR-stripped (default):</strong> ${escapeHtml(findings.headline.summarySentence || '')}</div></div><div class="rt-findings-grid"><div class="rt-findings-card"><h4>Top 5 declining products</h4>${mapRows(declineProducts, 'declining')}</div><div class="rt-findings-card"><h4>Top 5 declining pages</h4>${mapRows(declinePages, 'declining')}</div><div class="rt-findings-card"><h4>Top 5 growing products</h4>${mapRows(growthProducts, 'growing')}</div><div class="rt-findings-card"><h4>Flags &amp; caveats</h4>${flagsHtml}</div></div>`;
}

function rowDataForBreakdown(f, includeJlr, window) {
  const s = seriesFor(f, includeJlr);
  const d24 = f.deltas[deltaKeyFor(includeJlr, '2024->2025')] || { delta_gbp: 0 };
  const d25 = f.deltas[deltaKeyFor(includeJlr, '2025->2026')] || { delta_gbp: 0 };
  return {
    unit: f.unit_id,
    y2024: s.y2024 || 0,
    y2025: s.y2025 || 0,
    y2026_ytd: s.y2026_ytd || 0,
    y2026_ann: s.y2026_annualised || 0,
    delta24to25: d24.delta_gbp || 0,
    delta25to26: d25.delta_gbp || 0,
    units: includeJlr ? (f.counts?.y2025 || 0) : (f.counts?.y2025_nonjlr || 0)
  };
}

function buildBreakdownHtml(rows, unitType) {
  const head = `<thead><tr><th>${unitType === 'product' ? 'Product' : 'Landing page'}</th><th>2024</th><th>2025</th><th>2026 YTD</th><th>2026 ann.</th><th>Δ 2024→25</th><th>Δ 2025→26 ann.</th><th>2025 #</th></tr></thead>`;
  const body = rows.map((r) => {
    const unit = unitType === 'page' ? escapeHtml(String(r.unit).replace(/^https?:\/\/[^/]+/, '')) : escapeHtml(r.unit);
    return `<tr><td class="unit-cell">${unit}</td><td>${fmt(r.y2024)}</td><td>${fmt(r.y2025)}</td><td>${fmt(r.y2026_ytd)}</td><td>${fmt(r.y2026_ann)}</td><td class="${r.delta24to25 < 0 ? 'is-negative' : ''}">${fmtDelta(r.delta24to25)}</td><td class="${r.delta25to26 < 0 ? 'is-negative' : ''}">${fmtDelta(r.delta25to26)}</td><td>${r.units}</td></tr>`;
  }).join('');
  return `<table class="rt-table rt-breakdown-table">${head}<tbody>${body}</tbody></table>`;
}

function renderBreakdownTables(findings, includeJlr = false) {
  const productRows = findings.products.all.map((f) => rowDataForBreakdown(f, includeJlr, '2024->2025'))
    .sort((a, b) => a.delta24to25 - b.delta24to25);
  const pageRows = findings.pages.all.map((f) => rowDataForBreakdown(f, includeJlr, '2024->2025'))
    .sort((a, b) => a.delta24to25 - b.delta24to25);
  return {
    productsHtml: buildBreakdownHtml(productRows, 'product'),
    pagesHtml: buildBreakdownHtml(pageRows, 'page'),
    productCount: productRows.length,
    pageCount: pageRows.length
  };
}

export function renderFullPageHtml({ summary, findings, diagnosis, breakdownSample, expandTiers, generatedAt, css = '' }) {
  const cfg = summary.config;
  const keys = visibleMonthKeys(summary.monthly, 'rolling13', cfg.now);
  const section9 = renderSection9Html(diagnosis, { expandTiers, breakdownSample });
  const breakdown = renderBreakdownTables(findings, false);
  const ts = generatedAt || new Date().toISOString().slice(0, 19).replace('T', ' ');

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Revenue Truth — full page snapshot</title>
<style>${css}</style>
</head>
<body>
<div class="wrap">
<div class="banner">
<strong>Revenue Truth — full tab snapshot</strong> — generated ${ts} UTC · live APIs · shareable static HTML<br>
<span class="muted">Defaults: rolling 13 months · JLR-stripped analysis · 2024→2025 window · §9 expanded: ${escapeHtml(section9.expandedLabels || 'none')}</span>
</div>

<div class="rt-page-header">
<h2>Revenue Truth</h2>
<p class="rt-sub">Measured revenue history from the Booking Sheet — the single source of truth. Snapshot of the live dashboard tab (analysis, sections 1–8, F, 4b, 4c, §9).</p>
</div>

<div class="rt-section rt-analysis">
<div class="rt-analysis-header"><div><h3>What's Changed &amp; Why <span class="rt-analysis-pill">ANALYSIS</span></h3></div></div>
${renderFindingsSection(findings, false, '2024->2025')}
</div>

<div class="rt-section">
<h3>1. Monthly revenue against tier bands</h3>
${renderTierChartTable(summary.monthly, cfg, keys)}
</div>

<div class="rt-section">
<h3>2. Headline</h3>
<div class="rt-strip">${renderHeadlineStrip(summary.headlineStrip, cfg)}</div>
</div>

<div class="rt-section rt-forecast">
<div style="display:flex;gap:0.6rem;align-items:baseline;flex-wrap:wrap;"><h3 style="display:inline;">F. Forecast (full year)</h3><span class="rt-forecast-pill">PROJECTION</span></div>
${renderForecast(summary.forecast)}
</div>

<div class="rt-section">
<h3>3. Market split (D2C / B2B / ADJUSTMENT)</h3>
<div class="rt-table-scroll">${renderMarketTable(summary.monthly, keys)}</div>
</div>

<div class="rt-section">
<h3>4 + 5. Category breakdown (revenue, units, average price, GP)</h3>
<div class="rt-table-scroll">${renderCategoryTable(summary.categoryBreakdown, keys)}</div>
</div>

<div class="rt-section">
<h3>4b. Product breakdown (canonical_product)</h3>
<p class="rt-sub">${breakdown.productCount} products · sorted by Δ 2024→25 (most negative first) · JLR-stripped</p>
<div class="rt-table-scroll">${breakdown.productsHtml}</div>
</div>

<div class="rt-section">
<h3>4c. Page breakdown (landing_page_url)</h3>
<p class="rt-sub">${breakdown.pageCount} pages · sorted by Δ 2024→25 · JLR-stripped</p>
<div class="rt-table-scroll">${breakdown.pagesHtml}</div>
</div>

<div class="rt-section rt-diag-section">
<div class="rt-diag-header"><div><h3>9. Revenue Funnel Diagnosis <span class="rt-diag-pill">TIER → PAGE → PRODUCT</span></h3></div></div>
<div class="rt-diag-status">${escapeHtml(section9.statusLine)}</div>
<div class="rt-diag-tier-list-header"><div>Tier</div><div>Revenue trend</div><div>GSC by page role</div><div style="text-align:right;">Page states</div></div>
<div class="rt-diag-tier-list">${section9.tierRowsHtml}</div>
</div>

<div class="rt-section">
<h3>6. Channel mix (booking source)</h3>
<div class="rt-table-scroll">${renderPivotTable(summary.channelMix, 'Channel', (r) => r.label, keys)}</div>
</div>

<div class="rt-section">
<h3>7. New vs Existing clients</h3>
<div class="rt-table-scroll">${renderPivotTable(summary.newVsExisting, 'Client type', (r) => r.label, keys)}</div>
</div>

<div class="rt-section">
<h3>8. Funding source &amp; estimated payment fees</h3>
<div class="rt-table-scroll">${renderFundingTable(summary.fundingFees, keys)}</div>
</div>

</div>
</body>
</html>`;
}
