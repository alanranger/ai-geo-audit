/** JLR exclusion helpers for Revenue Truth summary payload shaping. */

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
