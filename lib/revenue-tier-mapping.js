// Revenue tier mapping (Phase C / C2 part 3 -- tier rollup restructure)

//

// Maps the user's TEN sellable revenue tiers across three sources:

//   1. booking_sheet_transactions.category_label (verbatim Booking-Sheet

//      accounting category strings, with Inc/Out netting for voucher tiers)

//   2. canonical_products.category (per-product taxonomy)

//   3. Commercial Academy page slugs only (not every /academy/* sub-page)

//

// EXCLUDED from tier headers (not in the 10-tier rollup sum):

//   - canonical_products category: adjustment (voucher plumbing only)

//

// Booking-sheet lines folded into sellable tiers for penny reconciliation:

//   - '5. Pick n Mix Out'  -> pick_n_mix_inc (net with Inc)

//   - '9. Gift Vouchers Out' -> gift_vouchers_inc (net with Inc)

//   - '12. Other' -> commissions (miscellaneous; 2024-only in practice)



export const TIER_ORDER = [

  'courses_masterclasses',

  'workshops_non_residential',

  'workshops_residential',

  'pick_n_mix_inc',

  'one_to_one_lessons',

  'gift_vouchers_inc',

  'prints_royalties',

  'commissions',

  'academy',

  'mentoring'

];



// Penny-exact from booking_sheet_transactions (non-JLR). Rounded headlines: £42,791 / £27,027 / £19,233.
export const BOOKING_SHEET_NON_JLR_TARGETS = {
  y2024: 42790.79,
  y2025: 27027.46,
  y2026_ytd: 19233.04
};



// One row per sellable tier with display label, the Booking-Sheet category

// label that funds it (primary Inc line), and canonical_products categories.

export const TIER_DEFINITIONS = {

  courses_masterclasses: {

    label: 'Courses / Masterclasses',

    bookingCategory: '1. Courses/masterclasses',

    productCategories: ['course', 'course (Lightroom)']

  },

  workshops_non_residential: {

    label: 'Workshops Non Residential',

    bookingCategory: '2. Workshops Non Residential',

    productCategories: ['workshop', 'workshop (half-day)', 'workshop (1-day)']

  },

  workshops_residential: {

    label: 'Workshops Residential',

    bookingCategory: '3. Workshops Residential',

    productCategories: ['workshop (residential)']

  },

  pick_n_mix_inc: {

    label: 'Pick n Mix Inc',

    bookingCategory: '4. Pick n Mix Inc',

    productCategories: ['digital download', 'subscription/payment-plan']

  },

  one_to_one_lessons: {

    label: '1-2-1 Lessons',

    bookingCategory: '7. 1-2-1',

    productCategories: ['1-2-1']

  },

  gift_vouchers_inc: {

    label: 'Gift Vouchers Inc',

    bookingCategory: '8. Gift Vouchers Inc',

    productCategories: ['gift voucher']

  },

  prints_royalties: {

    label: 'Prints & Royalties',

    bookingCategory: '10. Prints & Royalties',

    productCategories: ['print', 'royalty', 'merchandise']

  },

  commissions: {

    label: 'Commissions',

    bookingCategory: '11 Commissions',

    productCategories: ['commission', 'service']

  },

  academy: {

    label: 'Academy',

    bookingCategory: '12. Academy',

    productCategories: ['academy']

  },

  mentoring: {

    label: 'Mentoring',

    bookingCategory: '6. Mentoring',

    productCategories: ['mentoring']

  }

};



// Booking-sheet labels routed into a sellable tier (not shown as separate headers).

export const BOOKING_CATEGORY_ALIASES = {

  '5. Pick n Mix Out': 'pick_n_mix_inc',

  '9. Gift Vouchers Out': 'gift_vouchers_inc',

  '12. Other': 'commissions'

};



export const EXCLUDED_BOOKING_CATEGORIES = new Set();



export const EXCLUDED_PRODUCT_CATEGORIES = new Set(['adjustment']);



// Commercial Academy surfaces only (membership / signup / payment plan).

// Do NOT include academy/login, /s/* assets, checklists, ebooks, etc.

export const ACADEMY_COMMERCIAL_SLUGS = new Set([

  'free-online-photography-course',

  'photography-payment-plan',

  'academy/online-photography-course'

]);



const PRODUCT_CATEGORY_TO_TIER = (() => {

  const m = new Map();

  for (const [tierKey, def] of Object.entries(TIER_DEFINITIONS)) {

    for (const cat of def.productCategories) m.set(cat, tierKey);

  }

  return m;

})();



const BOOKING_CATEGORY_TO_TIER = (() => {

  const m = new Map();

  for (const [tierKey, def] of Object.entries(TIER_DEFINITIONS)) {

    m.set(def.bookingCategory, tierKey);

  }

  for (const [label, tierKey] of Object.entries(BOOKING_CATEGORY_ALIASES)) {

    m.set(label, tierKey);

  }

  return m;

})();



/** canonical_products.category -> tier_key (null = unmapped, '__excluded__' = adjustment) */

export function tierFromProductCategory(category) {

  const c = String(category || '').trim();

  if (!c) return null;

  if (EXCLUDED_PRODUCT_CATEGORIES.has(c)) return '__excluded__';

  return PRODUCT_CATEGORY_TO_TIER.get(c) || null;

}



/** booking_sheet_transactions.category_label -> tier_key (null = unmapped) */

export function tierFromBookingCategory(label) {

  const l = String(label || '').trim();

  if (!l || EXCLUDED_BOOKING_CATEGORIES.has(l)) return null;

  return BOOKING_CATEGORY_TO_TIER.get(l) || null;

}



export function normalizePageSlug(slug) {

  return String(slug || '').toLowerCase().replace(/^\/+/, '').replace(/\/+$/, '');

}



export function isAcademyCommercialSlug(slug) {

  return ACADEMY_COMMERCIAL_SLUGS.has(normalizePageSlug(slug));

}



/** Default page-type filter: A + B + commercial Academy (+ C if toggle). */

export function shouldKeepByPageTier(pageTier, includeEvent, pageSlug) {

  const t = String(pageTier || '').toLowerCase();

  if (t === 'landing' || t === 'product') return true;

  if (t === 'academy') return isAcademyCommercialSlug(pageSlug);

  if (t === 'event') return includeEvent === true;

  return false;

}



export function defaultTierKey() {

  return null;

}


