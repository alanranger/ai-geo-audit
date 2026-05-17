// commercial-tier.js
//
// Classifies a product or page into one of the 5 commercial tiers the
// business actually sells:
//
//   workshops  - photo-workshops-uk/* + photography-workshops*
//   courses    - in-person + online classes (Beginners, Lightroom, B&W, etc)
//   services   - 1-2-1, mentoring, subscriptions, gift vouchers, sensor clean
//   hire       - fine art prints, framed/canvas prints, commercial / hire
//   academy    - £79 annual membership + Foundation Digital + field checklists
//
// This is the COMMERCIAL tier (what the customer buys). It is orthogonal
// to the page tier in tier-segmentation.js (Landing / Product / Event /
// Blog / Academy / Unmapped), which describes WHICH SITE LAYER the URL
// lives on.
//
// Both classifiers can be called on the same URL — e.g.
// `/beginners-photography-lessons/camera-courses-for-beginners-coventry-2k99k`
// is page_tier=event, commercial_tier=courses.

// ----------------------------------------------------------------------
// Tier definitions
// ----------------------------------------------------------------------

export const COMMERCIAL_TIERS = [
  { id: 'workshops', label: 'Workshops' },
  { id: 'courses',   label: 'Courses' },
  { id: 'services',  label: '1-2-1 & Services' },
  { id: 'hire',      label: 'Hire / Commercial' },
  { id: 'academy',   label: 'Academy' }
];

export const COMMERCIAL_TIER_IDS = COMMERCIAL_TIERS.map(t => t.id);

export function tierLabel(id) {
  const t = COMMERCIAL_TIERS.find(x => x.id === id);
  return t ? t.label : 'Other';
}

// ----------------------------------------------------------------------
// Classification rules (most-specific first)
// ----------------------------------------------------------------------
// Each rule has: { id, urlRe?, nameRe? } - if EITHER matches, the tier
// wins. Order matters: tiers are tested in array order, so put
// most-specific signals first.

// Each rule's URL/name patterns are kept as plain lowercase substring lists.
// This trades a tiny bit of repetition for much cleaner classifier logic
// (and avoids the regex-complexity sonar warning).
const RULES = [
  // Academy first: catches Foundation Digital Pack, eBooks, field
  // checklists, pocket guides, the Premium Academy membership.
  { id: 'academy',
    nameTokens: ['foundation digital', 'field checklist', 'pocket guide', 'ebook', 'e-book', 'academy membership', 'academy subscription'],
    urlTokens: ['/free-photography-course', '/free-online-photography-course', '/academy'] },

  // Hire / Commercial: physical prints + hire/headshots/property/commercial.
  // NB: keep nameTokens unambiguous - "portrait photography" alone is too
  // wide because it also matches "Beginners Portrait Photography Course".
  // Rely on URL tokens + physical-only product nouns instead.
  { id: 'hire',
    nameTokens: ['fine art print', 'canvas wrap', 'framed print', 'framed fine art', 'unframed print', 'a3 mounted', 'mounted print', 'mounted fine art', 'headshot session', 'headshot photography', 'portrait shoot', 'portrait session', 'commercial shoot', 'product photography shoot', 'property photography shoot'],
    urlTokens: ['/hire-a-professional', '/portrait-photography', '/property-photography', '/commercial-photography', '/headshots', '/professional-commercial-photographer', '/product-photographer', '/property-photographer', '/fine-art-prints', '/corporate-photography-training'] },

  // Services: subscriptions, 1-2-1 / private, mentoring, vouchers,
  // sensor clean, print prep
  { id: 'services',
    nameTokens: ['pick n mix', 'pickn mix', 'subscription', '1-2-1', '121', 'private', 'mentoring', 'gift voucher', 'sensor clean', 'print preparation', 'monthly online', 'quarterly', 'annual pick', 'four private'],
    urlTokens: ['/photography-tuition-services', '/pick-n-mix', '/gift-vouchers', '/mentoring', '/rps-mentoring', '/1-2-1', '/private-photography', '/photography-lessons-online-121', '/monthly-online-photography-mentoring', '/annual-pick-n-mix', '/quarterly-pick-n-mix', '/four-private-photography-classes'] },

  // Workshops: title says "workshop" OR product page is /photo-workshops-uk/*
  { id: 'workshops',
    nameTokens: ['workshop', 'photo walk', 'photo-walk'],
    urlTokens: ['/photo-workshops-uk', '/photography-workshops', '/landscape-photography-workshops', '/one-day-landscape-photography-workshops', '/photographic-workshops-near-me'] },

  // Courses: in-person and online classes / lightroom / masterclass /
  // beginners course / portrait course
  { id: 'courses',
    nameTokens: ['course', 'class', 'lightroom', 'masterclass', 'photo editing', 'black and white', 'photography lessons', 'three weekly evening'],
    urlTokens: ['/photography-courses', '/beginners-photography-lessons', '/beginners-photography-classes', '/beginners-photography-course', '/photo-editing-course', '/beginners-portrait-photography-course', '/photography-classes', '/black-and-white-photography-course', '/lightroom-courses-for-beginners-coventry', '/intermediates-intentions', '/intermediates-lightroom', '/photography-masterclasses'] }
];

function urlMatchesService(path) {
  // services-near-me is shared by many products of other tiers, so we don't
  // want to use it as a positive signal for the services tier; require an
  // explicit services-only path.
  if (!path) return false;
  if (path.includes('/photography-services') && !path.includes('/photography-services-near-me')) return true;
  return false;
}

// ----------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------

// Normalise a URL down to its lowercase path.
function pathOf(url) {
  if (!url) return '';
  try {
    const u = new URL(url, 'https://x/');
    return (u.pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
  } catch {
    return String(url).toLowerCase();
  }
}

function pathHasAnyToken(path, tokens) {
  if (!path || !tokens) return false;
  for (const tok of tokens) {
    if (path.includes(tok)) return true;
  }
  return false;
}

function nameHasAnyToken(name, tokens) {
  if (!name || !tokens) return false;
  const lower = name.toLowerCase();
  for (const tok of tokens) {
    if (lower.includes(tok)) return true;
  }
  return false;
}

function ruleMatches(rule, path, name) {
  if (rule.id === 'services' && urlMatchesService(path)) return true;
  if (pathHasAnyToken(path, rule.urlTokens)) return true;
  if (nameHasAnyToken(name, rule.nameTokens)) return true;
  return false;
}

// Main classifier. Returns one of:
//   'workshops' | 'courses' | 'services' | 'hire' | 'academy' | 'other'
//
// Accepts either:
//   classifyCommercialTier({ productUrl, productName })
//   classifyCommercialTier(productUrl, productName)
//
// Either argument can be empty - one signal is enough.
export function classifyCommercialTier(arg1, arg2) {
  let productUrl = '';
  let productName = '';
  if (typeof arg1 === 'object' && arg1 !== null) {
    productUrl = arg1.productUrl || arg1.product_url || arg1.url || '';
    productName = arg1.productName || arg1.product_name || arg1.title || arg1.product_title || '';
  } else {
    productUrl = arg1 || '';
    productName = arg2 || '';
  }
  const path = pathOf(productUrl);
  const name = String(productName || '');
  for (const rule of RULES) {
    if (ruleMatches(rule, path, name)) return rule.id;
  }
  return 'other';
}

// Empty per-tier accumulator. Use as `{ ...emptyTierAccumulator() }` so
// each call returns a fresh object.
export function emptyTierAccumulator() {
  const acc = {};
  for (const id of COMMERCIAL_TIER_IDS) acc[id] = 0;
  acc.other = 0;
  return acc;
}
