// lib/revenue-stream-gsc-roles.js
//
// Read-only lookup: per revenue-stream tier_key, the L1 nav-hub slugs and L3
// product slugs that should feed a widened §9 GSC overlay (hub-role vs
// product-role).
//
// Default: derived from canonical_products (service_page_url = L1,
// product_url = L3), grouped by each product's own category -> tier_key.
//
// Tiers listed in TIER_GSC_ROLE_OVERRIDES skip canonical derivation for that
// tier_key (empty by default — canonical_products is the source of truth).
//
// Excludes L2 product-hub roots and Tier C event paths. Use NAV_HUB_SLUG_OVERRIDES
// for post-consolidation hub slug remaps on canonical-derived tiers.

import {
  TIER_ORDER,
  TIER_DEFINITIONS,
  tierFromProductCategory,
  normalizePageSlug
} from './revenue-tier-mapping.js';
import { resolveCanonicalSlug } from './canonical-slug.js';

export const EXCLUDED_EVENT_PREFIXES = Object.freeze([
  'photographic-workshops-near-me/',
  'beginners-photography-lessons/'
]);

export const EXCLUDED_L2_ROOT_SLUGS = Object.freeze(new Set([
  'photo-workshops-uk',
  'photography-services-near-me'
]));

// Post-consolidation hub remaps ({ fromSlug: toSlug }). Authoritative registry
// is page_indexability_policy retired_redirect (mirrored in lib/canonical-slug.js
// + SQL canonical_gsc_slug()); this local seed keeps synchronous GSC role
// attribution consistent with the view-layer merge.
export const NAV_HUB_SLUG_OVERRIDES = Object.freeze({
  'one-day-landscape-photography-workshops': 'landscape-photography-workshops'
});

/** Optional per-tier L1/L3 overrides when canonical_products is wrong or incomplete. */
export const TIER_GSC_ROLE_OVERRIDES = Object.freeze({});

const OVERRIDE_TIER_KEYS = new Set(Object.keys(TIER_GSC_ROLE_OVERRIDES));

export function slugFromCanonicalUrl(url) {
  if (!url) return null;
  const v = String(url).toLowerCase().trim();
  const noProtocol = v.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const noQuery = noProtocol.split('?')[0].split('#')[0];
  const path = noQuery.includes('/') ? noQuery.slice(noQuery.indexOf('/') + 1) : noQuery;
  const slug = path.replace(/^\/+/, '').replace(/\/+$/, '') || null;
  return slug ? normalizePageSlug(slug) : null;
}

export function resolveNavHubSlug(slug) {
  const n = normalizePageSlug(slug);
  if (!n) return null;
  // Local explicit override first, then the policy-driven canonical alias map.
  return resolveCanonicalSlug(NAV_HUB_SLUG_OVERRIDES[n] || n);
}

export function isExcludedEventSlug(slug) {
  const s = normalizePageSlug(slug);
  if (!s) return true;
  return EXCLUDED_EVENT_PREFIXES.some((prefix) => s.startsWith(prefix));
}

export function isExcludedL2RootSlug(slug) {
  return EXCLUDED_L2_ROOT_SLUGS.has(normalizePageSlug(slug));
}

export function isEligibleProductSlug(slug) {
  const s = normalizePageSlug(slug);
  if (!s || isExcludedEventSlug(s) || isExcludedL2RootSlug(s)) return false;
  return true;
}

export function isEligibleNavHubSlug(slug) {
  const s = normalizePageSlug(slug);
  if (!s || isExcludedEventSlug(s) || isExcludedL2RootSlug(s)) return false;
  return true;
}

function addSlug(map, tierKey, slug) {
  if (!map.has(tierKey)) map.set(tierKey, new Set());
  map.get(tierKey).add(slug);
}

function sorted(set) {
  return [...(set || new Set())].sort((a, b) => a.localeCompare(b));
}

function applyTierGscRoleOverrides(navByTier, prodByTier) {
  for (const [tierKey, roles] of Object.entries(TIER_GSC_ROLE_OVERRIDES)) {
    navByTier.set(
      tierKey,
      new Set((roles.nav_hub_slugs || []).map((s) => normalizePageSlug(s)).filter(Boolean))
    );
    prodByTier.set(
      tierKey,
      new Set((roles.product_slugs || []).map((s) => normalizePageSlug(s)).filter(Boolean))
    );
  }
}

export function buildRevenueStreamGscRoles(rows) {
  const navByTier = new Map();
  const prodByTier = new Map();
  const unmapped = new Set();

  for (const row of rows || []) {
    const tierKey = tierFromProductCategory(row.category);
    if (tierKey === '__excluded__') continue;
    if (!tierKey) {
      const cat = String(row.category || '').trim();
      if (cat) unmapped.add(cat);
      continue;
    }
    if (OVERRIDE_TIER_KEYS.has(tierKey)) continue;

    const productSlug = slugFromCanonicalUrl(row.product_url);
    if (productSlug && isEligibleProductSlug(productSlug)) {
      addSlug(prodByTier, tierKey, productSlug);
    }

    const navSlug = resolveNavHubSlug(slugFromCanonicalUrl(row.service_page_url));
    if (navSlug && isEligibleNavHubSlug(navSlug)) {
      addSlug(navByTier, tierKey, navSlug);
    }
  }

  applyTierGscRoleOverrides(navByTier, prodByTier);

  const tierKeys = new Set([
    ...navByTier.keys(),
    ...prodByTier.keys(),
    ...OVERRIDE_TIER_KEYS
  ]);
  const streams = [...tierKeys]
    .sort((a, b) => {
      const ia = TIER_ORDER.indexOf(a);
      const ib = TIER_ORDER.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    })
    .map((tier_key) => ({
      tier_key,
      label: TIER_DEFINITIONS[tier_key]?.label || tier_key,
      nav_hub_slugs: sorted(navByTier.get(tier_key)),
      product_slugs: sorted(prodByTier.get(tier_key))
    }));

  return {
    streams,
    unmappedCategories: [...unmapped].sort()
  };
}

export async function loadRevenueStreamGscRoles(supabase) {
  const { data, error } = await supabase
    .from('canonical_products')
    .select('product_url, service_page_url, category, is_retired')
    .eq('is_retired', false)
    .not('category', 'is', null);
  if (error) throw error;
  return buildRevenueStreamGscRoles(data || []);
}

export function getStreamByTierKey(lookup, tierKey) {
  return lookup.streams.find((s) => s.tier_key === tierKey) || null;
}

export function tierKeyForProductSlug(lookup, productSlug) {
  const slug = normalizePageSlug(productSlug);
  for (const stream of lookup.streams) {
    if (stream.product_slugs.includes(slug)) return stream.tier_key;
  }
  return null;
}
