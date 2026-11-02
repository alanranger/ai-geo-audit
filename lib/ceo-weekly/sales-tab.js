/**
 * Monday brief · Sales 2026 tab maths (batch 8 task 15d). Revenue counts in the month it was BOOKED
 * (booking_sheet_monthly_category = the tab's own grid). Targets are Alan's: category column J
 * (flat monthly), seasonal "Monthly Target" row, "Working Days" row, "Weighting" row.
 * Category YTD target = J × 12 × Σ weighting(Jan..this month) — the tab's own YTD basis.
 */
const COMBINE = [
  { label: 'Gift Vouchers (in − out)', orders: [8, 9] },
  { label: 'Pick n Mix (in − out)', orders: [4, 5] }
];
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

function categoryLine(rows, targets, orders, month, ytdWeight, label) {
  const mtd = orders.reduce((a, o) => a + sumMonths(rows, o, month, false), 0);
  const ytd = orders.reduce((a, o) => a + sumMonths(rows, o, month, true), 0);
  const monthly = orders.reduce((a, o) => a + Number(targets.category_targets?.[String(o)] || 0), 0);
  const ytdTarget = monthly * 12 * ytdWeight;
  const combined = orders.length > 1;
  return {
    label,
    mtd: round(mtd),
    target_month: combined ? null : round(monthly),
    ytd_var: round(ytd - ytdTarget),
    ytd_pct: combined || !ytdTarget ? null : Math.round(((ytd - ytdTarget) / ytdTarget) * 100)
  };
}

/** Pure: Sales-tab table + headline numbers from the tab rows. */
export function buildSalesTab({ targets, monthRows, gpRates, asOfYmd }) {
  if (!targets) return { available: false, reason: 'booking_sheet_sales_targets row missing — upload the Booking Sheet' };
  const month = Number(asOfYmd.slice(5, 7));
  const ytdWeight = (targets.weighting || []).slice(0, month).reduce((a, w) => a + Number(w || 0), 0);
  const labelOf = (o) => cleanLabel(targets.category_labels?.[String(o)] || `Category ${o}`);
  const categories = SINGLE_ORDER.map((o) => categoryLine(monthRows, targets, [o], month, ytdWeight, labelOf(o)))
    .concat(COMBINE.map((c) => categoryLine(monthRows, targets, c.orders, month, ytdWeight, c.label)));
  const mtd = categories.reduce((a, c) => a + c.mtd, 0);
  const ytdActual = monthRows.filter((r) => r.month <= month).reduce((a, r) => a + Number(r.revenue_amount || 0), 0);
  const annualMonthly = Object.values(targets.category_targets || {}).reduce((a, v) => a + Number(v || 0), 0);
  const ytdTarget = annualMonthly * 12 * ytdWeight;
  const gpYtd = monthRows.filter((r) => r.month <= month)
    .reduce((a, r) => a + Number(r.revenue_amount || 0) * Number(gpRates[r.category_order] ?? 0), 0);
  const daysInMonth = Number(targets.working_days?.[month - 1]) || 0;
  const elapsed = Math.min(daysInMonth, workingDaysElapsed(asOfYmd));
  const left = Math.max(0, daysInMonth - elapsed);
  const monthTarget = Number(targets.monthly_target?.[month - 1]) || 0;
  const weekTwo = inWorkingWeekTwo(asOfYmd);
  return {
    available: true,
    year: targets.year,
    month,
    month_target: round(monthTarget),
    working_days_month: daysInMonth,
    working_days_elapsed: elapsed,
    working_days_left: left,
    per_day_needed: left ? round((monthTarget - mtd) / left) : null,
    mtd: round(mtd),
    on_pace_visible: weekTwo,
    on_pace_for: weekTwo && elapsed ? round((mtd / elapsed) * daysInMonth) : null,
    ytd_actual: round(ytdActual),
    ytd_target: round(ytdTarget),
    ytd_var: round(ytdActual - ytdTarget),
    ytd_pct: ytdTarget ? Math.round(((ytdActual - ytdTarget) / ytdTarget) * 100) : null,
    gp_ytd: round(gpYtd),
    gp_pct: ytdActual ? Math.round((gpYtd / ytdActual) * 100) : null,
    categories,
    source: `booking_sheet_sales_targets ${targets.year} (${targets.source_workbook || 'Sales tab'}, imported ${targets.imported_at || '—'})`
  };
}

export async function loadSalesTab(supabase, propertyUrl, asOfYmd) {
  const year = Number(asOfYmd.slice(0, 4));
  const [t, rows, gp] = await Promise.all([
    supabase.from('booking_sheet_sales_targets').select('*').eq('property_url', propertyUrl).eq('year', year).maybeSingle(),
    supabase.from('booking_sheet_monthly_category').select('month, category_order, revenue_amount')
      .eq('property_url', propertyUrl).eq('year', year).limit(500),
    supabase.from('booking_sheet_category_gp').select('category_order, gp_rate').eq('property_url', propertyUrl).eq('year', year)
  ]);
  for (const r of [t, rows, gp]) if (r.error) throw new Error(`sales_tab:${r.error.message}`);
  const gpRates = Object.fromEntries((gp.data || []).map((r) => [r.category_order, Number(r.gp_rate)]));
  return buildSalesTab({ targets: t.data, monthRows: rows.data || [], gpRates, asOfYmd });
}
