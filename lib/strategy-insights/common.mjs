/** Shared helpers for the Strategy & Actions "Where we stand and why" tiles. All money is Booking Sheet sales £ by booking date. */
export const SERVICES = [
  ['Residentials', 3], ['Day workshops', 2], ['1-2-1', 7], ['Commissions', 11], ['Courses', 1], ['Academy', 12],
  ['Gift vouchers sold', 8], ['Pick n Mix', 4], ['Mentoring', 6], ['Prints & royalties', 10]
];
/** Not tied to a dated event: 1-2-1, commissions, gift vouchers, Academy, mentoring, Pick n Mix, prints & royalties. */
export const NON_DATED = [7, 11, 8, 12, 6, 4, 10];
/** Booking Sheet redemption lines (negative): Pick n Mix out, gift vouchers out. Netted exactly as the sheet does. */
export const REDEMPTIONS = [5, 9];

export const round = (n) => Math.round(Number(n) || 0);
export const pct = (a, b) => (b ? ((a - b) / Math.abs(b)) * 100 : null);
export const ymd = (d) => d.toISOString().slice(0, 10);
export const monthKey = (iso) => String(iso).slice(0, 7);
export const addMonths = (y, m, n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; };
export const monthEnd = (y, m) => ymd(new Date(Date.UTC(y, m, 0)));
export const sameDayLastYear = (iso) => `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`;

const sign = (n) => (n < 0 ? '−' : '');
export const gbpK = (n) => (Math.abs(n) >= 1000 ? `${sign(n)}£${(Math.round(Math.abs(n) / 100) / 10).toLocaleString('en-GB')}k` : `${sign(n)}£${Math.abs(round(n)).toLocaleString('en-GB')}`);
export const gbp = (n) => `${sign(n)}£${Math.abs(round(n)).toLocaleString('en-GB')}`;
export const signPct = (p) => (p == null ? '—' : `${p >= 0 ? '+' : ''}${Math.round(p)}%`);

/** Red only when behind: below 90% of the comparison → red, 90–100% → amber, at or above → green. */
export function ragFor(actual, target) {
  if (actual == null || target == null || !Number.isFinite(actual) || !Number.isFinite(target)) return 'grey';
  if (actual >= target) return 'green';
  return actual >= target * 0.9 ? 'amber' : 'red';
}
export const ragDelta = (p) => (p == null ? 'grey' : (p >= 0 ? 'green' : (p > -10 ? 'amber' : 'red')));

/** GP rate for a transaction's year + category (the dashboard's per-category method). */
export function rateLookup(gpRates) {
  const map = new Map(gpRates.map((r) => [`${r.year}|${r.category_order}`, Number(r.gp_rate)]));
  const latestYear = Math.max(...gpRates.map((r) => r.year));
  return (year, cat) => map.get(`${year}|${cat}`) ?? map.get(`${latestYear}|${cat}`) ?? 0;
}

export function sumTx(txns, from, to, cats) {
  let s = 0;
  for (const t of txns) {
    const d = String(t.txn_date || '');
    if (d < from || d > to || (cats && !cats.includes(Number(t.category_order)))) continue;
    s += Number(t.amount) || 0;
  }
  return s;
}

export function gpTx(txns, from, to, rate, cats) {
  let s = 0;
  for (const t of txns) {
    const d = String(t.txn_date || '');
    if (d < from || d > to || (cats && !cats.includes(Number(t.category_order)))) continue;
    s += (Number(t.amount) || 0) * rate(Number(d.slice(0, 4)), Number(t.category_order));
  }
  return s;
}

export const cell = (v, rag = null, extra = {}) => ({ v, rag, ...extra });
