/**
 * Monday brief · Sales 2026 tab maths (batch 8 task 15d). Revenue counts in the month it was BOOKED
 * (booking_sheet_monthly_category = the tab's own grid). Targets: the Targets panel's survival GP as revenue,
 * spread with the Booking Sheet's category mix (column J), "Weighting" row and "Working Days" row.
 * Category YTD target = J × 12 × Σ weighting(Jan..this month) — the tab's own YTD basis.
 */
import { loadTargetsMaster } from '../targets-master.mjs';
/**
 * Alan's sheet: "Inc" = cash received when a voucher / plan is bought (a sale, with its own target);
 * "Out" = a bookkeeping transfer when the credit is used — the event category then shows the booking.
 * So each is shown as cash in against the Inc target, with the transfer as its own grey line beneath
 * (all lines together still add up to the sheet's totals, cash counted once).
 */
const CASH_IN_PAIRS = [
  { label: 'Gift Vouchers (cash in)', inc: 8, out: 9 },
  { label: 'Pick n Mix (cash in)', inc: 4, out: 5 }
];
const TRANSFER_LABEL = '− redeemed into event categories (bookkeeping transfer)';
const SINGLE_ORDER = [1, 2, 3, 7, 11, 12, 6, 10];

function cleanLabel(label) {
  return String(label || '').replace(/^\d{1,2}\.?\s+/, '').trim();
}

function round(n) {
  return Math.round(Number(n) || 0);
}

/** Mon–Fri days from the 1st up to and including asOfYmd. */
export function workingDaysElapsed(asOfYmd) {
  const [y, m, d] = asOfYmd.split('-').map(Number);
  let n = 0;
  for (let day = 1; day <= d; day += 1) {
    const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
    if (wd !== 0 && wd !== 6) n += 1;
  }
  return n;
}

/** Working week 2 has started once two different Mon–Sun weeks of the month contain working days. */
export function inWorkingWeekTwo(asOfYmd) {
  const [y, m, d] = asOfYmd.split('-').map(Number);
  const weeks = new Set();
  for (let day = 1; day <= d; day += 1) {
    const dt = new Date(Date.UTC(y, m - 1, day));
    const wd = dt.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    weeks.add(Math.floor((day - 1 + ((new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7)) / 7));
  }
  return weeks.size >= 2;
}

function sumMonths(rows, order, month, upTo) {
  return rows.filter((r) => r.category_order === order && (upTo ? r.month <= month : r.month === month))
    .reduce((a, r) => a + Number(r.revenue_amount || 0), 0);
}

/** This month's target = J × 12 × this month's weighting (same basis as the YTD target), so the column sums to the seasonal target. */
function categoryTargets(targets, order, month, ytdWeight) {
  const has = targets.category_targets?.[String(order)] != null;
  const monthly = Number(targets.category_targets?.[String(order)] || 0);
  return { has, monthly, ytd: monthly * 12 * ytdWeight, month: monthly * 12 * Number(targets.weighting?.[month - 1] || 0) };
}

function categoryLine(rows, targets, order, month, ytdWeight, label, { transfer = false } = {}) {
  const mtd = sumMonths(rows, order, month, false);
  const ytd = sumMonths(rows, order, month, true);
  const t = categoryTargets(targets, order, month, ytdWeight);
  const pct = transfer || !t.has || !t.ytd ? null : Math.round(((ytd - t.ytd) / t.ytd) * 100);
  return {
    raw: { target_month: t.has ? t.month : 0, ytd_var: ytd - t.ytd },
    label,
    order,
    transfer,
    mtd: round(mtd),
    ytd_actual: round(ytd),
    target_month: t.has ? round(t.month) : null,
    target_flat: t.has ? round(t.monthly) : null,
    ytd_var: round(ytd - t.ytd),
    ytd_pct: pct
  };
}

function cashInLines(rows, targets, month, ytdWeight) {
  return CASH_IN_PAIRS.flatMap((p) => [
    categoryLine(rows, targets, p.inc, month, ytdWeight, p.label),
    categoryLine(rows, targets, p.out, month, ytdWeight, TRANSFER_LABEL, { transfer: true })
  ]);
}

/**
 * Largest-remainder rounding: lines are rounded to whole pounds so the column adds up to the rounded total
 * (the lines closest to .5 take the odd pound). `raw` holds the unrounded values.
 */
export function apportion(categories, field, raw, total) {
  const floors = categories.map((c) => Math.floor(raw(c)));
  let left = Math.round(total) - floors.reduce((a, v) => a + v, 0);
  const order = categories.map((c, i) => ({ i, frac: raw(c) - floors[i] })).sort((a, b) => b.frac - a.frac);
  categories.forEach((c, i) => { c[field] = floors[i]; });
  for (const o of order) {
    if (left <= 0) break;
    categories[o.i][field] += 1;
    left -= 1;
  }
}

/** Month so far vs the tab's seasonal target and working days; "on pace" only from working week 2. */
function monthPace(targets, month, mtd, asOfYmd) {
  const daysInMonth = Number(targets.working_days?.[month - 1]) || 0;
  const elapsed = Math.min(daysInMonth, workingDaysElapsed(asOfYmd));
  const left = Math.max(0, daysInMonth - elapsed);
  const monthTarget = Number(targets.monthly_target?.[month - 1]) || 0;
  const weekTwo = inWorkingWeekTwo(asOfYmd);
  return {
    month_target: round(monthTarget),
    working_days_month: daysInMonth,
    working_days_elapsed: elapsed,
    working_days_left: left,
    per_day_needed: left ? round((monthTarget - mtd) / left) : null,
    mtd: round(mtd),
    on_pace_visible: weekTwo,
    on_pace_for: weekTwo && elapsed ? round((mtd / elapsed) * daysInMonth) : null
  };
}

/** Pure: Sales-tab table + headline numbers from the tab rows. */
export function buildSalesTab({ targets, monthRows, gpRates, asOfYmd }) {
  if (!targets) return { available: false, reason: 'booking_sheet_sales_targets row missing — upload the Booking Sheet' };
  const month = Number(asOfYmd.slice(5, 7));
  const ytdWeight = (targets.weighting || []).slice(0, month).reduce((a, w) => a + Number(w || 0), 0);
  const labelOf = (o) => cleanLabel(targets.category_labels?.[String(o)] || `Category ${o}`);
  const categories = SINGLE_ORDER.map((o) => categoryLine(monthRows, targets, o, month, ytdWeight, labelOf(o)))
    .concat(cashInLines(monthRows, targets, month, ytdWeight));
  const mtd = categories.reduce((a, c) => a + c.mtd, 0);
  const ytdActual = monthRows.filter((r) => r.month <= month).reduce((a, r) => a + Number(r.revenue_amount || 0), 0);
  const annualMonthly = Object.values(targets.category_targets || {}).reduce((a, v) => a + Number(v || 0), 0);
  const ytdTarget = annualMonthly * 12 * ytdWeight;
  apportion(categories, 'target_month', (c) => c.raw.target_month, Number(targets.monthly_target?.[month - 1]) || 0);
  // Alan's rule: totals add up — YTD var lines add exactly to the Total (J49); a line may move by £1.
  apportion(categories, 'ytd_var', (c) => c.raw.ytd_var, ytdActual - ytdTarget);
  for (const c of categories) delete c.raw;
  const gpYtd = monthRows.filter((r) => r.month <= month)
    .reduce((a, r) => a + Number(r.revenue_amount || 0) * Number(gpRates[r.category_order] ?? 0), 0);
  return {
    available: true,
    year: targets.year,
    month,
    ...monthPace(targets, month, mtd, asOfYmd),
    ytd_actual: round(ytdActual),
    ytd_target: round(ytdTarget),
    ytd_var: round(ytdActual - ytdTarget),
    ytd_pct: ytdTarget ? Math.round(((ytdActual - ytdTarget) / ytdTarget) * 100) : null,
    gp_ytd: round(gpYtd),
    gp_pct: ytdActual ? Math.round((gpYtd / ytdActual) * 100) : null,
    categories,
    reconcile: {
      sheet_ytd_actual: targets.ytd_actual ?? null,
      sheet_ytd_var: targets.ytd_var ?? null,
      lines_ytd_actual: round(categories.reduce((a, c) => a + c.ytd_actual, 0)),
      lines_ytd_var: round(categories.reduce((a, c) => a + c.ytd_var, 0)),
      lines_month_target: categories.reduce((a, c) => a + (c.target_month || 0), 0)
    },
    source: `booking_sheet_sales_targets ${targets.year} (${targets.source_workbook || 'Sales tab'}, imported ${targets.imported_at || '—'})`
  };
}

/**
 * The Booking Sheet row gives the pattern only (category mix + monthly weighting); its £ are rescaled so the tab's
 * total adds up to the revenue the Targets panel's survival GP needs (same figure as every tab).
 */
export function panelScaledTargets(sheet, master) {
  if (!sheet || !master) return sheet;
  const cats = sheet.category_targets || {};
  const sheetFlat = Object.values(cats).reduce((a, v) => a + Number(v || 0), 0);
  if (sheetFlat <= 0) return sheet;
  const k = master.revenue_equivalent.survival_annual / (12 * sheetFlat);
  const scaled = Object.fromEntries(Object.entries(cats).map(([o, v]) => [o, Number(v || 0) * k]));
  return {
    ...sheet,
    category_targets: scaled,
    monthly_target: master.revenue_equivalent.survival_monthly,
    source_workbook: `Targets panel survival GP → revenue at target mix; ${sheet.source_workbook || 'Sales tab'} pattern only`
  };
}

export async function loadSalesTab(supabase, propertyUrl, asOfYmd) {
  const year = Number(asOfYmd.slice(0, 4));
  const [t, rows, gp, master] = await Promise.all([
    supabase.from('booking_sheet_sales_targets').select('*').eq('property_url', propertyUrl).eq('year', year).maybeSingle(),
    supabase.from('booking_sheet_monthly_category').select('month, category_order, revenue_amount')
      .eq('property_url', propertyUrl).eq('year', year).limit(500),
    supabase.from('booking_sheet_category_gp').select('category_order, gp_rate').eq('property_url', propertyUrl).eq('year', year),
    loadTargetsMaster(supabase, propertyUrl, new Date(`${asOfYmd}T12:00:00Z`))
  ]);
  for (const r of [t, rows, gp]) if (r.error) throw new Error(`sales_tab:${r.error.message}`);
  const gpRates = Object.fromEntries((gp.data || []).map((r) => [r.category_order, Number(r.gp_rate)]));
  return buildSalesTab({ targets: panelScaledTargets(t.data, master), monthRows: rows.data || [], gpRates, asOfYmd });
}
