import { escapeHtml, fmtN } from './snapshot-utils.mjs';

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
  visibility_loss_with_low_ctr_baseline: 'Visibility Loss + Low-CTR Baseline',
  visibility_loss_normal_ctr: 'Visibility Loss',
  funnel_bypass_revenue_with_minimal_organic: 'Funnel Bypass',
  traffic_rich_modest_conversion: 'Traffic-Rich Modest Conversion',
  matched_healthy: 'Healthy',
  insufficient_history: 'Insufficient History (Event-Bound)',
  insufficient_data: 'Insufficient Data',
  skipped_none: 'Skipped (None)'
};

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, healthy: 4, info: 5 };

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

function trendArrow(from, to) {
  const f = Number(from) || 0;
  const t = Number(to) || 0;
  if (t > f * 1.02) return '<span class="rt-diag-tier-arrow-down">▼</span>';
  if (t < f * 0.98) return '<span class="rt-diag-tier-arrow-down">▼</span>';
  return '<span class="rt-diag-tier-arrow-flat">▸</span>';
}

function tierHubSlugs(tier) {
  return (tier?.hub_gsc_trend?.slugs || []).map((r) => r.slug);
}

function pageGscRole(slug, tier) {
  if (tierHubSlugs(tier).includes(String(slug || ''))) return 'hub';
  return null;
}

function renderRoleMetricsHtml(metrics) {
  const m = metrics || {};
  return ''
    + `<div class="rt-diag-role-metric">Impressions: <strong>${fmtN(m.impressions || 0)}</strong></div>`
    + `<div class="rt-diag-role-metric">Clicks: <strong>${fmtN(m.clicks || 0)}</strong></div>`
    + `<div class="rt-diag-role-metric">CTR: <strong>${diagCtrPct(m.clicks, m.impressions)}</strong></div>`
    + `<div class="rt-diag-role-metric">Avg position: <strong>${diagPosLabel(m.best_avg_position ?? m.avg_position_imp_weighted)}</strong></div>`;
}

function renderRolePanelHtml(label, overlay, roleKind) {
  const slugs = overlay?.slugs || [];
  const totals = overlay?.totals || {};
  const cls = roleKind === 'product' ? 'is-product' : 'is-hub';
  const sorted = slugs.slice().sort((a, b) => (Number(b.impressions) || 0) - (Number(a.impressions) || 0));
  const rows = sorted.map((row) => {
    const zero = !(Number(row.impressions) || 0);
    return `<tr class="${zero ? 'is-zero' : ''}"><td class="slug">/${escapeHtml(row.slug)}</td><td>${fmtN(row.impressions || 0)}</td><td>${fmtN(row.clicks || 0)}</td><td>${diagCtrPct(row.clicks, row.impressions)}</td><td>${diagPosLabel(row.best_avg_position)}</td></tr>`;
  }).join('');
  return `<div class="rt-diag-role-panel ${cls}"><div class="rt-diag-role-panel-head">${escapeHtml(label)} · ${slugs.length} slug${slugs.length === 1 ? '' : 's'}</div><div class="rt-diag-role-panel-totals"><div><div class="k">Impressions</div><div class="v">${fmtN(totals.impressions || 0)}</div></div><div><div class="k">Clicks</div><div class="v">${fmtN(totals.clicks || 0)}</div></div><div><div class="k">CTR</div><div class="v">${diagCtrPct(totals.clicks, totals.impressions)}</div></div><div><div class="k">Avg position</div><div class="v">${diagPosLabel(totals.best_avg_position)}</div></div></div><table class="rt-diag-role-slug-table"><thead><tr><th>Slug</th><th>Imp</th><th>Clicks</th><th>CTR</th><th>Pos</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderRoleCompareBar(hubImp, prodImp) {
  const total = hubImp + prodImp;
  if (!total) return '<div class="rt-diag-role-strip-note">No GSC impressions in overlay window.</div>';
  const hubPct = Math.round(100 * hubImp / total);
  const prodPct = 100 - hubPct;
  return `<div class="rt-diag-role-compare"><div class="rt-diag-role-compare-label">Impression share (Hub vs Product)</div><div class="rt-diag-role-compare-bar"><div class="hub" style="width:${hubPct}%"></div><div class="product" style="width:${prodPct}%"></div></div><div class="rt-diag-role-compare-legend"><span>Hub ${hubPct}% (${fmtN(hubImp)} imp)</span><span>Product ${prodPct}% (${fmtN(prodImp)} imp)</span></div></div>`;
}

function renderTierRoleExpandPanel(tier) {
  const hub = tier.hub_gsc_trend || {};
  const prod = tier.product_gsc_trend || {};
  const hubImp = Number(hub.totals?.impressions) || 0;
  const prodImp = Number(prod.totals?.impressions) || 0;
  return `<div class="rt-diag-role-expand"><div class="rt-diag-role-expand-title">GSC by page role — slug breakdown (Jan 2025+ totals, overlay only)</div><div class="rt-diag-role-expand-pair">${renderRolePanelHtml('Hub (discovery)', hub, 'hub')}${renderRolePanelHtml('Product (specific intent)', prod, 'product')}</div>${renderRoleCompareBar(hubImp, prodImp)}</div>`;
}

function renderPageRoleGscStrip(d, tier) {
  const fw = d.metrics?.full_window || {};
  const pageMetrics = { impressions: fw.impressions || 0, clicks: fw.clicks || 0, avg_position_imp_weighted: fw.avg_position_imp_weighted };
  const prodTotals = tier.product_gsc_trend?.totals || {};
  const role = pageGscRole(d.page_slug, tier);
  const pageLabel = role === 'hub' ? 'This page · Hub (discovery)' : 'This page · diagnostic URL';
  const hubBadge = role === 'hub' ? '<span class="rt-diag-role-badge is-hub">Hub</span>' : '';
  const prodCount = (tier.product_gsc_trend?.slugs || []).length;
  return `<div class="rt-diag-role-strip"><div class="rt-diag-role-panel is-hub"><div class="rt-diag-role-panel-head">${pageLabel}${hubBadge}</div>${renderRoleMetricsHtml(pageMetrics)}</div><div class="rt-diag-role-panel is-product"><div class="rt-diag-role-panel-head">Tier product pages · specific intent</div>${renderRoleMetricsHtml(prodTotals)}<div class="rt-diag-role-strip-note">${prodCount} product URL${prodCount === 1 ? '' : 's'} in this tier (L3 slugs — not separate page cards).</div></div></div>`;
}

function renderSparkPlaceholder(d) {
  const fw = d.metrics?.full_window || {};
  return `<div class="rt-diag-sparkrow"><div class="rt-diag-sparkbox"><div class="rt-diag-sparkbox-title"><span>Revenue / month (non-JLR)</span><span class="rt-diag-sparkbox-total">£${fmtN(fw.revenue_gbp_nonjlr || 0)} window</span></div><div class="spark-placeholder">[monthly revenue sparkline in live dashboard]</div></div><div class="rt-diag-sparkbox"><div class="rt-diag-sparkbox-title"><span>Organic clicks / month</span><span class="rt-diag-sparkbox-total">${fmtN(fw.clicks || 0)} window</span></div><div class="spark-placeholder">[monthly clicks sparkline in live dashboard]</div></div></div>`;
}

function renderDiagCardHtml(d, tier, breakdownSample) {
  const sev = RT_DIAG_SEVERITY[d.state] || 'info';
  const stateLabel = RT_DIAG_STATE_LABEL[d.state] || d.state;
  const mixed = d.page_seasonality?.is_mixed_seasonality === true;
  const hubBadge = pageGscRole(d.page_slug, tier) === 'hub' ? '<span class="rt-diag-role-badge is-hub">Hub · discovery</span>' : '';
  const window = d.metrics?.gsc_overlay_window;
  const fw = d.metrics?.full_window || {};
  let drill = '';
  if (mixed && breakdownSample && breakdownSample.page_slug === d.page_slug) {
    const rows = (breakdownSample.products || []).slice(0, 6).map((p) => `<tr><td class="diag-prod">${escapeHtml(p.product_title)}</td><td>${p.lifetime_txn_count || 0}</td><td>£${fmtN(p.window_revenue_nonjlr || 0)}</td><td>£${fmtN(p.lifetime_revenue_nonjlr || 0)}</td></tr>`).join('');
    drill = `<div class="rt-diag-drill open"><div class="rt-diag-drill-btn-static">Level 3 — per-product revenue breakdown (sample, no GSC)</div><table class="rt-diag-drill-table"><thead><tr><th>Product</th><th>Txns</th><th>Window £</th><th>Lifetime £</th></tr></thead><tbody>${rows}</tbody></table><div class="rt-diag-role-strip-note">Showing first 6 of ${breakdownSample.products_on_page || 0} products. Live UI loads via API on button click.</div></div>`;
  } else if (mixed) {
    drill = '<div class="rt-diag-drill"><div class="rt-diag-drill-btn-static">Show per-product breakdown » (mixed-seasonality page)</div></div>';
  }
  return `<div class="rt-diag-card severity-${sev}"><div class="rt-diag-card-head"><div class="rt-diag-slug"><span class="rt-diag-slug-link">/${escapeHtml(d.page_slug)}</span>${hubBadge}<span class="rt-diag-rank">rank ${d.rank_score ?? 0}</span></div><span class="rt-diag-state-pill severity-${sev}">${escapeHtml(stateLabel)}</span></div>${window ? `<div class="rt-diag-window-label"><strong>GSC overlay window:</strong> ${escapeHtml(window.first_period)} to ${escapeHtml(window.last_period)} · ${window.months_covered || 0} months</div>` : ''}${renderPageRoleGscStrip(d, tier)}<div class="rt-diag-meta"><div class="rt-diag-meta-tile"><div class="rt-diag-meta-label">Window clicks</div><div class="rt-diag-meta-value">${fmtN(fw.clicks || 0)}</div></div><div class="rt-diag-meta-tile"><div class="rt-diag-meta-label">Window impressions</div><div class="rt-diag-meta-value">${fmtN(fw.impressions || 0)}</div></div><div class="rt-diag-meta-tile"><div class="rt-diag-meta-label">Window CTR</div><div class="rt-diag-meta-value">${fw.ctr_pct != null ? fw.ctr_pct.toFixed(2) + '%' : '—'}</div></div><div class="rt-diag-meta-tile"><div class="rt-diag-meta-label">Avg position</div><div class="rt-diag-meta-value">${diagPosLabel(fw.avg_position_imp_weighted)}</div></div><div class="rt-diag-meta-tile"><div class="rt-diag-meta-label">Window revenue</div><div class="rt-diag-meta-value">£${fmtN(fw.revenue_gbp_nonjlr || 0)}</div></div></div><div class="rt-diag-verdict">${escapeHtml(d.verdict_text || '')}</div>${renderSparkPlaceholder(d)}${drill}</div>`;
}

function renderTierStateChips(counts, tierSeverity) {
  const c = counts || {};
  const keys = Object.keys(c).sort((a, b) => (SEVERITY_RANK[RT_DIAG_SEVERITY[a] || 'info'] ?? 9) - (SEVERITY_RANK[RT_DIAG_SEVERITY[b] || 'info'] ?? 9));
  if (!keys.length) return `<span class="rt-diag-tier-stchip severity-${tierSeverity || 'info'}">no pages</span>`;
  return keys.map((k) => `<span class="rt-diag-tier-stchip severity-${RT_DIAG_SEVERITY[k] || 'info'}">${c[k]} × ${escapeHtml(RT_DIAG_STATE_LABEL[k] || k)}</span>`).join('');
}

function renderTierRowHtml(t, pages, breakdownSample, expanded) {
  const sev = t.severity || 'info';
  const rt = t.revenue_trend || {};
  const y24 = rt.y2024?.non_jlr || 0;
  const y25 = rt.y2025?.non_jlr || 0;
  const y26 = rt.y2026_ytd?.non_jlr || 0;
  const hub = t.hub_gsc_trend?.totals || {};
  const prod = t.product_gsc_trend?.totals || {};
  const body = expanded
    ? `<div class="rt-diag-tier-body">${renderTierRoleExpandPanel(t)}<div class="rt-diag-cards">${pages.map((d) => renderDiagCardHtml(d, t, breakdownSample)).join('')}</div></div>`
    : '';
  return `<div class="rt-diag-tier-row severity-${sev} ${expanded ? '' : 'is-collapsed'}"><div class="rt-diag-tier-head"><div><div class="rt-diag-tier-cell-label">Tier</div><div class="rt-diag-tier-title"><span class="rt-diag-tier-toggle">${expanded ? '▼' : '▶'}</span><span class="rt-diag-tier-label">${escapeHtml(t.label)}</span></div><div class="tier-sub">${escapeHtml(t.booking_category)} · ${t.page_count || 0} pages</div></div><div class="rt-diag-tier-revtrend"><div class="rt-diag-tier-cell-label">Revenue trend (JLR-excluded, Booking Sheet)</div><div><strong>2024</strong> £${fmtN(y24)} ${trendArrow(y24, y25)} <strong>2025</strong> £${fmtN(y25)} ${trendArrow(y25, y26)} <strong>2026 YTD</strong> £${fmtN(y26)}</div><div class="rt-diag-tier-footnote">Money for the whole tier — not tied to GSC role columns</div></div><div class="rt-diag-tier-rolegsc"><div class="rt-diag-tier-cell-label">GSC by page role (Jan 2025+ totals, overlay only)</div><div class="rt-diag-tier-rolegsc-pair"><div class="rt-diag-tier-rolegsc-col is-hub"><div class="rt-diag-tier-cell-label">Hub (discovery)</div>${renderRoleMetricsHtml(hub)}</div><div class="rt-diag-tier-rolegsc-col is-product"><div class="rt-diag-tier-cell-label">Product (specific intent)</div>${renderRoleMetricsHtml(prod)}</div></div></div><div class="rt-diag-tier-pills"><div class="rt-diag-tier-cell-label" style="text-align:right;">Page states</div>${renderTierStateChips(t.page_state_counts, sev)}</div></div><div class="rt-diag-tier-meta"><span class="rt-diag-tier-honesty">${escapeHtml(t.gsc_honesty_note || '')}</span><span class="rt-diag-tier-risk">£ at risk: £${fmtN(t.pages_at_risk_gbp || 0)}</span></div>${body}</div>`;
}

export function renderSection9Html(payload, options = {}) {
  const expandTiers = options.expandTiers || new Set();
  const breakdownSample = options.breakdownSample || null;
  const sevRank = { critical: 0, high: 1, medium: 2, low: 3, healthy: 4, info: 5 };
  const rollup = (payload.tier_rollup || []).slice().sort((a, b) => {
    const sa = sevRank[a.severity] ?? 9;
    const sb = sevRank[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    return (Number(b.pages_at_risk_gbp) || 0) - (Number(a.pages_at_risk_gbp) || 0);
  });
  const tierRows = rollup.map((t) => {
    const pages = (payload.diagnostics || []).filter((d) => d.tier_key === t.tier_key);
    const expanded = expandTiers.has(t.tier_key);
    const sample = expanded && t.tier_key === 'workshops_non_residential' ? breakdownSample : null;
    return renderTierRowHtml(t, pages, sample, expanded);
  }).join('');
  const rec = payload.tier_reconciliation || {};
  const statusLine = `as of ${(payload.asOf || '').slice(0, 19).replace('T', ' ')} UTC · reconciliation ${rec.passes ? 'PASS' : 'FAIL'} · non-JLR 2024 £${fmtN(rec.tier_sum_non_jlr?.y2024)} / 2025 £${fmtN(rec.tier_sum_non_jlr?.y2025)} / 2026 YTD £${fmtN(rec.tier_sum_non_jlr?.y2026_ytd)}`;
  const expandedLabels = [...expandTiers].map((k) => {
    const t = rollup.find((r) => r.tier_key === k);
    return t?.label || k;
  }).join(', ');
  return { statusLine, tierRowsHtml: tierRows, expandedLabels };
}
