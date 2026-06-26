/**
 * Paths retired from public search / live money-page KPIs (noindex or planned 301).
 * Historical booking_sheet_transactions.landing_page_url rows are not modified.
 */
export const RETIRED_MONEY_PATHS = new Set([
  '/photography-shop-services',
  '/photo-workshops-uk',
  '/photography-services-near-me',
  // Retired 2026-06-16, 301 -> /landscape-photography-workshops. Authoritative
  // registry: page_indexability_policy retired_redirect (see lib/canonical-slug.js).
  '/one-day-landscape-photography-workshops',
]);

function normalisePath(rawUrlOrPath) {
  try {
    const url = rawUrlOrPath.startsWith('http')
      ? new URL(rawUrlOrPath)
      : new URL(rawUrlOrPath, 'https://www.alanranger.com');
    let p = url.pathname.toLowerCase();
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p;
  } catch {
    return '/';
  }
}

/** @param {string} rawUrlOrPath */
export function isRetiredMoneyPath(rawUrlOrPath) {
  if (!rawUrlOrPath) return false;
  return RETIRED_MONEY_PATHS.has(normalisePath(rawUrlOrPath));
}
