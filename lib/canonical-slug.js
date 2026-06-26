// lib/canonical-slug.js
//
// Shared canonical-slug primitive (Phase 2 single source of truth).
//
// The authoritative registry for "this retired URL now lives under that
// surviving URL" is the page_indexability_policy retired_redirect rows. SQL
// mirrors this with canonical_gsc_slug() (see
// migrations/20260626_canonical_slug_merge_one_day_landscape.sql). This module
// is the JS-side equivalent: it turns policy rows into a fast alias map for
// remapping slugs (e.g. GSC role attribution) so JS stays consistent with the
// view-layer merge.
//
// STATIC_SLUG_ALIASES carries the already-shipped consolidations so synchronous
// callers without live DB access still resolve correctly; keep it in sync with
// the retired_redirect policy rows.

import { normalizePageSlug } from './revenue-tier-mapping.js';

/** Known retired -> surviving consolidations (mirror of retired_redirect policy rows). */
export const STATIC_SLUG_ALIASES = Object.freeze({
  'one-day-landscape-photography-workshops': 'landscape-photography-workshops'
});

/**
 * Build a fromSlug -> toSlug alias Map from page_indexability_policy rows,
 * seeded with the static aliases. Only exact retired_redirect rows are used
 * (mirrors the SQL hot-path join, which is exact-only).
 *
 * @param {Array<object>|null} policyRows page_indexability_policy rows.
 * @param {object} base seed map of fromSlug -> toSlug (defaults to STATIC_SLUG_ALIASES).
 * @returns {Map<string,string>}
 */
export function buildSlugAliasMap(policyRows, base = STATIC_SLUG_ALIASES) {
  const map = new Map();
  for (const [from, to] of Object.entries(base || {})) {
    addAlias(map, from, to);
  }
  for (const row of policyRows || []) {
    if (!isExactRetiredRedirect(row)) continue;
    addAlias(map, row.url_or_prefix, row.redirect_target);
  }
  return map;
}

function isExactRetiredRedirect(row) {
  if (row?.policy !== 'retired_redirect') return false;
  return !row.match_type || row.match_type === 'exact';
}

function addAlias(map, from, to) {
  const f = normalizePageSlug(from);
  const t = normalizePageSlug(to);
  if (f && t && f !== t) map.set(f, t);
}

/** Default alias map (static aliases only) for synchronous callers. */
export const DEFAULT_SLUG_ALIAS_MAP = buildSlugAliasMap(null);

/**
 * Resolve a slug to its canonical (surviving) slug. No-op when no alias exists.
 * Follows alias chains, guarding against cycles.
 *
 * @param {string} slug raw or normalized slug/url-path.
 * @param {Map<string,string>|null} aliasMap defaults to DEFAULT_SLUG_ALIAS_MAP.
 * @returns {string} normalized canonical slug.
 */
export function resolveCanonicalSlug(slug, aliasMap = null) {
  const start = normalizePageSlug(slug);
  if (!start) return start;
  const map = aliasMap || DEFAULT_SLUG_ALIAS_MAP;
  let current = start;
  const seen = new Set();
  while (map.has(current) && !seen.has(current)) {
    seen.add(current);
    current = map.get(current);
  }
  return current;
}
