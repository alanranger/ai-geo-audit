/** JLR exclusion helpers for Revenue Truth summary payload shaping. */

import { classifyCategory } from './booking-sheet-parser.mjs';

function round2(n) { return Number((Number(n) || 0).toFixed(2)); }

export function filterTxnsForJlr(txns, includeJlr) {
  if (includeJlr) return txns;
  return txns.filter((t) => !t.is_jlr);
}

export function buildJlrByMonth(txns) {
  const m = new Map();
  for (const t of txns) {
    if (!t.is_jlr) continue;
    const k = `${t.year}|${t.month}`;
    m.set(k, round2((m.get(k) || 0) + Number(t.amount)));
  }
  return m;
}

export function buildJlrByCatMonth(txns) {
  const m = new Map();
  for (const t of txns) {
    if (!t.is_jlr || t.category_order == null) continue;
    const k = `${t.year}|${t.month}|${t.category_order}`;
    m.set(k, round2((m.get(k) || 0) + Number(t.amount)));
  }
  return m;
}

export function applyJlrToMonthly(monthly, jlrByMonth, classifyBand) {
  return monthly.map((m) => {
    const jlr = jlrByMonth.get(`${m.year}|${m.month}`) || 0;
    if (!jlr) return m;
    const headlineRevenue = round2(m.headlineRevenue - jlr);
    return {
      ...m,
      headlineRevenue,
      operationalRevenue: round2(Math.max(0, (m.operationalRevenue || 0) - jlr)),
      d2c: round2(Math.max(0, (m.d2c || 0) - jlr)),
      band: classifyBand(headlineRevenue),
      recurringBand: classifyBand(m.recurringBaseline ?? 0)
    };
  });
}

export function buildJlrSummaryStats(transactions, year) {
  const y = Number(year) || new Date().getUTCFullYear();
  const rows = (transactions || []).filter((t) => t.is_jlr === true);
  const byYear = {};
  for (const t of rows) {
    const yr = Number(t.year);
    if (!byYear[yr]) byYear[yr] = { total: 0, count: 0 };
    byYear[yr].total = round2(byYear[yr].total + (Number(t.amount) || 0));
    byYear[yr].count += 1;
  }
  const ytd = byYear[y] || { total: 0, count: 0 };
  return {
    year: y,
    ytd_total: ytd.total,
    ytd_count: ytd.count,
    by_year: byYear
  };
}

export function applyJlrToCategoryBreakdown(rows, jlrByCatMonth) {
  return rows.map((c) => {
    const jlr = jlrByCatMonth.get(`${c.year}|${c.month}|${c.category_order}`) || 0;
    if (!jlr) return c;
    const revenue = round2(c.revenue - jlr);
    return {
      ...c,
      revenue,
      avgPrice: c.units > 0 ? round2(revenue / c.units) : c.avgPrice,
      gpAmount: c.gpRate == null ? null : round2(revenue * c.gpRate)
    };
  });
}

/** JLR £ per legacy money-page tier key, keyed `${year}|${month}`. */
export function buildJlrTierByMonth(txns) {
  const m = new Map();
  for (const t of txns) {
    if (!t.is_jlr) continue;
    const tier = classifyCategory(t.category_label);
    if (!tier || tier === 'unidentified') continue;
    const k = `${t.year}|${t.month}`;
    const inner = m.get(k) || {};
    inner[tier] = round2((inner[tier] || 0) + Number(t.amount));
    m.set(k, inner);
  }
  return m;
}

/** Strip JLR from a shaped booking_sheet_monthly_wide row (Revenue Funnel). */
export function applyJlrToFunnelWideRow(row, jlrByMonth, jlrTierByMonth) {
  const y = Number(String(row.period_start).slice(0, 4));
  const m = Number(String(row.period_start).slice(5, 7));
  if (!y || !m) return row;
  const key = `${y}|${m}`;
  const jlrTotal = jlrByMonth.get(key) || 0;
  const jlrTier = jlrTierByMonth.get(key);
  if (!jlrTotal && !jlrTier) return row;
  let tier_revenue = row.tier_revenue;
  if (jlrTier && tier_revenue && typeof tier_revenue === 'object') {
    tier_revenue = { ...tier_revenue };
    for (const [tier, amt] of Object.entries(jlrTier)) {
      if (tier_revenue[tier] != null) {
        tier_revenue[tier] = round2(Math.max(0, Number(tier_revenue[tier]) - amt));
      }
    }
  }
  return {
    ...row,
    revenue_amount: jlrTotal ? round2(Math.max(0, row.revenue_amount - jlrTotal)) : row.revenue_amount,
    tier_revenue
  };
}
