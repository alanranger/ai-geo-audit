/** Seasonal monthly TOTAL targets from Booking Sheet 2026 (Year 14).
 * Index 0 = January … 11 = December. Annual total = £58,556.
 */
export const SEASONAL_MONTHLY_TARGETS_2026 = [
  4404, 3553, 2342, 4821, 5640, 6070, 4569, 3474, 5447, 7110, 5850, 5276
];

export const ANNUAL_REVENUE_TARGET_2026 = SEASONAL_MONTHLY_TARGETS_2026.reduce((a, b) => a + b, 0);

/** @param {number} month 1–12 */
export function bookingSheetMonthTarget(month) {
  const idx = Number(month) - 1;
  if (idx < 0 || idx > 11) return 0;
  return SEASONAL_MONTHLY_TARGETS_2026[idx] || 0;
}

/** RAG vs that month's Booking Sheet target (matches sheet Target % colours). */
export function classifyVsMonthTarget(actual, target) {
  const t = Number(target) || 0;
  if (t <= 0) return 'below_survival';
  const pct = (Number(actual) || 0) / t;
  if (pct >= 1) return 'thrive';
  if (pct >= 0.85) return 'comfortable';
  if (pct >= 0.5) return 'survival';
  return 'below_survival';
}
