/** §9 Revenue Funnel Diagnosis HTML (D13–D18). */

import { escapeHtml, slugLink, tip, fmtMoney, fmtN } from './revenue-truth-ui-core.mjs';
import { deltaChipHtml, revenueYoYChip, pctChange } from './revenue-truth-gsc-deltas.mjs';
import { hubCardSignals, tierCardSignals } from './revenue-truth-key-signals.mjs';

const RT_DIAG_SEVERITY = {
  traffic_with_zero_conversion: 'critical',
  visibility_loss_with_low_ctr_baseline: 'critical',
  visibility_loss_normal_ctr: 'high',
  funnel_bypass_revenue_with_minimal_organic: 'medium',
  traffic_rich_modest_conversion: 'low',
  matched_healthy: 'healthy',
  insufficient_history: 'info',
  insufficient_data: 'info',
  skipped_none: 'info'
};

const RT_DIAG_STATE_LABEL = {
  traffic_with_zero_conversion: 'Traffic / Zero Conversion',
  visibility_loss_with_low_ctr_baseline: 'Visibility Loss + Low-CTR',
  visibility_loss_normal_ctr: 'Visibility Loss',
  funnel_bypass_revenue_with_minimal_organic: 'Funnel Bypass',
  traffic_rich_modest_conversion: 'Traffic-Rich Modest Conversion',
  matched_healthy: 'Healthy',
  insufficient_history: 'Insufficient History',
  insufficient_data: 'Insufficient Data',
  skipped_none: 'Skipped'
};

function diagCtrPct(clicks, impressions) {
  const imp = Number(impressions) || 0;
  const clk = Number(clicks) || 0;
  if (imp <= 0) return '—';
  return (100 * clk / imp).toFixed(2) + '%';
}

function diagPosLabel(pos) {
  if (pos == null || !Number.isFinite(Number(pos))) return '—';
  return '#' + Number(pos).toFixed(1);
}

function inlineSparkline(values, colour) {
  const nums = (values || []).map((v) => Number(v) || 0);
  if (!nums.length) return '<span class="rt-spark-empty">—</span>';
  const w = 56, h = 18, pad = 1;
  const max = Math.max(1, Math.max(...nums));
  const step = (w - 2 * pad) / Math.max(1, nums.length - 1);
  const pts = nums.map((v, i) => `${(pad + i * step).toFixed(1)},${(h - pad - (v / max) * (h - 2 * pad)).toFixed(1)}`).join(' ');
  return `<svg class="rt-inline-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${colour || '#60a5fa'}" stroke-width="1.5"/></svg>`;
}

function renderRoleMetricsBlock(totals, impPct, clickPct) {
  const m = totals || {};
  return `<div class="rt-diag-role-metrics-stack">`
    + `<div>Impressions <strong>${fmtN(m.impressions || 0)}</strong> ${deltaChipHtml(impPct)}</div>`
    + `<div>Clicks <strong>${fmtN(m.clicks || 0)}</strong> ${deltaChipHtml(clickPct)}</div>`
    + `<div>CTR <strong>${diagCtrPct(m.clicks, m.impressions)}</strong></div>`
    + `<div>Pos <strong>${diagPosLabel(m.best_avg_position)}</strong></div>`
    + `</div>`;
}

function renderRevenueBlock(t, includeJlr) {
  const rt = t.revenue_trend || {};
  const key = includeJlr ? 'total' : 'non_jlr';
  const y24 = rt.y2024?.[key] || 0;
  const y25 = rt.y2025?.[key] || 0;
  const y26 = rt.y2026_ytd?.[key] || 0;
  const basisLabel = includeJlr ? 'JLR incl.' : 'non-JLR';
  return `<div class="rt-diag-tier-rolegsc-col is-revenue">`
    + `<div class="rt-diag-tier-cell-label">Revenue trend (Booking Sheet, ${basisLabel})</div>`
    + `<div class="rt-diag-revenue-stack">`
    + `<div><strong>2024</strong> ${fmtMoney(y24, 0)}</div>`
    + `<div><strong>2025</strong> ${fmtMoney(y25, 0)} ${deltaChipHtml(pctChange(y25, y24), '24→25')}</div>`
    + `<div><strong>2026 YTD</strong> ${fmtMoney(y26, 0)} ${deltaChipHtml(pctChange(y26, y25), '25→26')}</div>`
    + `</div>`
    + `<div class="rt-diag-tier-footnote">Tier total — not GSC overlay</div>`
    + `</div>`;
}

function renderTierRoleGscPair(t, windowMonths, includeJlr) {
  const hub = t.hub_gsc_trend?.totals || {};
  const prod = t.product_gsc_trend?.totals || {};
  const hubTrend = t.hub_gsc_trend?.trend || {};
  const prodTrend = t.product_gsc_trend?.trend || {};
  return `<div class="rt-diag-tier-rolegsc-pair">`
    + renderRevenueBlock(t, includeJlr)
    + `<div class="rt-diag-tier-rolegsc-col is-hub"><div class="rt-diag-tier-cell-label">Hub (discovery)</div>${renderRoleMetricsBlock(hub, hubTrend.pct_change_impressions, hubTrend.pct_change_clicks)}</div>`
    + `<div class="rt-diag-tier-rolegsc-col is-product"><div class="rt-diag-tier-cell-label">Product (specific intent)</div>${renderRoleMetricsBlock(prod, prodTrend.pct_change_impressions, prodTrend.pct_change_clicks)}</div>`
    + `</div>`;
}

function renderTierStateChips(counts, tierSeverity) {
  const c = counts || {};
  const keys = Object.keys(c);
  if (!keys.length) return `<span class="rt-diag-tier-stchip severity-${tierSeverity || 'info'}">no pages</span>`;
  return keys.map((k) => `<span class="rt-diag-tier-stchip severity-${RT_DIAG_SEVERITY[k] || 'info'}">${c[k]} × ${escapeHtml(RT_DIAG_STATE_LABEL[k] || k)}</span>`).join('');
}

function renderHubProductTable(payload, tier, windowMonths, includeJlr) {
  const lifeKey = includeJlr ? 'lifetime_revenue_total' : 'lifetime_revenue_nonjlr';
  const winKey = includeJlr ? 'window_revenue_total' : 'window_revenue_nonjlr';
  const ytdKey = includeJlr ? 'current_year_revenue_total' : 'current_year_revenue_nonjlr';
  const curYear = payload?.current_year || new Date().getUTCFullYear();
  const products = payload?.products || [];
  const rows = products.map((p) => {
    const g = p.gsc || {};
    const path = p.product_slug
      ? '/' + String(p.product_slug).replace(/^\/+/, '')
      : (p.product_url ? p.product_url.replace(/^https?:\/\/[^/]+/, '') : '');
    const spark = inlineSparkline([p[lifeKey], p[winKey]], '#a78bfa');
    const zero = !(p.lifetime_txn_count || 0);
    const seas = p.seasonality_type || '—';
    const impD = g.impressions_delta_pct;
    return `<tr class="${zero ? 'is-zero' : ''}">`
      + `<td>${spark}</td>`
      + `<td>${path ? slugLink(path, escapeHtml(p.product_title)) : escapeHtml(p.product_title)}</td>`
      + `<td><span class="rt-diag-seasonality-pill s-${seas}">${escapeHtml(seas)}</span></td>`
      + `<td>${p.typical_price_gbp != null ? fmtMoney(p.typical_price_gbp, 0) : '—'}</td>`
      + `<td>${p.lifetime_txn_count || 0}</td>`
      + `<td>${fmtMoney(p[lifeKey] || 0, 0)}</td>`
      + `<td>${fmtMoney(p[ytdKey] || 0, 0)}</td>`
      + `<td>${fmtMoney(p[winKey] || 0, 0)}</td>`
      + `<td>${escapeHtml(p.lifetime_first_txn || '—')}</td>`
      + `<td>${escapeHtml(p.lifetime_last_txn || '—')}</td>`
      + `<td>${fmtN(g.impressions || 0)}</td>`
      + `<td>${fmtN(g.clicks || 0)}</td>`
      + `<td>${diagCtrPct(g.clicks, g.impressions)}</td>`
      + `<td>${diagPosLabel(g.best_avg_position)}</td>`
      + `<td>${deltaChipHtml(impD, 'seas-adj')}</td>`
      + `</tr>`;
  }).join('');
  const totalTxns = products.reduce((s, p) => s + (Number(p.lifetime_txn_count) || 0), 0);
  const totalLife = products.reduce((s, p) => s + (Number(p[lifeKey]) || 0), 0);
  const totalYtd = products.reduce((s, p) => s + (Number(p[ytdKey]) || 0), 0);
  const totalWin = products.reduce((s, p) => s + (Number(p[winKey]) || 0), 0);
  const totalImp = products.reduce((s, p) => s + (Number(p.gsc?.impressions) || 0), 0);
  const totalClicks = products.reduce((s, p) => s + (Number(p.gsc?.clicks) || 0), 0);
  const foot = products.length ? `<tfoot><tr class="rt-grand-total">`
    + `<td></td><td class="rt-grand-total-label">Grand total</td><td></td><td></td>`
    + `<td>${totalTxns.toLocaleString('en-GB')}</td>`
    + `<td>${fmtMoney(totalLife, 0)}</td><td>${fmtMoney(totalYtd, 0)}</td><td>${fmtMoney(totalWin, 0)}</td>`
    + `<td></td><td></td>`
    + `<td>${fmtN(totalImp)}</td><td>${fmtN(totalClicks)}</td>`
    + `<td>${diagCtrPct(totalClicks, totalImp)}</td><td></td><td></td>`
    + `</tr></tfoot>` : '';
  const filterNote = payload?.products_on_page ? `Showing all ${payload.products_on_page} canonical products mapped to this hub.` : '';
  const winStart = payload?.window_start ? ` (from ${payload.window_start} to now)` : '';
  const winTip = `Booked revenue in the rolling ${windowMonths}-month window${winStart} (Booking Sheet)`;
  const sinceTip = 'Total booked revenue 2024→now (Booking Sheet history begins 2024)';
  const ytdTip = `Booked revenue Jan 1 ${curYear} → now (current calendar year to date, Booking Sheet)`;
  return `<div class="rt-hub-products-wrap"><div class="rt-sub">${filterNote}</div>`
    + `<table class="rt-hub-product-table rt-sortable"><thead><tr>`
    + `<th>12mo</th><th>Product</th><th>Season</th><th>Price</th>`
    + `<th>${tip('Txns', 'Booked transaction count 2024→now (Booking Sheet)')}</th>`
    + `<th>${tip('Since 2024 £', sinceTip)}</th>`
    + `<th>${tip(curYear + ' YTD £', ytdTip)}</th>`
    + `<th>${tip('Window £', winTip)}</th>`
    + `<th>First</th><th>Last</th>`
    + `<th>${tip('Imp', 'GSC impressions since Jan 2025')}</th>`
    + `<th>${tip('Clicks', 'GSC clicks since Jan 2025')}</th>`
    + `<th>${tip('CTR', 'Clicks ÷ impressions')}</th>`
    + `<th>${tip('Pos', 'Average Google position (impression-weighted)')}</th>`
    + `<th>${tip('Δ', 'Seasonality-adjusted impression change')}</th>`
    + `</tr></thead><tbody>${rows || '<tr><td colspan="15">No products mapped.</td></tr>'}</tbody>${foot}</table></div>`;
}

function renderDiagCardHtml(d, tier, hubBreakdown, windowMonths, includeJlr) {
  const sev = RT_DIAG_SEVERITY[d.state] || 'info';
  const stateLabel = RT_DIAG_STATE_LABEL[d.state] || d.state;
  const fw = d.metrics?.full_window || {};
  const impD = d.deltas?.impressions?.adjusted;
  const hubBadge = (tier?.hub_gsc_trend?.slugs || []).some((r) => r.slug === d.page_slug)
    ? '<span class="rt-diag-role-badge is-hub">Hub</span>' : '';
  const productsHtml = hubBreakdown ? renderHubProductTable(hubBreakdown, tier, windowMonths, includeJlr) : '';
  return `<div class="rt-diag-card severity-${sev}" data-slug="${escapeHtml(d.page_slug)}">`
    + `<div class="rt-diag-card-head"><div class="rt-diag-slug">${slugLink('/' + d.page_slug, '/' + d.page_slug)} ${hubBadge}`
    + `<span class="rt-diag-classpill">${escapeHtml(d.page_seasonality?.type || '—')}</span></div>`
    + `<span class="rt-diag-state-pill severity-${sev}">${escapeHtml(stateLabel)}</span></div>`
    + hubCardSignals(d)
    + `<div class="rt-diag-meta">`
    + `<div class="rt-diag-meta-tile"><div class="rt-diag-meta-label">Impressions</div><div class="rt-diag-meta-value">${fmtN(fw.impressions || 0)} ${deltaChipHtml(impD, 'seas-adj')}</div></div>`
    + `<div class="rt-diag-meta-tile"><div class="rt-diag-meta-label">Clicks</div><div class="rt-diag-meta-value">${fmtN(fw.clicks || 0)}</div></div>`
    + `<div class="rt-diag-meta-tile"><div class="rt-diag-meta-label">${tip('Window £', `Booked revenue in the selected ${windowMonths}-month diagnosis window (Booking Sheet)`)}</div><div class="rt-diag-meta-value">${fmtMoney(fw.revenue_gbp_nonjlr || 0, 0)}</div></div>`
    + `</div>`
    + `<div class="rt-diag-verdict">${escapeHtml(d.verdict_text || '')}</div>`
    + productsHtml
    + `</div>`;
}

function renderTierExpandBody(t, pages, hubProducts, windowMonths, includeJlr) {
  const hub = t.hub_gsc_trend?.totals || {};
  const prod = t.product_gsc_trend?.totals || {};
  const summary = `<div class="rt-tier-expand-summary">Tier totals (${windowMonths}mo): Hub ${fmtN(hub.impressions || 0)} imp · Product ${fmtN(prod.impressions || 0)} imp · ${pages.length} diagnostic page(s). Product tables list every canonical product per hub.</div>`;
  const prodRef = `<div class="rt-tier-expand-summary">Tier-wide reference: ${fmtN((prod.impressions || 0))} product-intent impressions across ${(t.product_gsc_trend?.slugs || []).length} product URL(s).</div>`;
  const cards = pages.map((d) => {
    const bd = hubProducts?.get(d.page_slug) || null;
    return renderDiagCardHtml(d, t, bd, windowMonths, includeJlr);
  }).join('');
  return summary + prodRef + `<div class="rt-diag-cards">${cards}</div>`;
}

export function renderTierRowHtml(t, pages, options = {}) {
  const { expanded = false, windowMonths = 12, hubProducts = new Map(), includeJlr = false } = options;
  const sev = t.severity || 'info';
  const winBadge = `<span class="rt-diag-tier-window-badge">${windowMonths}mo window</span>`;
  const body = expanded ? `<div class="rt-diag-tier-body">${renderTierExpandBody(t, pages, hubProducts, windowMonths, includeJlr)}</div>` : '';
  return `<div class="rt-diag-tier-row severity-${sev} ${expanded ? '' : 'is-collapsed'}" id="rt-diag-tier-${escapeHtml(t.tier_key)}" data-tier="${escapeHtml(t.tier_key)}">`
    + `<div class="rt-diag-tier-head" data-tier-head="${escapeHtml(t.tier_key)}">`
    + `<div><div class="rt-diag-tier-cell-label">Tier ${winBadge}</div>`
    + `<div class="rt-diag-tier-title"><span class="rt-diag-tier-toggle">${expanded ? '▼' : '▶'}</span><span class="rt-diag-tier-label">${escapeHtml(t.label)}</span></div>`
    + `<div class="tier-sub">${escapeHtml(t.booking_category)} · ${t.page_count || 0} pages</div>`
    + tierCardSignals(t, includeJlr)
    + `</div>`
    + `<div class="rt-diag-tier-revtrend"><div class="rt-diag-tier-cell-label">Revenue / Hub / Product</div>${renderTierRoleGscPair(t, windowMonths, includeJlr)}</div>`
    + `<div class="rt-diag-tier-pills"><div class="rt-diag-tier-cell-label">Page states</div>${renderTierStateChips(t.page_state_counts, sev)}</div>`
    + `</div>`
    + `<div class="rt-diag-tier-meta"><span class="rt-diag-tier-honesty">${escapeHtml(t.gsc_honesty_note || '')}</span>`
    + `<span class="rt-diag-tier-risk">£ at risk: ${fmtMoney(t.pages_at_risk_gbp || 0, 0)}</span></div>`
    + body
    + `</div>`;
}

export function renderSection9Html(payload, options = {}) {
  const expandTiers = options.expandTiers || new Set();
  const windowMonths = options.windowMonths || 12;
  const hubProducts = options.hubProducts || new Map();
  const includeJlr = options.includeJlr === true;
  const sevRank = { critical: 0, high: 1, medium: 2, low: 3, healthy: 4, info: 5 };
  const rollup = (payload.tier_rollup || []).slice().sort((a, b) => {
    const sa = sevRank[a.severity] ?? 9;
    const sb = sevRank[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    return (Number(b.pages_at_risk_gbp) || 0) - (Number(a.pages_at_risk_gbp) || 0);
  });
  const tierRows = rollup.map((t) => {
    const pages = (payload.diagnostics || []).filter((d) => d.tier_key === t.tier_key);
    return renderTierRowHtml(t, pages, { expanded: expandTiers.has(t.tier_key), windowMonths, hubProducts, includeJlr });
  }).join('');
  const rec = payload.tier_reconciliation || {};
  const statusLine = `Window ${windowMonths}mo · as of ${(payload.asOf || '').slice(0, 19).replace('T', ' ')} UTC · reconciliation ${rec.passes ? 'PASS penny-exact' : 'FAIL'} · non-JLR 2026 YTD ${fmtMoney(rec.tier_sum_non_jlr?.y2026_ytd, 2)} (closed months, tier rollup)`;
  const expandedLabels = [...expandTiers].map((k) => rollup.find((r) => r.tier_key === k)?.label || k).join(', ');
  return { statusLine, tierRowsHtml: tierRows, expandedLabels, windowBar: renderWindowBar(windowMonths) };
}

export function renderWindowBar(selectedMonths) {
  const opts = [3, 6, 12, 18];
  return `<div class="rt-diag-window-bar"><strong>Window:</strong> `
    + opts.map((m) => `<label class="rt-toggle"><input type="radio" name="rt-diag-window" value="${m}"${m === selectedMonths ? ' checked' : ''}> ${m}mo</label>`).join(' ')
    + `</div>`;
}
