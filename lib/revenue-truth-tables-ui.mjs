/** Table + strip HTML renderers (D5–D12, D17, D19). */

import { isSeasonalAnnualisationProduct } from './revenue-truth-recurring-baseline.mjs';
import { rankTopFindings } from './revenue-truth-findings-filters.mjs';
import { TIER_DEFINITIONS } from './revenue-tier-mapping.js';
import {
  escapeHtml, escapeAttr, slugLink, tip, basisBadge, fmtMoney, BAND_LABEL, BAND_COLOURS,
  DEFAULT_TIER_BANDS, TIER_BAND_TARGETS
} from './revenue-truth-ui-core.mjs';
import { resolveExecYearForecast } from './revenue-truth-live-forecast.mjs';
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

function fmtLastTxn(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '—';
  return `${m[2]}-${m[1].slice(-2)}`;
}

function fmtAov(revenue, count) {
  const c = Number(count) || 0;
  if (!c) return '—';
  return fmtMoney((Number(revenue) || 0) / c);
}

function fmtGscClicks(gsc) {
  const n = Number(gsc?.clicks) || 0;
  return n > 0 ? n.toLocaleString('en-GB') : '—';
}

function fmtGscCtr(gsc) {
  const imp = Number(gsc?.impressions) || 0;
  if (imp <= 0) return '—';
  const pct = gsc?.ctr_pct != null ? gsc.ctr_pct : (100 * (Number(gsc.clicks) || 0) / imp);
  return Number(pct).toFixed(2) + '%';
}

function gscMetricCells(gsc) {
  return `<td>${fmtGscClicks(gsc)}</td><td>${fmtGscCtr(gsc)}</td>`;
}

function gscFootCells(rows) {
  const clicks = sumNums(rows.map((r) => r.gsc?.clicks));
  const imp = sumNums(rows.map((r) => r.gsc?.impressions));
  return `<td class="rt-grand-total-num">${clicks ? clicks.toLocaleString('en-GB') : '—'}</td>`
    + `<td class="rt-grand-total-num">${imp > 0 ? (100 * clicks / imp).toFixed(2) + '%' : '—'}</td>`;
}

const GSC_COL_HEAD = '<th title="Google Search Console clicks — last 3 closed calendar months on matched page slug.">Clicks (3mo)</th><th title="GSC click-through rate — last 3 closed months.">CTR (3mo)</th>';

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

function ytdHead() {
  return '<th class="rt-year-col">2026 YTD</th>';
}

function ytdCell(n) {
  return `<td class="rt-year-col">${fmtMoney(n)}</td>`;
}

function monthHeaderCells(revMonths, with2025Yr = true) {
  let h = '';
  for (const m of revMonths) {
    h += `<th>${monthLabel(m.year, m.month)}</th>`;
    if (with2025Yr && m.year === 2025 && m.month === 12) h += '<th class="rt-year-col">2025 YR</th>';
  }
  return h;
}

function monthValueCells(revMonths, valueFn, with2025Yr = true) {
  let cells = '';
  let y2025 = 0;
  for (const m of revMonths) {
    const v = valueFn(m);
    if (m.year === 2025) y2025 += v;
    cells += `<td>${fmtMoney(v)}</td>`;
    if (with2025Yr && m.year === 2025 && m.month === 12) cells += ytdCell(y2025);
  }
  return cells;
}

function monthFootMoneyCells(revMonths, monthTotals, with2025Yr = true) {
  let cells = '';
  let y2025 = 0;
  for (let i = 0; i < revMonths.length; i++) {
    const v = monthTotals[i];
    if (revMonths[i].year === 2025) y2025 += v;
    cells += gtMoney(v);
    if (with2025Yr && revMonths[i].year === 2025 && revMonths[i].month === 12) cells += gtMoney(y2025);
  }
  return cells;
}

function sumYearFromMonths(months, year, valueFn) {
  let s = 0;
  for (const m of months) if (m.year === year) s += valueFn(m);
  return s;
}

function sparkDeltaCol(rows, valueFn) {
  const vals = rows.map(valueFn);
  const recent = vals.slice(-6);
  const prior = vals.slice(-12, -6);
  const r = recent.reduce((s, v) => s + v, 0);
  const p = prior.reduce((s, v) => s + v, 0);
  return `<td>${inlineSparkline(vals, '#6366f1')} ${deltaChipHtml(pctChange(r, p), '6mo')}</td>`;
}

export function renderHeadlineStripHtml(strip, cfg, pulse) {
  if (!strip) return '';
  const latest = strip.latestClosedMonth;
  const ytd = strip.ytd;
  const superseded = pulse?.defcon?.active && pulse.defcon.level >= 3
    ? ' <span class="rt-superseded-tag">(superseded by Pulse — current month critically below)</span>'
    : '';
  const rec = strip.recurring;
  const latestMeta = latest
    ? `${monthLabel(latest.year, latest.month)} · Headline ${BAND_LABEL[latest.band]}${superseded}`
    : '';
  const latestVal = latest
    ? `${fmtMoney(latest.headlineRevenue, 0)} · Recurring ${fmtMoney(rec?.latestClosedRecurring ?? 0, 0)}`
    : '—';
  const latestSub = rec?.latestClosedRecurringBand
    ? `${BAND_LABEL[rec.latestClosedRecurringBand]} recurring ${basisBadge('recurring_baseline')}`
    : basisBadge('recurring_baseline');
  const cards = [
    stripCard('Latest closed month', latestVal, latestMeta + ' ' + latestSub, latest?.band, 'headline_gross'),
    stripCard(`YTD ${ytd.year}`, `${fmtMoney(ytd.ytdRevenue, 0)} · Recurring ${fmtMoney(rec?.ytdRecurring ?? 0, 0)}`, `Pro-rata ${fmtMoney(ytd.proRataTarget, 0)} · includes partial month`, null, 'headline_gross'),
    stripCard('Trailing 3-mo avg', `${fmtMoney(strip.trailing3MonthAverage, 0)} · Recurring ${fmtMoney(rec?.trailing3RecurringAvg ?? 0, 0)}`, `${BAND_LABEL[strip.trailing3Band]} headline · ${BAND_LABEL[rec?.trailing3RecurringBand || 'below_survival']} recurring`, strip.trailing3Band, 'closed_only'),
    stripCard('Tier bands / mo', `£${cfg.tierBands.survival} / £${cfg.tierBands.comfortable} / £${cfg.tierBands.thrive}`, 'Survival / Comfortable / Thrive', null, null)
  ].join('');
  return cards;
}

const FORECAST_BANDS = [
  { label: 'Survival £53.4k', target: TIER_BAND_TARGETS.survival },
  { label: 'Comfortable £60k', target: TIER_BAND_TARGETS.comfortable },
  { label: 'Thrive £96k', target: TIER_BAND_TARGETS.thrive }
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

/** Combined §2 Headline + §F Forecast — primary = seasonally adjusted (matches exec summary). */
export function renderHeadlineForecastPanelHtml(strip, cfg, forecast, pulse, recurringForecast, findings) {
  if (!strip && !forecast) return '';
  const primary = resolveExecYearForecast({ config: cfg, currentMonthPulse: pulse, forecast }, findings);
  const fi = pulse?.forecast_impact;
  const closed = forecast?.forecastCentral || 0;
  const liveAware = fi?.revised_forecast_primary ?? forecast?.forecastInclCurrent;
  const liveDelta = fi?.delta_gbp ?? forecast?.forecastInclCurrentDelta;
  const stripHtml = strip ? `<div class="rt-hf-measured"><div class="rt-hf-subhead">Measured headline ${basisBadge('headline_gross')}</div><div class="rt-strip">${renderHeadlineStripHtml(strip, cfg, pulse)}</div></div>` : '';
  const primaryBlock = primary?.value != null
    ? `<div class="rt-hf-primary"><div class="rt-hf-subhead">Full-year forecast (primary)</div>`
      + `<div class="rt-forecast-grid">${forecastScenarioCard('Seasonally adjusted', primary.value, primary.detail || 'YTD closed + current-month blended (non-JLR)', 'is-primary')}</div>`
      + `<div class="rt-forecast-grid">${forecastBandCards(primary.value, 'is-primary')}</div></div>`
    : '';
  const altMethods = [];
  if (liveAware != null && liveAware !== primary?.value) {
    altMethods.push({ label: fi?.revised_blended_label || 'Live-month-aware (headline pace)', value: liveAware, meta: `${fmtMoney(liveDelta || 0, 0)} vs closed-only · Uses current-month headline projection + trailing run-rate` });
  }
  if (closed && closed !== primary?.value) {
    altMethods.push({ label: forecast.forecastCentralLabel || 'Closed-months-only', value: closed, meta: `${fmtMoney(forecast.forecastLow, 0)} – ${fmtMoney(forecast.forecastHigh, 0)} · Excludes live partial month` });
  }
  const recFc = recurringForecast || {};
  if (recFc.forecastCentral != null) {
    altMethods.push({ label: 'Recurring run-rate (operational)', value: recFc.forecastCentral, meta: `Trailing-3 recurring avg ${fmtMoney(recFc.runRateMonthly || 0, 0)}/mo · Excludes voucher tiers + redemptions only` });
  }
  const altHtml = altMethods.length
    ? `<details class="rt-forecast-method"><summary>Alternative forecast methods (${altMethods.length})</summary><div class="rt-forecast-grid">`
      + altMethods.map((m) => forecastScenarioCard(m.label, m.value, m.meta, 'is-muted')).join('')
      + `</div></details>`
    : '';
  const formula = forecast ? `<div class="rt-forecast-formula"><strong>Primary:</strong> ${escapeHtml(primary?.detail || 'Seasonally adjusted blend')}`
    + `<br><strong>Closed-only formula:</strong> <code>${escapeHtml(forecast.formula)}</code></div>`
    + `<div class="rt-forecast-caveat">${escapeHtml(forecast.caveat || '')}</div>` : '';
  const projection = forecast ? `<div class="rt-hf-projection"><div class="rt-headline-forecast-divider"><span class="rt-forecast-pill">PROJECTION</span> Full-year forecast</div>`
    + `<div class="rt-basis-note">${basisBadge('closed_only')} YTD closed ${fmtMoney(forecast.ytdActual, 0)} from ${forecast.closedMonths} closed months.</div>`
    + primaryBlock + altHtml + formula + `</div>` : '';
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
    { label: 'Survival £53.4k', target: TIER_BAND_TARGETS.survival },
    { label: 'Comfortable £60k', target: TIER_BAND_TARGETS.comfortable },
    { label: 'Thrive £96k', target: TIER_BAND_TARGETS.thrive }
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

function ytdFootRow(label, cellsHtml) {
  return `<tr class="rt-ytd-subtotal"><td class="rt-grand-total-label">${escapeHtml(label)}</td>${cellsHtml}</tr>`;
}

export function renderMarketTable(monthlyAll, keys) {
  const monthly = reverseMonths(monthlyAll.filter((m) => keys.has(`${m.year}|${m.month}`)));
  const ytd2026 = monthlyAll.filter((m) => m.year === 2026 && keys.has(`${m.year}|${m.month}`));
  const head = `<thead><tr><th>Month</th><th>D2C</th><th>B2B</th><th title="Operational = real service sales (D2C + B2B)">Operational</th><th title="Adjustment = voucher/Pick'n'Mix timing (nets ~£0)">Adjustment</th><th title="Headline = booked total">Headline</th></tr></thead>`;
  const rows = monthly.map((m) => {
    const partial = m.isPartial ? ' <span class="rt-pill partial">in progress</span>' : '';
    return `<tr><td>${monthLabel(m.year, m.month)}${partial}</td><td>${fmtMoney(m.d2c)}</td><td>${fmtMoney(m.b2b)}</td><td>${fmtMoney(m.operationalRevenue)}</td><td class="${m.adjustmentNet < 0 ? 'is-negative' : ''}">${fmtMoney(m.adjustmentNet)}</td><td style="font-weight:700;">${fmtMoney(m.headlineRevenue)}</td></tr>`;
  }).join('');
  const ytdRow = ytdFootRow('2026 YTD', gtMoney(sumNums(ytd2026.map((m) => m.d2c)))
    + gtMoney(sumNums(ytd2026.map((m) => m.b2b)))
    + gtMoney(sumNums(ytd2026.map((m) => m.operationalRevenue)))
    + gtMoney(sumNums(ytd2026.map((m) => m.adjustmentNet)))
    + gtMoney(sumNums(ytd2026.map((m) => m.headlineRevenue))));
  const footGrand = `<tr class="rt-grand-total">${gtLabel()}`
    + gtMoney(sumNums(monthly.map((m) => m.d2c)))
    + gtMoney(sumNums(monthly.map((m) => m.b2b)))
    + gtMoney(sumNums(monthly.map((m) => m.operationalRevenue)))
    + gtMoney(sumNums(monthly.map((m) => m.adjustmentNet)))
    + gtMoney(sumNums(monthly.map((m) => m.headlineRevenue))) + `</tr>`;
  return `<table class="rt-table rt-striped">${head}<tbody>${rows}</tbody><tfoot>${ytdRow}${footGrand}</tfoot></table>`
    + `<div class="rt-basis-note">${basisBadge('headline_gross')} All columns are 12-category gross from Booking Sheet (JLR-inclusive headline). <strong>2026 YTD</strong> subtotal in footer sums Jan–current month.</div>`;
}

export function renderCategoryTable(catsAll, keys, sortMode = 'market') {
  const cats = catsAll.filter((c) => keys.has(`${c.year}|${c.month}`));
  const pivot = pivotCategory(cats, sortMode);
  const revMonths = reverseMonths(pivot.months);
  let head = '<thead><tr><th>Category</th><th>12mo</th><th>Market</th>';
  head += ytdHead() + monthHeaderCells(revMonths, true) + '<th>Total</th></tr></thead>';
  const body = pivot.categories.map((cat) => {
    const sparkVals = pivot.months.map((m) => cellVal(pivot, cat, m));
    const ytd = sumYear(pivot, cat, 2026);
    const total = pivot.months.reduce((s, m) => s + cellVal(pivot, cat, m), 0);
    const monthCells = monthValueCells(revMonths, (m) => cellVal(pivot, cat, m), true);
    return `<tr><td>${escapeHtml(cat.label)}</td><td>${inlineSparkline(sparkVals, '#a855f7')}</td><td>${marketPill(cat.market)}</td>${ytdCell(ytd)}${monthCells}<td style="font-weight:700;">${fmtMoney(total)}</td></tr>`;
  }).join('');
  const monthTotals = revMonths.map((m) => sumNums(pivot.categories.map((cat) => cellVal(pivot, cat, m))));
  const ytdTotal = sumNums(pivot.categories.map((cat) => sumYear(pivot, cat, 2026)));
  const grandTotal = sumNums(pivot.categories.map((cat) => pivot.months.reduce((s, m) => s + cellVal(pivot, cat, m), 0)));
  const footCells = gtLabel() + gtEmpty(2) + `<td class="rt-year-col rt-grand-total-num">${fmtMoney(ytdTotal)}</td>`
    + monthFootMoneyCells(revMonths, monthTotals, true) + gtMoney(grandTotal);
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

function productRevenueCategory(meta) {
  const key = meta?.tier_key;
  if (key && TIER_DEFINITIONS[key]?.bookingCategory) return TIER_DEFINITIONS[key].bookingCategory;
  return meta?.category ? String(meta.category) : '—';
}

function rowDataForBreakdown(f, includeJlr) {
  const s = includeJlr ? f.series_total : f.series_nonjlr;
  const d24 = f.deltas[includeJlr ? 'total_2024_to_2025' : 'nonjlr_2024_to_2025'] || { delta_gbp: 0 };
  const d25 = f.deltas[includeJlr ? 'total_2025_to_2026' : 'nonjlr_2025_to_2026'] || { delta_gbp: 0 };
  const units2026 = includeJlr ? (f.counts?.y2026_ytd || 0) : (f.counts?.y2026_nonjlr_ytd || 0);
  return {
    f, unit: f.unit_id, tier_key: f.meta?.tier_key,
    revenueCategory: productRevenueCategory(f.meta),
    y2024: s.y2024 || 0, y2025: s.y2025 || 0, y2026_ytd: s.y2026_ytd || 0, y2026_ann: s.y2026_annualised || 0,
    delta24to25: d24.delta_gbp || 0, delta25to26: d25.delta_gbp || 0,
    units: includeJlr ? (f.counts?.y2025 || 0) : (f.counts?.y2025_nonjlr || 0),
    units2026,
    aov2026: units2026 > 0 ? (s.y2026_ytd || 0) / units2026 : null,
    lastTxn: includeJlr ? f.last_txn_date_total : f.last_txn_date_nonjlr,
    gsc: f.gsc_last_3mo || null
  };
}

function flagChip(label, cls, title) {
  const tip = title ? ` title="${escapeAttr(title)}"` : '';
  return `<span class="rt-flag-chip${cls ? ' ' + cls : ''}"${tip}>${escapeHtml(label)}</span>`;
}

export const RT_FLAG_KEY = [
  { label: 'RETIRED', cls: '', rule: 'Marked retired in canonical_products (is_retired = true).' },
  { label: 'first in window', cls: 'is-info', rule: '£0 in 2024; first non-JLR revenue in 2025 or 2026.' },
  { label: 'one-off', cls: 'is-warn', rule: 'One booking was ≥ 40% of that year\'s non-JLR revenue.' },
  { label: 'collapsed', cls: 'is-warn', rule: 'Had 2024/2025 revenue; closed 2026 YTD is £0 and 2025 fell vs 2024.' },
  { label: 'recovering', cls: 'is-good', rule: '2025 below 2024 but 2026 annualised run-rate is above 2025.' }
];

export function renderFlagKeyHtml() {
  const rows = RT_FLAG_KEY.map((e) =>
    `<div class="rt-flag-key-row">${flagChip(e.label, e.cls, e.rule)}<span class="rt-flag-key-rule">${escapeHtml(e.rule)}</span></div>`
  ).join('');
  return `<aside class="rt-flag-key-box" aria-label="Flags key"><div class="rt-flag-key-title">Flags key</div>${rows}</aside>`;
}

function badgeForFinding(f) {
  const flags = f.flags || [];
  const chips = [];
  if (flags.includes('retired_wound_down')) {
    chips.push(flagChip('RETIRED', '', 'canonical_products.is_retired = true for this product title.'));
  }
  if (flags.includes('first_revenue_in_window')) {
    chips.push(flagChip('first in window', 'is-info', '£0 in 2024; first non-JLR revenue appeared in 2025 or 2026.'));
  }
  if (f.one_off_caveat) {
    chips.push(flagChip('one-off', 'is-warn', f.one_off_caveat.note || 'A single booking was ≥40% of that year\'s revenue for this unit.'));
  }
  if (flags.includes('collapsed_to_zero')) {
    chips.push(flagChip('collapsed', 'is-warn', 'Had revenue in 2024/2025 but closed-month 2026 YTD is £0 and 2025 fell vs 2024.'));
  }
  if (flags.includes('recovered_in_2026')) {
    chips.push(flagChip('recovering', 'is-good', '2025 below 2024 but 2026 annualised run-rate is above 2025.'));
  }
  return chips.join(' ') || '—';
}

function productLinkHtml(f, label) {
  const meta = f?.meta || {};
  const url = meta.product_url || meta.service_page_url;
  if (!url) return escapeHtml(label);
  return slugLink(url, label);
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
  const head = `<thead><tr><th>Product</th><th class="rt-cat-col">Revenue category</th><th>12mo</th><th>2026 #</th><th>AOV</th><th>Lst TXTN</th>${GSC_COL_HEAD}${ytdHead()}<th>2026 ann.</th><th>2025</th><th>2024</th><th>Δ 25→26</th><th>Δ 24→25</th><th title="Auto flags from canonical_products + revenue shape (hover each chip).">Flags</th><th>2025 #</th></tr></thead>`;
  const body = rows.map((r) => {
    const spark = inlineSparkline([r.y2024, r.y2025, r.y2026_ytd, r.y2026_ann], '#22c55e');
    return `<tr><td class="unit-cell">${productLinkHtml(r.f, r.unit)}</td><td class="rt-cat-cell">${escapeHtml(r.revenueCategory)}</td><td>${spark}</td>`
      + `<td>${r.units2026 || '—'}</td><td>${fmtAov(r.y2026_ytd, r.units2026)}</td><td>${fmtLastTxn(r.lastTxn)}</td>`
      + gscMetricCells(r.gsc)
      + ytdCell(r.y2026_ytd)
      + `<td>${fmtMoney(r.y2026_ann)}</td><td>${fmtMoney(r.y2025)}</td><td>${fmtMoney(r.y2024)}</td>`
      + `<td class="${r.delta25to26 < 0 ? 'is-negative' : ''}">${fmtDelta(r.delta25to26)}</td>`
      + `<td class="${r.delta24to25 < 0 ? 'is-negative' : ''}">${fmtDelta(r.delta24to25)}</td>`
      + `<td>${badgeForFinding(r.f)}</td><td>${r.units}</td></tr>`;
  }).join('');
  const foot2026Cnt = sumNums(rows.map((r) => r.units2026));
  const foot2026Rev = sumNums(rows.map((r) => r.y2026_ytd));
  const foot = rows.length ? grandTotalRow(
    gtLabel()
    + gtEmpty(2)
    + `<td class="rt-grand-total-num">${foot2026Cnt ? foot2026Cnt.toLocaleString('en-GB') : '—'}</td>`
    + `<td class="rt-grand-total-num">${fmtAov(foot2026Rev, foot2026Cnt)}</td>`
    + gtEmpty(1)
    + gscFootCells(rows)
    + `<td class="rt-year-col rt-grand-total-num">${fmtMoney(sumNums(rows.map((r) => r.y2026_ytd)))}</td>`
    + gtMoney(sumNums(rows.map((r) => r.y2026_ann)))
    + gtMoney(sumNums(rows.map((r) => r.y2025)))
    + gtMoney(sumNums(rows.map((r) => r.y2024)))
    + `<td class="rt-grand-total-num">${fmtDelta(sumNums(rows.map((r) => r.delta25to26)))}</td>`
    + `<td class="rt-grand-total-num">${fmtDelta(sumNums(rows.map((r) => r.delta24to25)))}</td>`
    + gtEmpty(1)
    + `<td class="rt-grand-total-num">${sumNums(rows.map((r) => r.units)).toLocaleString('en-GB')}</td>`
  ) : '';
  return `<div class="rt-basis-note">${includeJlr ? basisBadge('jlr_incl') : basisBadge('nonjlr_net')} Product operational revenue${includeJlr ? ' — JLR included.' : ' — JLR excluded.'} Pick&apos;n&apos;Mix / Gift Voucher timing lines excluded (see §3 ADJUSTMENT + §8 funding). GSC Clicks/CTR = last 3 closed months from <code>gsc_page_timeseries</code> (product URL slug, else service hub slug).</div><table class="rt-table rt-striped rt-breakdown-table">${head}<tbody>${body}</tbody>${foot}</table>`;
}

export function renderPageBreakdownTable(findings, options = {}) {
  const { tierFilter = '', search = '', includeJlr = false } = options;
  let rows = findings.pages.all.map((f) => rowDataForBreakdown(f, includeJlr));
  if (tierFilter) rows = rows.filter((r) => r.tier_key === tierFilter);
  if (search) rows = rows.filter((r) => r.unit.toLowerCase().includes(search.toLowerCase()));
  const head = `<thead><tr><th>Landing page</th><th>12mo</th>${GSC_COL_HEAD}${ytdHead()}<th>2026 ann.</th><th>2025</th><th>2024</th><th>Δ 25→26</th><th>Δ 24→25</th><th>Badges</th><th>2025 #</th></tr></thead>`;
  const body = rows.map((r) => {
    const { slug, badge } = parsePageSlug(r.unit);
    const spark = inlineSparkline([r.y2024, r.y2025, r.y2026_ytd, r.y2026_ann], '#22c55e');
    return `<tr><td class="unit-cell">${slugLink(r.unit, slug)} ${badge}</td><td>${spark}</td>`
      + gscMetricCells(r.gsc)
      + ytdCell(r.y2026_ytd)
      + `<td>${fmtMoney(r.y2026_ann)}</td><td>${fmtMoney(r.y2025)}</td><td>${fmtMoney(r.y2024)}</td>`
      + `<td class="${r.delta25to26 < 0 ? 'is-negative' : ''}">${fmtDelta(r.delta25to26)}</td>`
      + `<td class="${r.delta24to25 < 0 ? 'is-negative' : ''}">${fmtDelta(r.delta24to25)}</td>`
      + `<td>${badgeForFinding(r.f)}</td><td>${r.units}</td></tr>`;
  }).join('');
  const foot = rows.length ? grandTotalRow(
    gtLabel()
    + gtEmpty(1)
    + gscFootCells(rows)
    + `<td class="rt-year-col rt-grand-total-num">${fmtMoney(sumNums(rows.map((r) => r.y2026_ytd)))}</td>`
    + gtMoney(sumNums(rows.map((r) => r.y2026_ann)))
    + gtMoney(sumNums(rows.map((r) => r.y2025)))
    + gtMoney(sumNums(rows.map((r) => r.y2024)))
    + `<td class="rt-grand-total-num">${fmtDelta(sumNums(rows.map((r) => r.delta25to26)))}</td>`
    + `<td class="rt-grand-total-num">${fmtDelta(sumNums(rows.map((r) => r.delta24to25)))}</td>`
    + gtEmpty(1)
    + `<td class="rt-grand-total-num">${sumNums(rows.map((r) => r.units)).toLocaleString('en-GB')}</td>`
  ) : '';
  return `<div class="rt-basis-note">${basisBadge('nonjlr_net')} Page operational revenue — Pick&apos;n&apos;Mix / Gift Voucher timing excluded (netted in §8). Voucher-redemption lines without landing pages excluded by design. GSC Clicks/CTR = last 3 closed months on landing-page slug.</div><table class="rt-table rt-striped rt-breakdown-table">${head}<tbody>${body}</tbody>${foot}</table>`;
}

export function renderReconciliationPivotTable(rows, dimensionHeader, labelFn, keys) {
  const visible = rows.filter((r) => keys.has(`${r.year}|${r.month}`));
  const pivot = pivotRows(visible, labelFn);
  const revMonths = reverseMonths(pivot.months);
  let head = `<thead><tr><th>${dimensionHeader}</th><th>Trend</th>`;
  head += ytdHead() + monthHeaderCells(revMonths) + '<th>Total</th></tr></thead>';
  const body = pivot.dims.map((dim) => {
    const series = pivot.months.map((m) => pivot.cellMap.get(`${m.year}|${m.month}|${dim}`)?.revenue || 0);
    const y2026 = sumYearFromMonths(pivot.months, 2026, (m) => pivot.cellMap.get(`${m.year}|${m.month}|${dim}`)?.revenue || 0);
    const total = series.reduce((s, v) => s + v, 0);
    const monthCells = monthValueCells(revMonths, (m) => pivot.cellMap.get(`${m.year}|${m.month}|${dim}`)?.revenue || 0);
    return `<tr><td>${escapeHtml(dim)}</td>${sparkDeltaCol(pivot.months.map((m) => pivot.cellMap.get(`${m.year}|${m.month}|${dim}`) || { revenue: 0 }), (x) => x.revenue || 0)}${ytdCell(y2026)}${monthCells}<td style="font-weight:700;">${fmtMoney(total)}</td></tr>`;
  }).join('');
  const monthTotals = revMonths.map((m) => sumNums(pivot.dims.map((dim) => pivot.cellMap.get(`${m.year}|${m.month}|${dim}`)?.revenue || 0)));
  const footY2026 = sumNums(pivot.dims.map((dim) => sumYearFromMonths(pivot.months, 2026, (m) => pivot.cellMap.get(`${m.year}|${m.month}|${dim}`)?.revenue || 0)));
  const footGrand = sumNums(monthTotals);
  const footCells = gtLabel() + gtEmpty(1) + `<td class="rt-year-col rt-grand-total-num">${fmtMoney(footY2026)}</td>`
    + monthFootMoneyCells(revMonths, monthTotals) + gtMoney(footGrand);
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
  head += ytdHead() + monthHeaderCells(months) + '<th>Total gross</th><th>Fees</th><th>Net</th></tr></thead>';
  const body = fundings.map((f) => {
    const y2026 = sumYearFromMonths(months, 2026, (m) => cellMap.get(`${m.year}|${m.month}|${f}`)?.revenue || 0);
    let total = 0;
    let fees = 0;
    for (const m of months) {
      const r = cellMap.get(`${m.year}|${m.month}|${f}`);
      total += r?.revenue || 0;
      fees += r?.feesEstimated || 0;
    }
    const monthCells = monthValueCells(months, (m) => cellMap.get(`${m.year}|${m.month}|${f}`)?.revenue || 0);
    return `<tr><td>${escapeHtml(f)}</td>${sparkDeltaCol(months.map((m) => ({ revenue: cellMap.get(`${m.year}|${m.month}|${f}`)?.revenue || 0 })), (x) => x.revenue)}${ytdCell(y2026)}${monthCells}<td>${fmtMoney(total)}</td><td>${fmtMoney(fees, 2)}</td><td>${fmtMoney(total - fees, 2)}</td></tr>`;
  }).join('');
  const monthTotals = months.map((m) => sumNums(fundings.map((f) => cellMap.get(`${m.year}|${m.month}|${f}`)?.revenue || 0)));
  const footY2026 = sumNums(fundings.map((f) => sumYearFromMonths(months, 2026, (m) => cellMap.get(`${m.year}|${m.month}|${f}`)?.revenue || 0)));
  let footGross = 0;
  let footFees = 0;
  for (const m of months) {
    footGross += sumNums(fundings.map((f) => cellMap.get(`${m.year}|${m.month}|${f}`)?.revenue || 0));
    footFees += sumNums(fundings.map((fn) => cellMap.get(`${m.year}|${m.month}|${fn}`)?.feesEstimated || 0));
  }
  const footCells = gtLabel() + gtEmpty(1) + `<td class="rt-year-col rt-grand-total-num">${fmtMoney(footY2026)}</td>`
    + monthFootMoneyCells(months, monthTotals) + gtMoney(footGross) + gtMoney(footFees, 2) + gtMoney(footGross - footFees, 2);
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
  return {
    productsDecline: renderMoverList(rankTopFindings(findings.products.all || [], window, 'decline', includeJlr), findings, window, includeJlr),
    pagesDecline: renderMoverList(rankTopFindings(findings.pages.all || [], window, 'decline', includeJlr), findings, window, includeJlr),
    productsGrowth: renderMoverList(rankTopFindings(findings.products.all || [], window, 'growth', includeJlr), findings, window, includeJlr)
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
  const seasonal = f.unit_type === 'product' && isSeasonalAnnualisationProduct(f.meta?.seasonality_type);
  const seasonalBadge = seasonal ? ' <span class="rt-pill partial">seasonal event</span>' : '';
  const annRow = seasonal
    ? ''
    : `<tr><td>${findings.currentYear} ann.</td><td>${fmtMoney(s.y2026_annualised, 0)}</td></tr>`;
  const annTotal = seasonal ? 0 : (s.y2026_annualised || 0);
  const table = `<table class="rt-movers-mini-table"><thead><tr><th>Year</th><th>£</th></tr></thead><tbody>`
    + `<tr><td>2024</td><td>${fmtMoney(s.y2024, 0)}</td></tr>`
    + `<tr><td>2025</td><td>${fmtMoney(s.y2025, 0)}</td></tr>`
    + `<tr><td>${findings.currentYear} YTD</td><td>${fmtMoney(s.y2026_ytd_closed || s.y2026_ytd, 0)}</td></tr>`
    + annRow
    + `</tbody>`
    + grandTotalRow(gtLabel('Total £') + gtMoney((s.y2024 || 0) + (s.y2025 || 0) + (s.y2026_ytd_closed || s.y2026_ytd || 0) + annTotal, 0))
    + `</table>`;
  return `<details class="rt-movers-card"><summary>${titleHtml}${seasonalBadge} — ${fmtDelta(d.delta_gbp)}</summary>${signals}${table}<p class="rt-sub">${escapeHtml(f.plain_text || '')}</p></details>`;
}

export function renderTierChartSvg(monthly, cfg, includeJlr, containerWidth) {
  if (!monthly?.length) return '<p class="rt-sub">No monthly data.</p>';
  const months = reverseMonths(monthly.slice().sort((a, b) => (a.year - b.year) || (a.month - b.month)));
  const bands = cfg?.tierBands || DEFAULT_TIER_BANDS;
  const maxVal = Math.max(bands.thrive * 1.15, ...months.map((m) => Math.max(m.headlineRevenue || 0, m.recurringBaseline || 0)));
  const n = months.length;
  const cw = Number(containerWidth) || 960;
  const minW = n * 68 + 80;
  const w = Math.max(cw, minW);
  const h = 340;
  const padL = 52;
  const padR = 20;
  const padT = 32;
  const padB = 56;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const yScale = (v) => padT + chartH - (Math.max(0, v) / maxVal) * chartH;
  const groupW = chartW / n;
  const barGap = 4;
  const barW = Math.max(14, (groupW - barGap) / 2 * 0.92);

  const kLabel = (v) => `£${Math.round((Number(v) || 0) / 1000)}k`;
  const refLines = [
    { v: bands.survival, label: kLabel(bands.survival), cls: 'survival' },
    { v: bands.comfortable, label: kLabel(bands.comfortable), cls: 'comfortable' },
    { v: bands.thrive, label: kLabel(bands.thrive), cls: 'thrive' }
  ];
  const refs = refLines.map((r) => {
    const y = yScale(r.v);
    return `<line class="rt-chart-ref rt-chart-ref-${r.cls}" x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" />`
      + `<text class="rt-chart-ref-label" x="${padL - 4}" y="${y + 4}" text-anchor="end">${r.label}</text>`;
  }).join('');

  const bars = months.map((m, i) => {
    const cx = padL + groupW * i + groupW / 2;
    const head = m.headlineRevenue || 0;
    const rec = m.recurringBaseline || 0;
    const headCol = m.isPartial ? BAND_COLOURS.partial : (BAND_COLOURS[m.band] || '#64748b');
    const yHead = yScale(head);
    const hHead = padT + chartH - yHead;
    const yRec = yScale(rec);
    const hRec = padT + chartH - yRec;
    const lbl = monthLabel(m.year, m.month);
    const tip = `Headline ${fmtMoney(head, 0)} · Recurring ${fmtMoney(rec, 0)}`;
    return `<g class="rt-chart-month" transform="translate(${cx},0)">`
      + `<title>${escapeHtml(lbl)}: ${escapeHtml(tip)}</title>`
      + `<rect class="rt-chart-bar-head" x="${-(barW + barGap / 2)}" y="${yHead}" width="${barW}" height="${hHead}" fill="${headCol}" rx="3" />`
      + `<rect class="rt-chart-bar-rec" x="${barGap / 2}" y="${yRec}" width="${barW}" height="${hRec}" fill="url(#rt-hatch)" stroke="${BAND_COLOURS[m.recurringBand] || '#475569'}" stroke-width="1" rx="3" />`
      + `<text class="rt-chart-val" x="${-(barGap / 2 + barW / 2)}" y="${Math.max(padT + 10, yHead - 5)}" text-anchor="middle">${fmtMoney(head, 0)}</text>`
      + `<text class="rt-chart-val rt-chart-val-rec" x="${barGap / 2 + barW / 2}" y="${Math.max(padT + 10, yRec - 5)}" text-anchor="middle">${fmtMoney(rec, 0)}</text>`
      + `<text class="rt-chart-month-label" x="0" y="${h - 14}" text-anchor="middle">${lbl}</text>`
      + `</g>`;
  }).join('');

  const headlineNote = includeJlr ? 'Headline (JLR incl.)' : 'Headline (JLR excluded)';
  const scrollStyle = w > cw ? ` style="min-width:${w}px"` : '';
  return `<div class="rt-tier-chart-inner"${scrollStyle}><svg class="rt-tier-chart-svg" width="100%" height="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Monthly headline vs recurring baseline">`
    + `<defs><pattern id="rt-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
    + `<line x1="0" y1="0" x2="0" y2="6" stroke="#64748b" stroke-width="2" /></pattern></defs>`
    + refs + bars
    + `<text class="rt-chart-legend-note" x="${padL}" y="16">${escapeHtml(headlineNote)} solid · Recurring hatched</text>`
    + `</svg></div>`;
}

export function renderTierChartTable(monthlyAll, keys) {
  const monthly = monthlyAll.filter((m) => keys.has(`${m.year}|${m.month}`));
  const revMonthly = reverseMonths(monthly);
  const ytd2026 = monthly.filter((m) => m.year === 2026);
  const rows = revMonthly.map((m) => {
    const colour = m.isPartial ? BAND_COLOURS.partial : (BAND_COLOURS[m.band] || '#64748b');
    const recColour = m.isPartial ? BAND_COLOURS.partial : (BAND_COLOURS[m.recurringBand] || '#64748b');
    return `<tr><td>${monthLabel(m.year, m.month)}</td><td style="font-weight:700;">${fmtMoney(m.headlineRevenue, 2)}</td><td>${fmtMoney(m.recurringBaseline ?? 0, 2)}</td><td>${BAND_LABEL[m.band] || m.band}</td><td><span class="rt-bar-swatch" style="background:${colour}"></span><span class="rt-bar-swatch" style="background:${recColour};margin-left:4px;"></span></td></tr>`;
  }).join('');
  const ytdRow = ytdFootRow('2026 YTD', gtMoney(sumNums(ytd2026.map((m) => m.headlineRevenue)), 2)
    + gtMoney(sumNums(ytd2026.map((m) => m.recurringBaseline)), 2)
    + gtEmpty(2));
  const footGrand = `<tr class="rt-grand-total">${gtLabel()}`
    + gtMoney(sumNums(monthly.map((m) => m.headlineRevenue)), 2)
    + gtMoney(sumNums(monthly.map((m) => m.recurringBaseline)), 2)
    + gtEmpty(2) + `</tr>`;
  return `<div class="rt-basis-note">${basisBadge('headline_gross')} Headline gross · ${basisBadge('recurring_baseline')} recurring baseline = operational run-rate (headline minus voucher tiers + redemptions; residential + seasonal events included). <em>Recurring can sit above headline in months where you redeem more vouchers than you sell — the voucher-timing adjustment pulls the cash headline below the work actually delivered.</em></div>`
    + `<table class="rt-table rt-striped"><thead><tr><th>Month</th><th>Headline £</th><th>Recurring £</th><th>Band</th><th></th></tr></thead><tbody>${rows}</tbody><tfoot>${ytdRow}${footGrand}</tfoot></table>`;
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
