/**
 * Load comparable prior keyword_rankings rows for confirmation baselines.
 * Prefers the newest prior audit_date with a usable complete capture.
 * Does not invent ranks; skips city-only rows when current method is pin.
 */

import {
  GEO_METHOD_GBP_PIN,
  GEO_METHOD_CITY_CODE,
  GEO_METHOD_CITY_ONLY_DATE,
  resolveGeoMethod,
  resolveSerpCaptureStatus,
  CAPTURE_STATUS,
} from './dfs-serp-quality.js';

function normalizeKeyword(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * @param {object[]} priorRows keyword_rankings rows from an older audit
 * @param {{ preferGeoMethod?: string }} [opts]
 * @returns {Record<string, object>} map keyed by normalized keyword
 */
export function buildBaselinesMap(priorRows = [], opts = {}) {
  const prefer = opts.preferGeoMethod || GEO_METHOD_GBP_PIN;
  const map = {};
  for (const row of priorRows || []) {
    if (!row?.keyword) continue;
    const key = normalizeKeyword(row.keyword);
    const status = resolveSerpCaptureStatus(row);
    const usable = status === CAPTURE_STATUS.COMPLETE_RANKED
      || status === CAPTURE_STATUS.COMPLETE_NO_MATCH
      || (row.best_rank_group != null && !row.serp_features?.capture_status);
    if (!usable) continue;
    const geo = resolveGeoMethod(row);
    // Never use city-only Sep28 Local as baseline for pin-series confirmation.
    if (prefer === GEO_METHOD_GBP_PIN) {
      if (geo === GEO_METHOD_CITY_CODE) continue;
      if (String(row.audit_date || '').slice(0, 10) === GEO_METHOD_CITY_ONLY_DATE
        && Number(row.location_code) === 9215523
        && !row.location_coordinate) {
        continue;
      }
    }
    if (prefer === GEO_METHOD_CITY_CODE && geo && geo !== GEO_METHOD_CITY_CODE) continue;
    // Prefer stronger / more recent already-loaded rows — first write wins if caller sorted newest first.
    if (!map[key]) map[key] = row;
  }
  return map;
}

/**
 * Fetch prior baselines from Supabase REST for a keyword list.
 * Read-only. Returns {} when credentials missing.
 */
export async function fetchRankBaselines({
  propertyUrl,
  keywords,
  beforeDate = null,
  preferGeoMethod = GEO_METHOD_GBP_PIN,
} = {}) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey || !propertyUrl || !keywords?.length) return {};

  const before = beforeDate || new Date().toISOString().slice(0, 10);
  const params = new URLSearchParams({
    property_url: `eq.${propertyUrl}`,
    audit_date: `lt.${before}`,
    select: [
      'keyword',
      'audit_date',
      'best_rank_group',
      'best_rank_absolute',
      'best_url',
      'location_code',
      'location_coordinate',
      'serp_features',
      'last_refreshed_at',
      'updated_at',
    ].join(','),
    order: 'audit_date.desc',
    limit: String(Math.min(keywords.length * 6, 900)),
  });
  // Filter to requested keywords in chunks to avoid huge .in() URLs.
  const want = new Set(keywords.map(normalizeKeyword));
  const collected = [];
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/keyword_rankings?${params}`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });
    if (!res.ok) return {};
    const rows = await res.json();
    for (const row of Array.isArray(rows) ? rows : []) {
      if (want.has(normalizeKeyword(row.keyword))) collected.push(row);
    }
  } catch (_e) {
    return {};
  }
  return buildBaselinesMap(collected, { preferGeoMethod });
}
