/**
 * Per-month Booking Sheet sale counts for the Revenue Funnel.
 *
 * booking_sheet_monthly_wide carries revenue but hardcodes NULL for the
 * transaction count, which left every sale-rate KPI reading 0.00% next to a
 * populated revenue figure. Counts come from the booking_sheet_monthly_txn_counts
 * view instead; these helpers map them onto the shaped monthly revenue rows.
 *
 * The JLR toggle picks the slice: transactions_nonjlr when JLR is excluded
 * (the funnel default), transactions_all when it is included — matching how
 * revenue is already filtered so counts and revenue reconcile.
 */

/** 'YYYY-MM' key from an ISO date or a {year, month} pair. */
export function monthKey(value) {
  if (value && typeof value === 'object') {
    const y = Number(value.year);
    const m = Number(value.month);
    if (!y || !m) return null;
    return `${y}-${String(m).padStart(2, '0')}`;
  }
  const iso = String(value || '');
  return iso.length >= 7 ? iso.slice(0, 7) : null;
}

/**
 * The GSC/GA4 columns the sale-rate KPIs divide by are 28-day rollups ending at
 * the page-metrics date. Sales must be counted over that same window or the
 * ratio compares one month's sales against a different 28 days of traffic.
 */
export function txnWindowFor(dateEndIso, days = 28) {
  if (!dateEndIso) return null;
  const end = new Date(`${dateEndIso}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return null;
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  return { start: start.toISOString().slice(0, 10), end: dateEndIso };
}

/** Rows from booking_sheet_monthly_txn_counts -> Map keyed 'YYYY-MM'. */
export function buildTxnCountMap(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = monthKey(row.period_start) || monthKey(row);
    if (!key) continue;
    map.set(key, {
      all: Number(row.transactions_all) || 0,
      nonjlr: Number(row.transactions_nonjlr) || 0,
      jlr: Number(row.transactions_jlr) || 0,
      redemptions_excluded: Number(row.redemptions_excluded) || 0
    });
  }
  return map;
}

/**
 * Attach the real sale count to one shaped monthly row. Leaves `transactions`
 * null when the month has no Booking Sheet rows at all, so "no data" stays
 * visually distinct from a genuine zero-sales month.
 */
export function applyTxnCount(row, countMap, includeJlr) {
  if (!row) return row;
  const entry = countMap?.get(monthKey(row.period_start));
  if (!entry) return { ...row, transactions: null };
  return {
    ...row,
    transactions: includeJlr ? entry.all : entry.nonjlr,
    transactions_all: entry.all,
    transactions_nonjlr: entry.nonjlr,
    transactions_jlr: entry.jlr,
    transactions_redemptions_excluded: entry.redemptions_excluded
  };
}
