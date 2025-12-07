/**
 * Page Segment Classifier
 * 
 * Classifies URLs into segments: education, money, support, system
 * 
 * NOTE: PageSegment classification is derived from the canonical site-urls CSV.
 * GSC page URLs are matched by path against this inventory and then classified by
 * classifyPageSegment(...) to keep behaviour/ranking segments aligned with the UI.
 */

export const PageSegment = {
  EDUCATION: 'education',
  MONEY: 'money',
  SUPPORT: 'support',
  SYSTEM: 'system'
};

/**
 * Normalize a URL or path to a consistent path format
 */
function normalisePath(rawUrlOrPath) {
  try {
    // Accept both full URLs and bare paths
    let url;
    if (rawUrlOrPath.startsWith('http')) {
      url = new URL(rawUrlOrPath);
    } else {
      url = new URL(rawUrlOrPath, 'https://www.alanranger.com');
    }
    let p = url.pathname.toLowerCase();
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p;
  } catch {
    return '/';
  }
}

/**
 * Main classifier function
 * 
 * @param {string} rawUrlOrPath - Full URL or path
 * @param {string|null} title - Optional page title
 * @param {string|null} kindOverride - Optional manual override from CSV
 * @returns {string} - One of: 'education', 'money', 'support', 'system'
 */
export function classifyPageSegment(rawUrlOrPath, title = null, kindOverride = null) {
  const path = normalisePath(rawUrlOrPath);

  // 0) Manual overrides via CSV column (if you decide to use it later)
  if (kindOverride) {
    const v = kindOverride.toLowerCase().trim();
    if (v === 'education' || v === 'educational') return PageSegment.EDUCATION;
    if (v === 'money' || v === 'commercial') return PageSegment.MONEY;
    if (v === 'support') return PageSegment.SUPPORT;
    if (v === 'system') return PageSegment.SYSTEM;
  }

  // 1) Education — all blogs + free course + calculator + tips hub
  if (path.startsWith('/blog-on-photography/')) return PageSegment.EDUCATION;
  if (
    path === '/blog-on-photography' ||
    path === '/free-online-photography-course' ||
    path === '/outdoor-photography-exposure-calculator' ||
    path === '/free-photography-tips' ||
    path === '/photography-news-blog'
  ) {
    return PageSegment.EDUCATION;
  }

  // 2) Money — explicit slugs first (hand-picked from 06-site-urls.csv)
  const MONEY_EXACT = new Set([
    // Workshop / lessons / course landing pages
    '/photography-workshops',
    '/photography-workshops-near-me',
    '/photography-workshops-uk',
    '/landscape-photography-workshops',
    '/outdoor-photography-workshops',
    '/photographic-workshops-near-me',
    '/photographic-workshops-uk',
    '/photography-courses-coventry',
    '/course-finder-photography-classes-near-me',
    '/photography-tuition-services',
    '/photography-services-near-me',
    '/photography-shop-services',
    '/rps-courses-mentoring-distinctions',
    // Key service / commercial pages
    '/hire-a-professional-photographer-in-coventry',
    '/professional-commercial-photographer-coventry',
    '/professional-photographer-near-me',
    '/coventry-photographer',
    '/photographer-in-coventry',
    '/photography-mentoring-programme',
    '/photography-academy-membership',
    '/photography-academy',
    '/photography-session-vouchers',
    '/photography-gift-vouchers',
    '/photography-presents-for-photographers',
    '/fine-art-prints',
    // Location-landing "money" pages you flagged
    '/batsford-arboretum-photography',
    '/bluebell-woods-near-me',
  ]);

  if (MONEY_EXACT.has(path)) return PageSegment.MONEY;

  // 2b) Money by keyword heuristics (non-blog URLs with clear commercial intent)
  const MONEY_KEYWORDS = [
    'workshop',
    'workshops',
    'lesson',
    'lessons',
    'course',
    'courses',
    'course-finder',
    'class',
    'classes',
    'training',
    'tuition',
    'mentoring',
    'academy',
    'gift-voucher',
    'gift-vouchers',
    'presents-for-photographers',
    'session-vouchers',
    'photography-services-near-me',
    'photography-services',
    'photography-shop',
    '1-2-1',
    'hire-a-professional-photographer',
    'prints',
    'fine-art-prints',
    'print-preparation-service',
    'special-offers',
  ];

  if (MONEY_KEYWORDS.some((k) => path.includes(k))) return PageSegment.MONEY;

  // 3) Support — important but not directly commercial
  const SUPPORT_EXACT = new Set([
    '/',
    '/about-alan-ranger',
    '/testimonials-customer-reviews',
    '/awards-and-qualifications',
    '/gallery-image-portfolios',
    '/help-site-map',
    '/help-portrait-uk-coventry',
    '/photography-equipment-recommendations',
    '/newsletter-signup-form',
    '/which-photography-style-is-right-for-you',
    '/contact-us',
  ]);
  if (SUPPORT_EXACT.has(path)) return PageSegment.SUPPORT;

  // 4) Everything else = system / other info (terms, privacy, old redirects, etc.)
  return PageSegment.SYSTEM;
}

