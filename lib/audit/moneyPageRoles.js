/**
 * Money Pages classification v2 (Stage 2, 2026-07-18).
 * Utility/legal excluded from Money tab; headline metrics = commercial landing only.
 */

const UTILITY_PATHS = new Set([
  '/academy/login',
  '/contact-us-alan-ranger-photography',
  '/copyright-policy-alan-ranger',
  '/data-privacy-policy',
  '/my-ethical-policy',
  '/photography-payment-plan',
  '/schedule-an-appointment',
  '/terms-and-conditions',
  '/website-cookie-policy',
  '/website-terms-and-conditions',
  '/course-finder-photography-classes-near-me'
]);

const CANNIBAL_PATHS = new Set([
  '/photography-tuition-services',
  '/photography-mentoring-online-assignments'
]);

const FUNNEL_PATHS = new Set([
  '/free-online-photography-course'
]);

function pathOnly(url) {
  if (!url) return '';
  try {
    const u = new URL(String(url), 'https://www.alanranger.com');
    let p = (u.pathname || '/').toLowerCase();
    if (p.length > 1) p = p.replace(/\/+$/, '');
    if (p === '/home') return '/';
    return p || '/';
  } catch {
    const s = String(url).toLowerCase().replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0] || '';
    let p = s.replace(/\/+$/, '') || '/';
    if (p === '/home') return '/';
    return p;
  }
}

function isUtilityMoneyPath(url) {
  return UTILITY_PATHS.has(pathOnly(url));
}

function isCannibalMoneyPath(url) {
  return CANNIBAL_PATHS.has(pathOnly(url));
}

function isFunnelMoneyPath(url) {
  return FUNNEL_PATHS.has(pathOnly(url));
}

/**
 * @returns {'commercial'|'cannibal'|'event_admin'|'product'|'utility'|'funnel'|null}
 */
function moneyRoleForUrl(url, segmentType) {
  if (isUtilityMoneyPath(url)) return 'utility';
  if (segmentType === 'event') return 'event_admin';
  if (segmentType === 'product') return 'product';
  if (isCannibalMoneyPath(url)) return 'cannibal';
  if (isFunnelMoneyPath(url)) return 'funnel';
  if (segmentType === 'landing') return 'commercial';
  return null;
}

function includeInMoneyHeadline(role) {
  return role === 'commercial';
}

function excludeFromImpactScale(role) {
  return role === 'funnel';
}

function showInMoneyTab(role) {
  return role && role !== 'utility';
}

export {
  UTILITY_PATHS,
  CANNIBAL_PATHS,
  FUNNEL_PATHS,
  pathOnly,
  isUtilityMoneyPath,
  isCannibalMoneyPath,
  isFunnelMoneyPath,
  moneyRoleForUrl,
  includeInMoneyHeadline,
  excludeFromImpactScale,
  showInMoneyTab
};
