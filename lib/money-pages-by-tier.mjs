/**
 * Pipeline & Funnel · "Money pages by tier: search → sales" (P8): one row per money-page tier — Booking Sheet
 * revenue for the §9 window (and the window before), Search Console for that tier's hub + product pages over the
 * same window, best rank · volume and AIO misses, page states. A row opens the tier's §9 drill-down.
 */
import { renderTierStateChips } from './revenue-truth-section9-ui.mjs';

export const FUNNEL_TIERS = [
  { id: 'courses', label: 'Courses / Masterclasses', cats: [1], diag: ['courses_masterclasses'] },
  { id: 'workshops_nonres', label: 'Workshops (non-res)', cats: [2], diag: ['workshops_non_residential'] },
  { id: 'workshops_residential', label: 'Workshops (residential)', cats: [3], diag: ['workshops_residential'] },
  { id: 'services', label: '1-2-1 & Services', cats: [6, 7], diag: ['one_to_one_lessons', 'mentoring'] },
  { id: 'hire', label: 'Hire / Commercial', cats: [10, 11], diag: ['commissions', 'prints_royalties'] },
  { id: 'academy', label: 'Academy', cats: [12], diag: ['academy'] }
];

const fmt = (n) => '£' + Math.round(Number(n) || 0).toLocaleString('en-GB');
const fmtN = (n) => Math.round(Number(n) || 0).toLocaleString('en-GB');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const mkey = (y, m) => y * 12 + (m - 1);

/** Revenue + GP of the tier's categories in the last `months` closed months, and the `months` before that. */
export function windowRevenue(categoryBreakdown, cats, now, months) {
  const end = mkey(now.year, now.month);
  const out = { rev: 0, gp: 0, prior: 0 };
  for (const r of categoryBreakdown || []) {
    if (!cats.includes(Number(r.category_order))) continue;
    const age = end - mkey(Number(r.year), Number(r.month));
    if (age >= 1 && age <= months) { out.rev += Number(r.revenue) || 0; out.gp += Number(r.gpAmount) || 0; }
    else if (age > months && age <= months * 2) out.prior += Number(r.revenue) || 0;
  }
  return out;
}

function searchTotals(rollups) {
  const s = { imp: 0, clicks: 0, posW: 0 };
  for (const t of rollups) {
    for (const g of [t.hub_gsc_trend?.totals, t.product_gsc_trend?.totals]) {
      if (!g) continue;
      s.imp += Number(g.impressions) || 0;
      s.clicks += Number(g.clicks) || 0;
      s.posW += (Number(g.best_avg_position) || 0) * (Number(g.impressions) || 0);
    }
  }
  return { ...s, pos: s.imp ? s.posW / s.imp : null };
}

function stateCounts(rollups) {
  const c = {};
  for (const t of rollups) for (const [k, v] of Object.entries(t.page_state_counts || {})) c[k] = (c[k] || 0) + v;
  return c;
}

function gpChip(pct) {
  if (pct == null) return '';
  const cls = pct >= 80 ? 'g1' : pct >= 60 ? 'g2' : 'g3';
  return `<span class="mpt-gp ${cls}">GP ${Math.round(pct)}%</span>`;
}

function vsPrior(rev, prior) {
  if (!(prior > 0)) return '—';
  const p = ((rev - prior) / prior) * 100;
  return `<span class="${p < 0 ? 'mpt-neg' : 'mpt-pos'}">${p >= 0 ? '+' : ''}${Math.round(p)}%</span>`;
}

function searchCells(s) {
  return `<td class="n">${fmtN(s.imp)}</td><td class="n">${fmtN(s.clicks)}</td>`
    + `<td class="n">${s.imp ? ((s.clicks / s.imp) * 100).toFixed(2) + '%' : '—'}</td>`
    + `<td class="n">${s.pos != null ? '#' + s.pos.toFixed(1) : '—'}</td>`;
}

function rankCells(perf) {
  const rank = perf.best_rank != null ? `#${perf.best_rank}` : '—';
  return `<td class="n">${rank} · ${fmtN(perf.total_search_volume)}</td><td class="n">${perf.ai_keywords_uncited ?? '—'}</td>`;
}

function tierRow(tier, ctx) {
  const rollups = (ctx.diagnosis?.tier_rollup || []).filter((t) => tier.diag.includes(t.tier_key));
  const perf = (ctx.moneyPerf || []).find((m) => m.tier_id === tier.id) || {};
  const w = windowRevenue(ctx.categoryBreakdown, tier.cats, ctx.now, ctx.windowMonths);
  const pages = rollups.reduce((a, t) => a + (t.page_count || 0), 0);
  return `<tr class="mpt-row" data-mpt-tier="${esc(tier.diag.join(','))}" title="Open the hubs and product pages for this tier">`
    + `<td><span class="mpt-arrow">▶</span><b>${esc(tier.label)}</b>${gpChip(w.rev > 0 ? (w.gp / w.rev) * 100 : null)}<span class="mpt-small">${pages} page${pages === 1 ? '' : 's'}</span></td>`
    + `<td class="n">${fmt(w.rev)}</td><td class="n">${vsPrior(w.rev, w.prior)}</td>`
    + searchCells(searchTotals(rollups)) + rankCells(perf)
    + `<td>${renderTierStateChips(stateCounts(rollups), 'info')}</td></tr>`;
}

function unmappedLine(diagnosis) {
  const u = diagnosis?.unmapped_product_categories || [];
  if (!u.length) return '';
  return `<div class="mpt-warn">⚠ Products not mapped to a tier: ${u.map((x) => `${esc(x.category)} (${x.product_count})`).join(', ')}</div>`;
}

/** ctx: { diagnosis, moneyPerf, categoryBreakdown, now, windowMonths, suppressedNote } */
export function renderMoneyByTierHtml(ctx) {
  if (!ctx.diagnosis || !ctx.categoryBreakdown) return '<div class="rt-loading">Loading money pages&hellip;</div>';
  const head = ['Tier', `Revenue (${ctx.windowMonths}mo)`, `vs prior ${ctx.windowMonths}mo`, 'Impressions', 'Clicks', 'CTR', 'Avg pos', 'Best rank · volume', 'AIO miss', 'Page states']
    .map((h, i) => `<th class="${i > 0 && i < 9 ? 'n' : ''}" data-col="${i}">${h}</th>`).join('');
  return `<table class="mpt-table rt-table" id="rf-money-tier-table"><thead><tr>${head}</tr></thead><tbody>${FUNNEL_TIERS.map((t) => tierRow(t, ctx)).join('')}</tbody></table>`
    + unmappedLine(ctx.diagnosis)
    + `<div class="mpt-small">Window ${ctx.windowMonths} closed months · Booking Sheet and Search Console over the same months · follows the Include JLR switch · targets are on the tier cards above (Strategy &amp; Actions) · <a href="#rf-aio-section" data-goto-panel="money" data-goto-anchor="rf-aio-section">Full AI Overview map →</a>${ctx.suppressedNote ? ' · ' + esc(ctx.suppressedNote) : ''}</div>`;
}
