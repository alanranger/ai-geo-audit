/** Table + strip HTML renderers (D5–D12, D17, D19). */

import {
  escapeHtml, slugLink, tip, basisBadge, fmtMoney, BAND_LABEL, BAND_COLOURS
} from './revenue-truth-ui-core.mjs';
import { deltaChipHtml, pctChange } from './revenue-truth-gsc-deltas.mjs';
import {
  headlineSignals, forecastSignals, headlineForecastSignals, channelSignals, clientsSignals, moversCardSignals
} from './revenue-truth-key-signals.mjs';

export function monthLabel(y, m) {
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

export function reverseMonths(months) {
  return months.slice().reverse();
}

export function inlineSparkline(values, colour) {
  const nums = (values || []).map((v) => Number(v) || 0);
  if (!nums.length) return '<span class="rt-spark-empty">—</span>';
  const w = 56, h = 18, pad = 1;
  const max = Math.max(1, Math.max(...nums));
  const step = (w - 2 * pad) / Math.max(1, nums.length - 1);
  const pts = nums.map((v, i) => `${(pad + i * step).toFixed(1)},${(h - pad - (v / max) * (h - 2 * pad)).toFixed(1)}`).join(' ');
  return `<svg class="rt-inline-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${colour || '#60a5fa'}" stroke-width="1.5"/></svg>`;
}

function bandClass(b) {
  return 'band-' + (b || 'below_survival');
}

function fmtDelta(v) {
  const n = Number(v) || 0;
  const sign = n > 0 ? '+' : (n < 0 ? '-' : '');
  return sign + '£' + Math.abs(n).toLocaleString('en-GB', { maximumFractionDigits: 0 });
}

function marketPill(market) {
  const cls = market === 'D2C' ? 'd2c' : (market === 'B2B' ? 'b2b' : (market === 'ADJUSTMENT' ? 'adj' : ''));
  return `<span class="rt-pill ${cls}">${market}</span>`;
}

function sumNums(nums) {
  return (nums || []).reduce((s, v) => s + (Number(v) || 0), 0);
}

function grandTotalRow(cells) {
  return `<tfoot><tr class="rt-grand-total">${cells}</tr></tfoot>`;
}

function gtLabel(text = 'Grand total') {
  return `<td class="rt-grand-total-label">${escapeHtml(text)}</td>`;
}

function gtMoney(n, decimals = 0) {
  return `<td class="rt-grand-total-num">${fmtMoney(n, decimals)}</td>`;
}

function gtEmpty(count = 1) {
  return '<td></td>'.repeat(count);
}

function sparkDeltaCol(rows, valueFn) {
  const vals = rows.map(valueFn);
  const recent = vals.slice(-6);
  const prior = vals.slice(-12, -6);
  const r = recent.reduce((s, v) => s + v, 0);
  const p = prior.reduce((s, v) => s + v, 0);
  return `<td>${inlineSparkline(vals, '#6366f1')} ${deltaChipHtml(pctChange(r, p), '6mo')}</td>`;
}

export function renderHeadlineStripHtml(strip, cfg) {
  if (!strip) return '';
  const latest = strip.latestClosedMonth;
  const ytd = strip.ytd;
  const cards = [
    stripCard('Latest closed month', latest ? fmtMoney(latest.headlineRevenue, 0) : '—', latest ? `${monthLabel(latest.year, latest.month)} · ${BAND_LABEL[latest.band]}` : '', latest?.band, 'headline_gross'),
    stripCard(`YTD ${ytd.year} headline`, fmtMoney(ytd.ytdRevenue, 0), `Pro-rata ${fmtMoney(ytd.proRataTarget, 0)} · includes partial month`, null, 'headline_gross'),
    stripCard('Trailing 3-month avg', fmtMoney(strip.trailing3MonthAverage, 0), BAND_LABEL[strip.trailing3Band], strip.trailing3Band, 'closed_only'),
    stripCard('Tier bands / mo', `£${cfg.tierBands.survival} / £${cfg.tierBands.comfortable} / £${cfg.tierBands.thrive}`, 'Survival / Comfortable / Thrive', null, null)
  ].join('');
  return cards;
}

const FORECAST_BANDS = [
  { label: 'Survival £36k', target: 36000 },
  { label: 'Comfortable £60k', target: 60000 },
  { label: 'Thrive £96k', target: 96000 }
];

function forecastBandCards(central, suffix = '') {
  return FORECAST_BANDS.map((b) => {
    const v = central - b.target;
    const sign = v >= 0 ? '+' : '';
    return `<div class="rt-forecast-card${suffix ? ' ' + suffix : ''}"><div class="rt-fc-label">vs ${b.label}${suffix ? ' (live mo.)' : ''}</div><div class="rt-fc-value ${v >= 0 ? 'is-positive' : 'is-negative'}">${sign}${fmtMoney(v, 0)}</div></div>`;
  }).join('');
}

function forecastScenarioCard(label, value, meta, cls = '') {
  return `<div class="rt-forecast-card${cls ? ' ' + cls : ''}"><div class="rt-fc-label">${escapeHtml(label)}</div><div class="rt-fc-value">${fmtMoney(value, 0)}</div>${meta ? `<div class="rt-fc-meta">${meta}</div>` : ''}</div>`;
}

/** Combined §2 Headline + §F Forecast — single panel with live-month-aware projection primary. */
export function renderHeadlineForecastPanelHtml(strip, cfg, forecast, pulse) {
  if (!strip && !forecast) return '';
  const fi = pulse?.forecast_impact;
  const closed = forecast?.forecastCentral || 0;
  const livePrimary = fi?.revised_forecast_primary ?? forecast?.forecastInclCurrent;
  const liveLabel = fi?.revised_blended_label || forecast?.forecastInclCurrentLabel || 'Incl. current-month projection';
  const liveDelta = fi?.delta_gbp ?? forecast?.forecastInclCurrentDelta;
  const hasLive = livePrimary != null && pulse?.is_partial !== false;
  const stripHtml = strip ? `<div class="rt-hf-measured"><div class="rt-hf-subhead">Measured headline</div><div class="rt-strip">${renderHeadlineStripHtml(strip, cfg)}</div></div>` : '';
  const gapCallout = hasLive && Math.abs((liveDelta || 0)) >= 500
    ? `<div class="rt-hf-gap-callout">Closed-month-only ${fmtMoney(closed, 0)} ignores the live partial month. Live-month-aware forecast: <strong>${fmtMoney(livePrimary, 0)}</strong> (${fmtMoney(liveDelta || 0, 0)}).</div>`
    : '';
  const scenarioGrid = forecast ? `<div class="rt-forecast-grid">`
    + (hasLive ? forecastScenarioCard(liveLabel, livePrimary, `${fmtMoney(liveDelta || 0, 0)} vs closed-only`, 'is-primary') : '')
    + forecastScenarioCard(forecast.forecastCentralLabel || 'Closed-months-only', closed, `${fmtMoney(forecast.forecastLow, 0)} – ${fmtMoney(forecast.forecastHigh, 0)}`, hasLive ? 'is-muted' : '')
    + (hasLive && fi?.revised_forecast != null && fi.revised_forecast !== livePrimary
      ? forecastScenarioCard(fi.revised_label || 'Linear current-month', fi.revised_forecast, 'Headline linear pace', 'is-alt')
      : '')
    + `</div>` : '';
  const bandGrid = forecast ? `<div class="rt-hf-band-row">`
    + (hasLive ? `<div><div class="rt-hf-subhead">vs annual targets (live-month-aware)</div><div class="rt-forecast-grid">${forecastBandCards(livePrimary, 'is-primary')}</div></div>` : '')
    + `<div><div class="rt-hf-subhead">vs annual targets (closed-months-only)</div><div class="rt-forecast-grid">${forecastBandCards(closed, hasLive ? 'is-muted' : '')}</div></div>`
    + `</div>` : '';
  const formula = forecast ? `<div class="rt-forecast-formula"><strong>Closed-only formula:</strong> <code>${escapeHtml(forecast.formula)}</code>`
    + (hasLive ? `<br><strong>Live-month-aware:</strong> <code>YTD closed + current-month projection + (trailing-3 avg × months after current)</code>` : '')
    + `</div><div class="rt-forecast-caveat">${escapeHtml(forecast.caveat || '')}</div>` : '';
  const projection = forecast ? `<div class="rt-hf-projection"><div class="rt-headline-forecast-divider"><span class="rt-forecast-pill">PROJECTION</span> Full-year forecast</div>`
    + `<div class="rt-basis-note">${basisBadge('closed_only')} YTD closed ${fmtMoney(forecast.ytdActual, 0)} from ${forecast.closedMonths} closed months · compare with live-month scenario above.</div>`
    + gapCallout + scenarioGrid + bandGrid + formula + `</div>` : '';
  return stripHtml + projection;
}

export { headlineForecastSignals };

function stripCard(label, value, meta, band, basis) {
  const cls = band ? ' ' + bandClass(band) : '';
  const badge = basis ? basisBadge(basis) : '';
  return `<div class="rt-strip-card${cls}"><div class="rt-strip-label">${label} ${badge}</div><div class="rt-strip-value">${value}</div><div class="rt-strip-meta">${meta || ''}</div></div>`;
}

export function renderForecastHtml(forecast) {
  if (!forecast) return '';
  const signals = forecastSignals(forecast);
  const central = forecast.forecastCentral || 0;
  const bands = [
    { label: 'Survival £36k', target: 36000 },
    { label: 'Comfortable £60k', target: 60000 },
    { label: 'Thrive £96k', target: 96000 }
  ];
  const bandCards = bands.map((b) => {
    const v = central - b.target;
    const sign = v >= 0 ? '+' : '';
    return `<div class="rt-forecast-card"><div class="rt-fc-label">vs ${b.label}</div><div class="rt-fc-value ${v >= 0 ? 'is-positive' : 'is-negative'}">${sign}${fmtMoney(v, 0)}</div></div>`;
  }).join('');
  const incl = forecast.forecastInclCurrent;
  const inclDelta = forecast.forecastInclCurrentDelta;
  const inclBandCards = incl == null ? '' : bands.map((b) => {
    const v = incl - b.target;
    const sign = v >= 0 ? '+' : '';
    return `<div class="rt-forecast-card is-alt"><div class="rt-fc-label">vs ${b.label} (incl. live mo.)</div><div class="rt-fc-value ${v >= 0 ? 'is-positive' : 'is-negative'}">${sign}${fmtMoney(v, 0)}</div></div>`;
  }).join('');
  return signals
    + `<div class="rt-basis-note">${basisBadge('closed_only')} YTD ${fmtMoney(forecast.ytdActual, 0)} from ${forecast.closedMonths} closed months.</div>`
    + `<div class="rt-forecast-grid">`
    + `<div class="rt-forecast-card"><div class="rt-fc-label">${escapeHtml(forecast.forecastCentralLabel || 'Closed-months-only')}</div><div class="rt-fc-value">${fmtMoney(central, 0)}</div><div class="rt-fc-meta">${fmtMoney(forecast.forecastLow, 0)} – ${fmtMoney(forecast.forecastHigh, 0)}</div></div>`
    + (incl == null ? '' : `<div class="rt-forecast-card is-alt"><div class="rt-fc-label">${escapeHtml(forecast.forecastInclCurrentLabel || 'Incl. current-month projected')}</div><div class="rt-fc-value ${(inclDelta || 0) < 0 ? 'is-negative' : ''}">${fmtMoney(incl, 0)}</div><div class="rt-fc-meta">${fmtMoney(inclDelta || 0, 0)} vs closed-only</div></div>`)
    + `</div><div class="rt-forecast-grid">${bandCards}</div>`
    + (inclBandCards ? `<div class="rt-forecast-grid rt-forecast-grid-alt">${inclBandCards}</div>` : '')
    + `<div class="rt-forecast-formula"><strong>Formula:</strong> <code>${escapeHtml(forecast.formula)}</code></div>`;
}

export function renderMarketTable(monthlyAll, keys) {
  const monthly = reverseMonths(monthlyAll.filter((m) => keys.has(`${m.year}|${m.month}`)));
  const head = `<thead><tr><th>Month</th><th>D2C</th><th>B2B</th><th title="Operational = real service sales (D2C + B2B)">Operational</th><th title="Adjustment = voucher/Pick'n'Mix timing (nets ~£0)">Adjustment</th><th title="Headline = booked total">Headline</th></tr></thead>`;
  const rows = monthly.map((m) => {
    const partial = m.isPartial ? ' <span class="rt-pill partial">in progress</span>' : '';
    return `<tr><td>${monthLabel(m.year, m.month)}${partial}</td><td>${fmtMoney(m.d2c)}</td><td>${fmtMoney(m.b2b)}</td><td>${fmtMoney(m.operationalRevenue)}</td><td class="${m.adjustmentNet < 0 ? 'is-negative' : ''}">${fmtMoney(m.adjustmentNet)}</td><td style="font-weight:700;">${fmtMoney(m.headlineRevenue)}</td></tr>`;
  }).join('');
  const foot = grandTotalRow(
    gtLabel()
    + gtMoney(sumNums(monthly.map((m) => m.d2c)))
    + gtMoney(sumNums(monthly.map((m) => m.b2b)))
    + gtMoney(sumNums(monthly.map((m) => m.operationalRevenue)))
    + gtMoney(sumNums(monthly.map((m) => m.adjustmentNet)))
    + gtMoney(sumNums(monthly.map((m) => m.headlineRevenue)))
  );
  return `<table class="rt-table rt-striped">${head}<tbody>${rows}</tbody>${foot}</table>`;
}

export function renderCategoryTable(catsAll, keys, sortMode = 'market') {
  const cats = catsAll.filter((c) => keys.has(`${c.year}|${c.month}`));
  const pivot = pivotCategory(cats, sortMode);
  const revMonths = reverseMonths(pivot.months);
  let head = '<thead><tr><th>Category</th><th>12mo</th><th>Market</th>';
  for (const m of revMonths) head += `<th>${monthLabel(m.year, m.month)}</th>`;
  head += '<th class="rt-year-col">2026 YTD</th><th>Total</th></tr></thead>';
  const body = pivot.categories.map((cat) => {
    const sparkVals = pivot.months.map((m) => cellVal(pivot, cat, m));
    let cells = '';
    for (const m of revMonths) cells += `<td>${fmtMoney(cellVal(pivot, cat, m))}</td>`;
    const ytd = sumYear(pivot, cat, 2026);
    const total = pivot.months.reduce((s, m) => s + cellVal(pivot, cat, m), 0);
    return `<tr><td>${escapeHtml(cat.label)}</td><td>${inlineSparkline(sparkVals, '#a855f7')}</td><td>${marketPill(cat.market)}</td>${cells}<td class="rt-year-col">${fmtMoney(ytd)}</td><td style="font-weight:700;">${fmtMoney(total)}</td></tr>`;
  }).join('');
  const monthTotals = revMonths.map((m) => sumNums(pivot.categories.map((cat) => cellVal(pivot, cat, m))));
  const ytdTotal = sumNums(pivot.categories.map((cat) => sumYear(pivot, cat, 2026)));
  const grandTotal = sumNums(pivot.categories.map((cat) => pivot.months.reduce((s, m) => s + cellVal(pivot, cat, m), 0)));
  const footCells = gtLabel() + gtEmpty(2) + monthTotals.map((v) => gtMoney(v)).join('') + `<td class="rt-year-col rt-grand-total-num">${fmtMoney(ytdTotal)}</td>` + gtMoney(grandTotal);
  return `<table class="rt-table rt-striped">${head}<tbody>${body}</tbody>${grandTotalRow(footCells)}</table>`;
}

function pivotCategory(cats, sortMode) {
  const monthSet = new Map();
  const catSet = new Map();
  const cellMap = new Map();
  for (const c of cats) {
    monthSet.set(c.year * 100 + c.month, { year: c.year, month: c.month });
    catSet.set(c.category_order, { order: c.category_order, label: c.category_label, market: c.market });
    cellMap.set(`${c.year}|${c.month}|${c.category_order}`, c.revenue);
  }
  const months = [...monthSet.values()].sort((a, b) => (a.year - b.year) || (a.month - b.month));
  let categories = [...catSet.values()];
  if (sortMode === 'market') {
    const rank = { D2C: 0, B2B: 1, ADJUSTMENT: 2 };
    categories.sort((a, b) => (rank[a.market] ?? 3) - (rank[b.market] ?? 3) || a.order - b.order);
  } else categories.sort((a, b) => a.order - b.order);
  return { months, categories, cellMap };
}

function cellVal(pivot, cat, m) {
  return pivot.cellMap.get(`${m.year}|${m.month}|${cat.order}`) || 0;
}

function sumYear(pivot, cat, year) {
  let s = 0;
  for (const m of pivot.months) if (m.year === year) s += cellVal(pivot, cat, m);
  return s;
}

function rowDataForBreakdown(f, includeJlr) {
  const s = includeJlr ? f.series_total : f.series_nonjlr;
  const d24 = f.deltas[includeJlr ? 'total_2024_to_2025' : 'nonjlr_2024_to_2025'] || { delta_gbp: 0 };
  const d25 = f.deltas[includeJlr ? 'total_2025_to_2026' : 'nonjlr_2025_to_2026'] || { delta_gbp: 0 };
  return {
    f, unit: f.unit_id, tier_key: f.meta?.tier_key,
    y2024: s.y2024 || 0, y2025: s.y2025 || 0, y2026_ytd: s.y2026_ytd || 0, y2026_ann: s.y2026_annualised || 0,
    delta24to25: d24.delta_gbp || 0, delta25to26: d25.delta_gbp || 0,
    units: includeJlr ? (f.counts?.y2025 || 0) : (f.counts?.y2025_nonjlr || 0)
  };
}

function badgeForFinding(f) {
  const flags = f.flags || [];
  if (flags.includes('retired_wound_down')) return '<span class="rt-flag-chip">RETIRED</span>';
  if (flags.includes('first_revenue_in_window')) return '<span class="rt-flag-chip is-info">first in window</span>';
  if (f.one_off_caveat) return '<span class="rt-flag-chip is-warn">one-off</span>';
  return '';
}

function parsePageSlug(unit) {
  let slug = String(unit || '').replace(/^https?:\/\/[^/]+/i, '');
  let badge = '';
  const oneOff = /(-one-off|oneoff)$/i;
  if (oneOff.test(slug)) {
    badge = '<span class="rt-flag-chip is-warn">one-off</span>';
    slug = slug.replace(oneOff, '');
  }
  return { slug, badge };
}

export function renderProductBreakdownTable(findings, options = {}) {
  const { tierFilter = '', search = '', includeJlr = false } = options;
  let rows = findings.products.all.map((f) => rowDataForBreakdown(f, includeJlr));
  if (tierFilter) rows = rows.filter((r) => r.tier_key === tierFilter);
  if (search) rows = rows.filter((r) => r.unit.toLowerCase().includes(search.toLowerCase()));
  const head = `<thead><tr><th>Product</th><th>12mo</th><th>2026 ann.</th><th>2026 YTD</th><th>2025</th><th>2024</th><th>Δ 25→26</th><th>Δ 24→25</th><th>Status</th><th>2025 #</th></tr></thead>`;
  const body = rows.map((r) => {
    const spark = inlineSparkline([r.y2024, r.y2025, r.y2026_ytd, r.y2026_ann], '#22c55e');
    return `<tr><td class="unit-cell">${escapeHtml(r.unit)}</td><td>${spark}</td>`
      + `<td>${fmtMoney(r.y2026_ann)}</td><td>${fmtMoney(r.y2026_ytd)}</td><td>${fmtMoney(r.y2025)}</td><td>${fmtMoney(r.y2024)}</td>`
      + `<td class="${r.delta25to26 < 0 ? 'is-negative' : ''}">${fmtDelta(r.delta25to26)}</td>`
      + `<td class="${r.delta24to25 < 0 ? 'is-negative' : ''}">${fmtDelta(r.delta24to25)}</td>`
      + `<td>${badgeForFinding(r.f)}</td><td>${r.units}</td></tr>`;
  }).join('');
  const foot = rows.length ? grandTotalRow(
    gtLabel()
    + gtEmpty(1)
    + gtMoney(sumNums(rows.map((r) => r.y2026_ann)))
    + gtMoney(sumNums(rows.map((r) => r.y2026_ytd)))
    + gtMoney(sumNums(rows.map((r) => r.y2025)))
    + gtMoney(sumNums(rows.map((r) => r.y2024)))
    + `<td class="rt-grand-total-num">${fmtDelta(sumNums(rows.map((r) => r.delta25to26)))}</td>`
    + `<td class="rt-grand-total-num">${fmtDelta(sumNums(rows.map((r) => r.delta24to25)))}</td>`
    + gtEmpty(1)
    + `<td class="rt-grand-total-num">${sumNums(rows.map((r) => r.units)).toLocaleString('en-GB')}</td>`
  ) : '';
  return `<div class="rt-basis-note">${basisBadge('nonjlr_net')} Product revenue — JLR excluded by default.</div><table class="rt-table rt-striped rt-breakdown-table">${head}<tbody>${body}</tbody>${foot}</table>`;
}

export function renderPageBreakdownTable(findings, options = {}) {
  const { tierFilter = '', search = '', includeJlr = false } = options;
  let rows = findings.pages.all.map((f) => rowDataForBreakdown(f, includeJlr));
  if (tierFilter) rows = rows.filter((r) => r.tier_key === tierFilter);
  if (search) rows = rows.filter((r) => r.unit.toLowerCase().includes(search.toLowerCase()));
  const head = `<thead><tr><th>Landing page</th><th>12mo</th><th>2026 ann.</th><th>2026 YTD</th><th>2025</th><th>2024</th><th>Δ 25→26</th><th>Δ 24→25</th><th>Badges</th><th>2025 #</th></tr></thead>`;
  const body = rows.map((r) => {
    const { slug, badge } = parsePageSlug(r.unit);
    const spark = inlineSparkline([r.y2024, r.y2025, r.y2026_ytd, r.y2026_ann], '#22c55e');
    return `<tr><td class="unit-cell">${slugLink(r.unit, slug)} ${badge}</td><td>${spark}</td>`
      + `<td>${fmtMoney(r.y2026_ann)}</td><td>${fmtMoney(r.y2026_ytd)}</td><td>${fmtMoney(r.y2025)}</td><td>${fmtMoney(r.y2024)}</td>`
      + `<td class="${r.delta25to26 < 0 ? 'is-negative' : ''}">${fmtDelta(r.delta25to26)}</td>`
      + `<td class="${r.delta24to25 < 0 ? 'is-negative' : ''}">${fmtDelta(r.delta24to25)}</td>`
      + `<td>${badgeForFinding(r.f)}</td><td>${r.units}</td></tr>`;
  }).join('');
  const foot = rows.length ? grandTotalRow(
    gtLabel()
    + gtEmpty(1)
    + gtMoney(sumNums(rows.map((r) => r.y2026_ann)))
    + gtMoney(sumNums(rows.map((r) => r.y2026_ytd)))
    + gtMoney(sumNums(rows.map((r) => r.y2025)))
    + gtMoney(sumNums(rows.map((r) => r.y2024)))
    + `<td class="rt-grand-total-num">${fmtDelta(sumNums(rows.map((r) => r.delta25to26)))}</td>`
    + `<td class="rt-grand-total-num">${fmtDelta(sumNums(rows.map((r) => r.delta24to25)))}</td>`
    + gtEmpty(1)
    + `<td class="rt-grand-total-num">${sumNums(rows.map((r) => r.units)).toLocaleString('en-GB')}</td>`
  ) : '';
  return `<div class="rt-basis-note">${basisBadge('nonjlr_gross_voucher')} Gross of voucher redemption — differs from headline where vouchers have no landing page.</div><table class="rt-table rt-striped rt-breakdown-table">${head}<tbody>${body}</tbody>${foot}</table>`;
}

export function renderReconciliationPivotTable(rows, dimensionHeader, labelFn, keys) {
  const visible = rows.filter((r) => keys.has(`${r.year}|${r.month}`));
  const pivot = pivotRows(visible, labelFn);
  const revMonths = reverseMonths(pivot.months);
  let head = `<thead><tr><th>${dimensionHeader}</th><th>Trend</th>`;
  for (const m of revMonths) {
    head += `<th>${monthLabel(m.year, m.month)}</th>`;
    if (m.year === 2025 && m.month === 12) head += `<th class="rt-year-col">2025 YR</th>`;
  }
  head += `<th class="rt-year-col">2026 YTD</th><th>Total</th></tr></thead>`;
  const body = pivot.dims.map((dim) => {
    const series = pivot.months.map((m) => pivot.cellMap.get(`${m.year}|${m.month}|${dim}`)?.revenue || 0);
    let cells = '';
    let y2025 = 0;
    let y2026 = 0;
    for (const m of revMonths) {
      const r = pivot.cellMap.get(`${m.year}|${m.month}|${dim}`);
      const v = r?.revenue || 0;
      if (m.year === 2025) y2025 += v;
      if (m.year === 2026) y2026 += v;
      cells += `<td>${fmtMoney(v)}</td>`;
      if (m.year === 2025 && m.month === 12) cells += `<td class="rt-year-col">${fmtMoney(y2025)}</td>`;
    }
    const total = series.reduce((s, v) => s + v, 0);
    return `<tr><td>${escapeHtml(dim)}</td>${sparkDeltaCol(pivot.months.map((m) => pivot.cellMap.get(`${m.year}|${m.month}|${dim}`) || { revenue: 0 }), (x) => x.revenue || 0)}${cells}<td class="rt-year-col">${fmtMoney(y2026)}</td><td style="font-weight:700;">${fmtMoney(total)}</td></tr>`;
  }).join('');
  const monthTotals = [];
  let footY2025 = 0;
  let footY2026 = 0;
  let footGrand = 0;
  for (const m of revMonths) {
    const v = sumNums(pivot.dims.map((dim) => pivot.cellMap.get(`${m.year}|${m.month}|${dim}`)?.revenue || 0));
    monthTotals.push(v);
    footGrand += v;
    if (m.year === 2025) footY2025 += v;
    if (m.year === 2026) footY2026 += v;
  }
  let footCells = gtLabel() + gtEmpty(1);
  for (let i = 0; i < revMonths.length; i++) {
    footCells += gtMoney(monthTotals[i]);
    if (revMonths[i].year === 2025 && revMonths[i].month === 12) footCells += gtMoney(footY2025);
  }
  footCells += `<td class="rt-year-col rt-grand-total-num">${fmtMoney(footY2026)}</td>` + gtMoney(footGrand);
  return `<table class="rt-table rt-striped">${head}<tbody>${body}</tbody>${grandTotalRow(footCells)}</table>`;
}

function pivotRows(rows, labelFn) {
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

export function renderFundingTable(funding, keys) {
  const visible = funding.filter((r) => keys.has(`${r.year}|${r.month}`));
  const months = reverseMonths([...new Map(visible.map((r) => [r.year * 100 + r.month, { year: r.year, month: r.month }])).values()]
    .sort((a, b) => (a.year - b.year) || (a.month - b.month)));
  const fundings = [...new Set(visible.map((r) => r.funding))].sort();
  const cellMap = new Map();
  for (const r of visible) cellMap.set(`${r.year}|${r.month}|${r.funding}`, r);
  let head = `<thead><tr><th>Funding</th><th>Trend</th>`;
  for (const m of months) {
    head += `<th>${monthLabel(m.year, m.month)}</th>`;
    if (m.year === 2025 && m.month === 12) head += `<th class="rt-year-col">2025 YR</th>`;
  }
  head += `<th class="rt-year-col">2026 YTD</th><th>Total gross</th><th>Fees</th><th>Net</th></tr></thead>`;
  const body = fundings.map((f) => {
    const series = months.slice().reverse().map((m) => cellMap.get(`${m.year}|${m.month}|${f}`)?.revenue || 0);
    let cells = '';
    let y2025 = 0;
    let y2026 = 0;
    let total = 0;
    let fees = 0;
    for (const m of months) {
      const r = cellMap.get(`${m.year}|${m.month}|${f}`);
      const v = r?.revenue || 0;
      total += v;
      fees += r?.feesEstimated || 0;
      if (m.year === 2025) y2025 += v;
      if (m.year === 2026) y2026 += v;
      cells += `<td>${fmtMoney(v)}</td>`;
      if (m.year === 2025 && m.month === 12) cells += `<td class="rt-year-col">${fmtMoney(y2025)}</td>`;
    }
    return `<tr><td>${escapeHtml(f)}</td>${sparkDeltaCol(months.map((m) => ({ revenue: cellMap.get(`${m.year}|${m.month}|${f}`)?.revenue || 0 })), (x) => x.revenue)}${cells}<td class="rt-year-col">${fmtMoney(y2026)}</td><td>${fmtMoney(total)}</td><td>${fmtMoney(fees, 2)}</td><td>${fmtMoney(total - fees, 2)}</td></tr>`;
  }).join('');
  const monthTotals = [];
  let footY2025 = 0;
  let footY2026 = 0;
  let footGross = 0;
  let footFees = 0;
  for (const m of months) {
    const v = sumNums(fundings.map((f) => cellMap.get(`${m.year}|${m.month}|${f}`)?.revenue || 0));
    const f = sumNums(fundings.map((fn) => cellMap.get(`${m.year}|${m.month}|${fn}`)?.feesEstimated || 0));
    monthTotals.push(v);
    footGross += v;
    footFees += f;
    if (m.year === 2025) footY2025 += v;
    if (m.year === 2026) footY2026 += v;
  }
  let footCells = gtLabel() + gtEmpty(1);
  for (let i = 0; i < months.length; i++) {
    footCells += gtMoney(monthTotals[i]);
    if (months[i].year === 2025 && months[i].month === 12) footCells += gtMoney(footY2025);
  }
  footCells += `<td class="rt-year-col rt-grand-total-num">${fmtMoney(footY2026)}</td>` + gtMoney(footGross) + gtMoney(footFees, 2) + gtMoney(footGross - footFees, 2);
  return `<div class="rt-basis-note">${basisBadge('nonjlr_net')} Estimated fees from funding mix.</div><table class="rt-table rt-striped">${head}<tbody>${body}</tbody>${grandTotalRow(footCells)}</table>`;
}

function renderMoversBlock(title, list, findings, window, includeJlr) {
  if (!list?.length) return `<div class="rt-findings-card"><h4>${title}</h4><p class="rt-sub">None in window.</p></div>`;
  return `<div class="rt-findings-card"><h4>${title}</h4>${list.map((f) => renderMoverCard(f, findings, window, includeJlr)).join('')}</div>`;
}

export function renderMoversHtml(findings, window = '2024->2025', includeJlr = false) {
  const winKey = window === '2024->2025' ? '2024_to_2025' : '2025_to_2026';
  return [
    renderMoversBlock('Top 5 declining products', findings.products[`decliningTop5_${winKey}`] || [], findings, window, includeJlr),
    renderMoversBlock('Top 5 declining pages', findings.pages[`decliningTop5_${winKey}`] || [], findings, window, includeJlr),
    renderMoversBlock('Top 5 growing products', findings.products[`growingTop5_${winKey}`] || [], findings, window, includeJlr)
  ].join('');
}

export function renderMoversIntoGrid(findings, window, includeJlr) {
  const winKey = window === '2024->2025' ? '2024_to_2025' : '2025_to_2026';
  return {
    productsDecline: renderMoverList(findings.products[`decliningTop5_${winKey}`], findings, window, includeJlr),
    pagesDecline: renderMoverList(findings.pages[`decliningTop5_${winKey}`], findings, window, includeJlr),
    productsGrowth: renderMoverList(findings.products[`growingTop5_${winKey}`], findings, window, includeJlr)
  };
}

function renderMoverList(list, findings, window, includeJlr) {
  if (!list?.length) return '<p class="rt-sub">None in window.</p>';
  return list.map((f) => renderMoverCard(f, findings, window, includeJlr)).join('');
}

function renderMoverCard(f, findings, window, includeJlr) {
  const s = includeJlr ? f.series_total : f.series_nonjlr;
  const dk = includeJlr ? 'total_' : 'nonjlr_';
  const wk = window === '2024->2025' ? '2024_to_2025' : '2025_to_2026';
  const d = f.deltas[`${dk}${wk}`] || { delta_gbp: 0 };
  const titleHtml = f.unit_type === 'page' ? slugLink(f.unit_id, String(f.unit_id).replace(/^https?:\/\/[^/]+/, '')) : escapeHtml(f.unit_id);
  const signals = moversCardSignals(f);
  const table = `<table class="rt-movers-mini-table"><thead><tr><th>Year</th><th>£</th></tr></thead><tbody>`
    + `<tr><td>2024</td><td>${fmtMoney(s.y2024, 0)}</td></tr>`
    + `<tr><td>2025</td><td>${fmtMoney(s.y2025, 0)}</td></tr>`
    + `<tr><td>${findings.currentYear} YTD</td><td>${fmtMoney(s.y2026_ytd_closed || s.y2026_ytd, 0)}</td></tr>`
    + `<tr><td>${findings.currentYear} ann.</td><td>${fmtMoney(s.y2026_annualised, 0)}</td></tr></tbody>`
    + grandTotalRow(gtLabel('Total £') + gtMoney((s.y2024 || 0) + (s.y2025 || 0) + (s.y2026_ytd_closed || s.y2026_ytd || 0) + (s.y2026_annualised || 0), 0))
    + `</table>`;
  return `<details class="rt-movers-card"><summary>${titleHtml} — ${fmtDelta(d.delta_gbp)}</summary>${signals}${table}<p class="rt-sub">${escapeHtml(f.plain_text || '')}</p></details>`;
}

export function renderTierChartTable(monthlyAll, keys) {
  const monthly = monthlyAll.filter((m) => keys.has(`${m.year}|${m.month}`));
  const rows = monthly.map((m) => {
    const colour = m.isPartial ? BAND_COLOURS.partial : (BAND_COLOURS[m.band] || '#64748b');
    return `<tr><td>${monthLabel(m.year, m.month)}</td><td style="font-weight:700;">${fmtMoney(m.headlineRevenue, 2)}</td><td>${BAND_LABEL[m.band] || m.band}</td><td><span class="rt-bar-swatch" style="background:${colour}"></span></td></tr>`;
  }).join('');
  const foot = grandTotalRow(
    gtLabel()
    + gtMoney(sumNums(monthly.map((m) => m.headlineRevenue)), 2)
    + gtEmpty(2)
  );
  return `<table class="rt-table rt-striped"><thead><tr><th>Month</th><th>Headline £</th><th>Band</th><th></th></tr></thead><tbody>${rows}</tbody>${foot}</table>`;
}

export function visibleMonthKeys(monthly, windowMode, now) {
  if (!monthly?.length || windowMode === 'full') return new Set(monthly.map((m) => `${m.year}|${m.month}`));
  const set = new Set();
  for (const m of monthly) {
    const dy = (m.year - now.year) * 12 + (m.month - now.month);
    if (dy >= -12 && dy <= 0) set.add(`${m.year}|${m.month}`);
  }
  return set;
}
