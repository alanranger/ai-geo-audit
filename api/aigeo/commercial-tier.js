// commercial-tier.js
//
// Classifies a product or page into one of the commercial tiers the
// business actually sells.
//
// PRIMARY CLASSIFIER (preferred):
//   lib/product-tier-map.js builds a deterministic productUrl-slug ->
//   tier map from `csv_metadata` (workshop_products + course_products)
//   plus a manual `product_tier_override` table. Long-running serverless
//   handlers call setProductTierMap() once after they create their
//   Supabase client; classifyCommercialTier() consults that map first
//   (by URL slug, then by canonical title prefix) for an authoritative
//   answer that doesn't require code edits when a new product is added.
//
// LEGACY FALLBACK (this file):
//   The name/url-token rules below still run when no map is set OR when
//   the product doesn't exist in csv_metadata yet (e.g. an Acuity
//   description that says "Photography Training - 2hr"). The final
//   fallback is the `unidentified` tier so the dashboard surfaces
//   anything that escaped both passes.
//
// ----------------------------------------------------------------------
// Tiers the business sells:
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

import { classifyByMap } from '../../lib/product-tier-map.js';

// ----------------------------------------------------------------------
// Product-tier map (set by sync endpoints before classifying)
// ----------------------------------------------------------------------
let PRODUCT_TIER_MAP = null;

// Inject the deterministic productUrl-slug -> tier map built from
// csv_metadata + product_tier_override. Pass null to clear (tests).
export function setProductTierMap(map) {
  PRODUCT_TIER_MAP = map || null;
}

// ----------------------------------------------------------------------
// Tier definitions
// ----------------------------------------------------------------------

export const COMMERCIAL_TIERS = [
  { id: 'workshops_residential', label: 'Workshops (Residential)' },
  { id: 'workshops_nonres',      label: 'Workshops (Non-Res)' },
  { id: 'courses',               label: 'Courses' },
  { id: 'services',              label: '1-2-1 & Services' },
  { id: 'hire',                  label: 'Hire (Commercial)' },
  { id: 'academy',               label: 'Academy' },
  // Safety-net bucket: anything the classifier can't confidently assign
  // lands here so it's visible on the dashboard for review (replaces the
  // old silent 'other' fallback). When a new product type starts landing
  // here we add a name/url token to the rules above.
  { id: 'unidentified',          label: 'Unidentified (needs review)' }
];

// Residential workshop URL slugs (canonical list, sourced from
// csv_metadata.categories containing "- weekend residential photo workshops").
// Order doesn't matter; matches use endsWith on path so any host works.
// To refresh: run probe-booking-sheet / query csv_metadata in ai-chat Supabase.
const WORKSHOP_RESIDENTIAL_PATHS = new Set([
  '/photo-workshops-uk/coastal-northumberland-photography-workshops',
  '/photo-workshops-uk/dartmoor-photography-landscape-workshop',
  '/photo-workshops-uk/dorset-landscape-photography-workshop',
  '/photo-workshops-uk/exmoor-photography-workshops-lynmouth',
  '/photo-workshops-uk/ireland-photography-workshops-dingle',
  '/photo-workshops-uk/lake-district-photography-workshop',
  '/photo-workshops-uk/landscape-photography-devon-hartland-quay',
  '/photo-workshops-uk/landscape-photography-wales-photo-workshop',
  '/photo-workshops-uk/landscape-photography-workshop-norfolk',
  '/photo-workshops-uk/landscape-photography-workshops-anglesey',
  '/photo-workshops-uk/landscape-photography-workshops-glencoe',
  '/photo-workshops-uk/landscape-photography-snowdonia-workshops',
  '/photo-workshops-uk/north-yorkshire-landscape-photography',
  '/photo-workshops-uk/somerset-landscape-photography-workshops',
  '/photo-workshops-uk/suffolk-landscape-photography-workshops',
  '/photo-workshops-uk/wales-photography-workshop-pistyll-rhaeadr',
  '/photo-workshops-uk/yorkshire-dales-photography-workshops'
]);

// Title-token fallbacks: if the URL is missing or generic (e.g. an Acuity
// charge referencing only the product name), we can still detect a
// residential workshop from these phrases in the product name.
//
// IMPORTANT: this list is ALSO spread into the workshops main rule
// (see RULES below), so a product called e.g. "Landscape Photography
// SNOWDONIA - Sat 26 - Sun 27 Sep 2026" - which does NOT contain the
// word "workshop" - still triggers the workshops rule via "snowdonia".
const WORKSHOP_RESIDENTIAL_NAME_TOKENS = [
  'residential', 'weekend retreat', 'photography retreat',
  'hartland quay', 'lake district', 'snowdonia', 'yorkshire dales',
  'anglesey', 'northumberland', 'glencoe', 'suffolk', 'norfolk',
  'dartmoor', 'dorset', 'gower', 'exmoor', 'kerry', 'dingle',
  'lake vyrnwy',
  // 'devon' covers the "Landscape Photography DEVON Workshops - Various
  // Dates" catch-all SQ product, which is the umbrella listing for
  // Hartland Quay / Exmoor / Lynmouth weekend trips. Confirmed
  // residential by Alan via spreadsheet row-by-row.
  'devon'
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

  // Hire / Commercial: physical prints + hire/headshots/property/commercial
  // + bespoke services (commissions invoiced manually via Squarespace SERVICE
  // products or Acuity bookings). Almost every commercial gig is a Service
  // product or Acuity booking with a free-text name, so the nameTokens
  // below are tuned to recognise those patterns.
  //
  // NB: keep nameTokens unambiguous - "portrait photography" alone is too
  // wide because it also matches "Beginners Portrait Photography Course".
  // Always prefer multi-word tokens or distinctive nouns.
  { id: 'hire',
    nameTokens: [
      // physical prints
      'fine art print', 'canvas wrap', 'framed print', 'framed fine art',
      'unframed print', 'a3 mounted', 'mounted print', 'mounted fine art',
      // headshots / portrait shoots
      'headshot session', 'headshot photography', 'portrait shoot',
      'portrait session', 'portraits - 1 hr', 'portraits - 2 hr',
      'taking photos',
      // commercial / product / property shoots
      'commercial shoot', 'product photography shoot',
      'property photography shoot', 'commercial photography',
      // bespoke services sold as Squarespace SERVICE products
      'photo editing', 'image editing', 'image retouching',
      'sculpture photo', 'sclupture photo', 'author photo',
      'photo shoot', 'photography consultation', 'photography training',
      'staff training', 'staff - photography', 'staff photography',
      'pwa training',
      // commission / venue-specific catch-alls
      'commission', 'commissioned',
      'biggin hall', 'enquiry and fact finding'
    ],
    urlTokens: ['/hire-a-professional', '/portrait-photography', '/property-photography', '/commercial-photography', '/headshots', '/professional-commercial-photographer', '/product-photographer', '/property-photographer', '/fine-art-prints', '/corporate-photography-training', '/staff-training-on-photography'] },

  // Services: subscriptions, 1-2-1 / private, mentoring, vouchers,
  // sensor clean, print prep
  { id: 'services',
    nameTokens: ['pick n mix', 'pickn mix', 'subscription', '1-2-1', '121', 'private', 'mentoring', 'gift voucher', 'sensor clean', 'print preparation', 'monthly online', 'quarterly', 'annual pick', 'four private'],
    urlTokens: ['/photography-tuition-services', '/pick-n-mix', '/gift-vouchers', '/mentoring', '/rps-mentoring', '/1-2-1', '/private-photography', '/photography-lessons-online-121', '/monthly-online-photography-mentoring', '/annual-pick-n-mix', '/quarterly-pick-n-mix', '/four-private-photography-classes'] },

  // Workshops: title says "workshop" / "photo walk" OR contains a known
  // residential location name (so a SERVICE product titled e.g.
  // "Landscape Photography SNOWDONIA - Sat 26 - Sun 27 Sep 2026", with no
  // /photo-workshops-uk/* URL and no "workshop" token in the title, still
  // reaches the workshops tier). workshopSubTier() then splits res vs
  // non-res using the same location list.
  { id: 'workshops',
    nameTokens: ['workshop', 'photo walk', 'photo-walk', ...WORKSHOP_RESIDENTIAL_NAME_TOKENS],
    urlTokens: ['/photo-workshops-uk', '/photography-workshops', '/landscape-photography-workshops', '/one-day-landscape-photography-workshops', '/photographic-workshops-near-me'] },

  // Courses: in-person and online classes / lightroom / masterclass /
  // beginners course / portrait course.
  //
  // NB: nameToken 'photo editing' was tightened to 'photo editing course'
  // so it no longer collides with the bespoke commercial "Photo Editing"
  // service product (which belongs in Hire).
  { id: 'courses',
    nameTokens: ['course', 'class', 'lightroom', 'masterclass', 'photo editing course', 'black and white', 'photography lessons', 'three weekly evening'],
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

// Workshops sub-classifier. Called only when the main classifier has
// already decided "this is a workshop". Decides between Residential
// (multi-day, hotel included, ~£600-£1,500 per booking) and
// Non-Residential (half-day or one-day, ~£35-£200 per booking).
function workshopSubTier(path, name) {
  // 1) Authoritative: exact path match against the residential catalog.
  if (path && WORKSHOP_RESIDENTIAL_PATHS.has(path)) return 'workshops_residential';
  // 2) Fallback: name contains a residential location or the word itself.
  if (nameHasAnyToken(name, WORKSHOP_RESIDENTIAL_NAME_TOKENS)) return 'workshops_residential';
  return 'workshops_nonres';
}

// Main classifier. Returns one of:
//   'workshops_residential' | 'workshops_nonres' | 'courses' |
//   'services' | 'hire' | 'academy' | 'unidentified'
//
// The fallback used to be 'other' (silent). It's now 'unidentified' so
// the dashboard can show it on a dedicated tile and we notice when new
// product types start landing in the catch-all.
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
  if (PRODUCT_TIER_MAP) {
    const mapped = classifyByMap(PRODUCT_TIER_MAP, productUrl, productName);
    if (mapped) return mapped;
  }
  const path = pathOf(productUrl);
  const name = String(productName || '');
  for (const rule of RULES) {
    if (ruleMatches(rule, path, name)) {
      if (rule.id === 'workshops') return workshopSubTier(path, name);
      return rule.id;
    }
  }
  return 'unidentified';
}

// Empty per-tier accumulator. Use as `{ ...emptyTierAccumulator() }` so
// each call returns a fresh object.
export function emptyTierAccumulator() {
  const acc = {};
  for (const id of COMMERCIAL_TIER_IDS) acc[id] = 0;
  return acc;
}
