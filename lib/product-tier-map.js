// lib/product-tier-map.js
//
// Build a deterministic productUrl-slug -> commercial-tier map from the AI
// Chat Supabase project (`csv_metadata` + manual `product_tier_override`),
// so the Revenue Funnel classifier no longer relies on hand-edited
// nameTokens for every Squarespace product.
//
// Usage (from api/aigeo/squarespace-revenue-sync.js etc.):
//
//   import { loadProductTierMap } from '../../lib/product-tier-map.js';
//   import { setProductTierMap }  from './commercial-tier.js';
//   setProductTierMap(await loadProductTierMap(supabase));
//
// Then classifyCommercialTier() in commercial-tier.js consults the map
// FIRST (by exact URL slug, then by canonical title prefix) and only
// falls back to the legacy name/url-token rules when no row is found.
//
// Cache: the loaded map is memoised in-process for 5 minutes so a single
// Vercel invocation that classifies thousands of line items only pays
// the Supabase round-trip once.
//
// Source tables (project: dqrtcsvqsfgbqmnonkpt / user-supabase-ai-chat)
// ----------------------------------------------------------------------
//   csv_metadata.csv_type='workshop_products'  (39 rows)
//     -> categories contains "- weekend residential photo workshops"
//        => workshops_residential, else workshops_nonres.
//   csv_metadata.csv_type='course_products'    (~30 buyable rows)
//     -> categories drive courses / services / hire / academy split.
//     -> some Academy products have categories=[]; matched by URL slug.
//   product_tier_override                      (manual overrides)
//     -> last write wins. Seeded with Snowdonia, which Squarespace has
//        only tagged as ["Landscape"].

const CACHE_MS = 5 * 60 * 1000;
let CACHED = null;
let CACHED_AT = 0;

// ----------------------------------------------------------------------
// URL + title canonicalisation
// ----------------------------------------------------------------------

function normaliseSlug(url) {
  if (!url) return '';
  try {
    const u = new URL(url, 'https://x/');
    return (u.pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
  } catch {
    return String(url).toLowerCase();
  }
}

// Trim everything after the first " - " / " | " separator and any trailing
// date-like junk, so "BLUEBELL WOODLANDS Photography - Warks - 20 Apr"
// collapses to a stable key shared by every dated variant.
function titlePrefix(title) {
  if (!title) return '';
  let s = String(title).toLowerCase().trim();
  for (const sep of [' - ', ' | ', ' \u2013 ', ' \u2014 ']) {
    const i = s.indexOf(sep);
    if (i > 0) s = s.slice(0, i);
  }
  return s.trim();
}

// ----------------------------------------------------------------------
// Per-row classification
// ----------------------------------------------------------------------

function tierFromWorkshopCategories(cats) {
  for (const c of cats) {
    if (c.includes('weekend residential')) return 'workshops_residential';
  }
  return 'workshops_nonres';
}

const COURSE_ACADEMY_SLUGS = [
  'premium-photography-academy-membership',
  'foundation-digital-pack-plus',
  'photography-foundation-course-ebook',
  'composition-viewing-frames'
];

function tierFromCourseUrlSpecialCase(url) {
  for (const slug of COURSE_ACADEMY_SLUGS) {
    if (url.endsWith(slug)) return 'academy';
  }
  if (url.includes('photography-field-checklists')) return 'academy';
  return null;
}

function isCourseCat(cats) {
  return cats.includes('photography-classes') || cats.includes('photography-courses');
}

function isTuitionCat(cats) {
  return cats.includes('1-2-1-private-lessons') ||
         cats.includes('photography-tuition') ||
         cats.includes('online');
}

function tierFromCourseCategories(cats) {
  // Gift vouchers FIRST: the Photography Gift Vouchers SQ product lists
  // every redeemable category (print, photography-classes, workshops, ...)
  // so without this short-circuit they look like prints/courses/workshops
  // depending on the category order. Per Alan, vouchers belong in Services.
  if (cats.includes('gift-voucher')) return 'services';
  if (cats.includes('print')) return 'hire';
  if (cats.includes('pocket-guide-series')) return 'academy';
  const course = isCourseCat(cats);
  const tuition = isTuitionCat(cats);
  if (course && tuition) return 'services';
  if (course) return 'courses';
  if (tuition) return 'services';
  if (cats.includes('photography-services')) return 'services';
  return null;
}

function classifyFromCsvRow(row) {
  if (!row?.title) return null;
  const cats = (row.categories || []).map(c => String(c).toLowerCase().trim());
  const url = String(row.url || '').toLowerCase();
  if (row.csv_type === 'workshop_products') return tierFromWorkshopCategories(cats);
  if (row.csv_type === 'course_products') {
    return tierFromCourseUrlSpecialCase(url) || tierFromCourseCategories(cats);
  }
  return null;
}

// ----------------------------------------------------------------------
// Supabase fetches (silent fallthrough on error)
// ----------------------------------------------------------------------

async function fetchCsvProducts(supabase) {
  const { data, error } = await supabase
    .from('csv_metadata')
    .select('csv_type, url, title, categories')
    .in('csv_type', ['workshop_products', 'course_products']);
  if (error) return [];
  return data || [];
}

async function fetchOverrides(supabase) {
  const { data, error } = await supabase
    .from('product_tier_override')
    .select('url_slug, tier_id');
  if (error) return [];
  return data || [];
}

function ingestCsvRow(maps, row) {
  const tier = classifyFromCsvRow(row);
  if (!tier) return;
  const slug = normaliseSlug(row.url);
  if (slug && slug !== '/') maps.slugToTier.set(slug, tier);
  const prefix = titlePrefix(row.title);
  if (prefix && prefix.length >= 6) {
    if (!maps.titleToTier.has(prefix)) maps.titleToTier.set(prefix, tier);
  }
}

function ingestOverride(maps, row) {
  if (!row?.url_slug || !row?.tier_id) return;
  maps.slugToTier.set(String(row.url_slug).toLowerCase(), row.tier_id);
}

export async function loadProductTierMap(supabase) {
  const now = Date.now();
  if (CACHED && now - CACHED_AT < CACHE_MS) return CACHED;
  const maps = { slugToTier: new Map(), titleToTier: new Map() };
  const products = await fetchCsvProducts(supabase);
  for (const row of products) ingestCsvRow(maps, row);
  const overrides = await fetchOverrides(supabase);
  for (const row of overrides) ingestOverride(maps, row);
  CACHED = maps;
  CACHED_AT = now;
  return CACHED;
}

// ----------------------------------------------------------------------
// Lookup (sync, called from classifyCommercialTier)
// ----------------------------------------------------------------------

export function classifyByMap(map, productUrl, productName) {
  if (!map) return null;
  const slug = normaliseSlug(productUrl);
  if (slug && slug !== '/' && map.slugToTier?.has(slug)) {
    return map.slugToTier.get(slug);
  }
  const prefix = titlePrefix(productName);
  if (prefix && map.titleToTier?.has(prefix)) {
    return map.titleToTier.get(prefix);
  }
  return null;
}

// Test-only: clear the in-process cache between unit-test runs.
export function _clearProductTierMapCache() {
  CACHED = null;
  CACHED_AT = 0;
}
