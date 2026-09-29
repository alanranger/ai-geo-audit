/**
 * Load comparable prior keyword_rankings rows for confirmation baselines.
 * Prefers the newest prior audit_date with a usable complete capture.
 * Does not invent ranks; skips city-only rows when current method is pin.
 * Excludes pending/unconfirmed observations from confirmed baseline set.
 */

import {
  GEO_METHOD_GBP_PIN,
  GEO_METHOD_CITY_CODE,
  GEO_METHOD_CITY_ONLY_DATE,
  resolveGeoMethod,
  resolveSerpCaptureStatus,
  CAPTURE_STATUS,
} from './dfs-serp-quality.js';
import { CONFIRM_STATE } from './rank-confirmation.js';

function normalizeKeyword(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const PENDING_BASELINE_STATES = new Set([
  CONFIRM_STATE.UNCONFIRMED_UNSTABLE,
  CONFIRM_STATE.PARTIAL_FAILURE,
  CONFIRM_STATE.EXHAUSTED_BUDGET,
  CONFIRM_STATE.UNKNOWN,
]);

function isPendingUnconfirmedBaseline(row) {
  const st = row?.serp_features?.confirmation_state;
  return !!(st && PENDING_BASELINE_STATES.has(String(st)));
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
    if (isPendingUnconfirmedBaseline(row)) continue;
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

function chunkList(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function escapePostgrestInValue(value) {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Fetch prior baselines from Supabase REST for a keyword list.
 * Filters requested keywords server-side (chunked .in) so single-keyword /
 * small requests cannot omit history behind newer unrelated global rows.
 *
 * Limitation (honest): each chunk is bounded to ~6 newest rows per keyword
 * (limit = min(chunkLen*6, 240)) — NOT paginated. If the comparable pin
 * baseline is older than those newest rows (e.g. buried under city/pending
 * noise), it may still be omitted. No further pages are fetched.
 *
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
  const uniqueKeywords = [...new Set(
    (keywords || []).map((k) => String(k || '').trim()).filter(Boolean)
  )];
  if (!uniqueKeywords.length) return {};

  const selectCols = [
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
  ].join(',');

  const collected = [];
  const chunks = chunkList(uniqueKeywords, 40);
  try {
    for (const chunk of chunks) {
      const inList = chunk.map(escapePostgrestInValue).join(',');
      const params = new URLSearchParams({
        property_url: `eq.${propertyUrl}`,
        audit_date: `lt.${before}`,
        keyword: `in.(${inList})`,
        select: selectCols,
        order: 'audit_date.desc',
        limit: String(Math.min(chunk.length * 6, 240)),
      });
      const res = await fetch(`${supabaseUrl}/rest/v1/keyword_rankings?${params}`, {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      });
      if (!res.ok) continue;
      const rows = await res.json();
      if (Array.isArray(rows)) collected.push(...rows);
    }
  } catch (_e) {
    return {};
  }
  return buildBaselinesMap(collected, { preferGeoMethod });
}
