/** Path prefixes for commercial money pages (aligned with revenue-funnel-summary tiers). */
export const MONEY_PAGE_PREFIXES = [
  '/photography-courses',
  '/beginners-photography-class',
  '/beginners-photography-course',
  '/photography-classes',
  '/photography-lessons',
  '/photography-workshops',
  '/landscape-photography-workshops',
  '/2-5hr-workshops',
  '/2.5hr-4hr-workshops',
  '/one-day-workshops',
  '/workshops-calendar',
  '/photography-workshops-near-me',
  '/residential-workshops',
  '/photography-tuition-services',
  '/photography-services',
  '/1-2-1-photography-tuition',
  '/1-2-1-private-photography-tuition',
  '/photography-lessons-online-1-2-1',
  '/private-photography-lessons',
  '/mentoring',
  '/rps-mentoring',
  '/gift-vouchers',
  '/pick-n-mix',
  '/hire-a-professional-photographer',
  '/products-services-property-photography',
  '/property-photographer-coventry',
  '/professional-commercial-photographer-coventry',
  '/portrait-photography',
  '/staff-training-on-photography',
  '/commercial-photography',
  '/headshots',
  '/free-photography-course',
  '/academy',
  '/free-online-photography-course',
  '/online-photography-course'
];

export function normalizePagePath(raw) {
  if (!raw) return '';
  let p = String(raw).trim().split('?')[0].split('#')[0];
  if (!p.startsWith('/')) p = `/${p}`;
  return p.toLowerCase().replace(/\/+$/, '') || '/';
}

export function isMoneyPagePath(rawPath) {
  const p = normalizePagePath(rawPath);
  if (!p || p === '/') return false;
  return MONEY_PAGE_PREFIXES.some((pref) => p.startsWith(pref));
}
