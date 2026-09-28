/**
 * DataForSEO Organic SERP Rank Test API
 *
 * Fetches classic organic rankings, SERP features and Google AI Overview
 * citations per keyword via DataForSEO Google Organic SERP Live Advanced.
 *
 * Phase 1 (Apr 2026): enables `load_async_ai_overview` + `expand_ai_overview`
 * so the response includes a rich `ai_overview` item with references whenever
 * Google shows an AIO in classic SERP. Those citations are surfaced under
 * `ai_overview_citations` — a separate AI engine slot from Google AI Mode
 * (which is scraped via the dedicated ai_mode endpoint).
 *
 * Returns per keyword:
 * - best_rank_group / best_rank_absolute / best_url / best_title
 * - has_ai_overview: AIO item present in classic SERP
 * - serp_features: { local_pack, featured_snippet, people_also_ask }
 * - ai_overview_citations: normalised Google AIO citation data (see
 *   lib/ai-citation-extract.js for shape)
 */

import { extractCitationsFromDfsResult } from '../../lib/ai-citation-extract.js';
import { resolveTrackingLocation } from '../../lib/keyword-ranking/tracking-location.js';
import { getBusinessDevice } from '../../lib/keyword-ranking/business-location.js';
import {
  preflightLocalCapture,
  resolveLocalCaptureFields,
} from '../../lib/keyword-ranking/local-capture-preflight.js';
import {
  isIncompleteSerpCrawl,
  SERP_CRAWL_INCOMPLETE_ERROR,
  buildSerpCaptureFeatures,
  CAPTURE_STATUS,
} from '../../lib/keyword-ranking/dfs-serp-quality.js';
import { createDfsSpendTracker } from '../../lib/keyword-ranking/dfs-spend-limits.js';
import {
  isSignificantWorsening,
  resolveConfirmationState,
  buildConfirmationFeatures,
} from '../../lib/keyword-ranking/rank-confirmation.js';
import { extractSerpSurfaces } from '../../lib/keyword-ranking/serp-surface-extract.js';
import { resolveKeywordClass } from '../../lib/keyword-ranking/tracking-class.js';
// Grid PARKED (Alan 2026-07-16): do not import fetchLocalGridSerp into production refresh.
import { computeKeywordSurfaceScore } from '../../lib/audit/surfaceScores.js';
import { computeKeywordTopOfPageScore } from '../../lib/audit/topOfPage.js';
import { buildSerpSurfaceStack } from '../../lib/keyword-ranking/serp-surface-stack.js';

export const config = { runtime: 'nodejs', maxDuration: 300 };

function normalizeDomain(value) {
  if (!value) return null;
  try {
    if (value.includes("://")) {
      return new URL(value).hostname.replace(/^www\./, "");
    }
  } catch {}
  return value.replace(/^www\./, "");
}

function normalizeKeyword(keyword) {
  if (!keyword) return '';
  return String(keyword)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' '); // Collapse multiple spaces to single space
}

/**
 * Fetch keyword search volume from DataForSEO Keywords Data API
 * Uses: keywords_data/google_ads/search_volume/live (not keyword_overview)
 * Returns a map: keyword (normalized) -> { search_volume, monthly_searches }
 */
async function fetchKeywordOverview(keywords, auth) {
  const endpoint = "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live";
  
  console.log(`[VOL] fetchKeywordOverview called with ${keywords.length} keywords`);
  
  try {
    // Log ALL keywords being sent to DataForSEO with [VOL] prefix
    console.log(`[VOL] Sending keywords to search_volume:`, keywords);
    console.log(`[Keyword Overview] Sending ${keywords.length} keywords to DataForSEO:`);
    keywords.forEach((kw, idx) => {
      console.log(`  ${idx + 1}. "${kw}" (normalized: "${normalizeKeyword(kw)}")`);
    });
    
    // Log request body to verify no filtering/deduplication issues
    // Note: keywords_data/google_ads/search_volume/live uses different structure
    const requestBody = {
      keywords: keywords,
      location_code: 2826, // United Kingdom
      sort_by: "relevance"
    };
    console.log(`[VOL] Request body to DataForSEO:`, JSON.stringify(requestBody));
    
    console.log(`[VOL] Making fetch request to: ${endpoint}`);
    let dfResponse;
    try {
      dfResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify([requestBody]),
      });
      console.log(`[VOL] Fetch completed, status: ${dfResponse.status}`);
    } catch (fetchErr) {
      console.error(`[VOL] Fetch failed:`, fetchErr.message);
      console.error(`[VOL] Fetch error stack:`, fetchErr.stack);
      throw fetchErr;
    }

    let data;
    try {
      data = await dfResponse.json();
      console.log(`[VOL] JSON parsed successfully`);
    } catch (jsonErr) {
      console.error(`[VOL] JSON parse failed:`, jsonErr.message);
      const text = await dfResponse.text();
      console.error(`[VOL] Response text (first 500 chars):`, text.substring(0, 500));
      throw jsonErr;
    }

    console.log(`[Keyword Overview] Response status: ${dfResponse.status}`);
    console.log(`[Keyword Overview] Response type: ${Array.isArray(data) ? 'Array' : typeof data}`);
    
    // DataForSEO keywords_data endpoint wraps response in array: [{ status_code, result: [...] }]
    let responseData = data;
    if (Array.isArray(data) && data.length > 0) {
      responseData = data[0];
      console.log(`[Keyword Overview] Response is array, using first element`);
    }
    
    console.log(`[Keyword Overview] Response structure check:`);
    console.log(`  - status_code: ${responseData.status_code}`);
    console.log(`  - status_message: ${responseData.status_message}`);
    console.log(`  - tasks_count: ${responseData.tasks_count ?? 'N/A'}`);
    console.log(`  - tasks_error: ${responseData.tasks_error ?? 'N/A'}`);
    console.log(`  - result type: ${Array.isArray(responseData.result) ? 'array' : typeof responseData.result}`);
    console.log(`  - result length: ${Array.isArray(responseData.result) ? responseData.result.length : 'N/A'}`);
    console.log(`  - tasks type: ${Array.isArray(responseData.tasks) ? 'array' : typeof responseData.tasks}`);
    console.log(`  - tasks length: ${Array.isArray(responseData.tasks) ? responseData.tasks.length : 'N/A'}`);
    
    // DataForSEO uses status_code 20000 for success (not 200)
    const statusCode = responseData.status_code;
    const statusMessage = responseData.status_message;
    const tasksError = responseData.tasks_error;
    
    // Check if there are task-level errors
    if (tasksError && tasksError > 0 && Array.isArray(responseData.tasks)) {
      console.log(`[Keyword Overview] Checking task-level errors (tasks_error: ${tasksError})...`);
      responseData.tasks.forEach((task, idx) => {
        console.log(`  Task ${idx}: status_code=${task.status_code}, status_message=${task.status_message}`);
        if (task.status_code && !String(task.status_code).startsWith("200")) {
          console.error(`  Task ${idx} ERROR:`, {
            status_code: task.status_code,
            status_message: task.status_message,
            task_data: JSON.stringify(task).substring(0, 500)
          });
        }
      });
    }
    
    const isSuccess = dfResponse.ok && (
      String(statusCode).startsWith("200") || 
      statusCode === 20000 ||
      statusMessage === "Ok."
    );
    
    if (!isSuccess) {
      console.error("[Keyword Overview] API error:", {
        status_code: statusCode,
        status_message: statusMessage,
        tasks_error: tasksError,
        full_response: JSON.stringify(data).substring(0, 1000)
      });
      return {};
    }
    
    console.log(`[Keyword Overview] API success - status_code: ${statusCode}, message: ${statusMessage}`);

    // Handle DataForSEO keywords_data/google_ads/search_volume/live response structure
    // According to docs: response has tasks[] array, each task has result[] array
    // Structure: { status_code: 20000, tasks: [{ status_code, result: [...] }] }
    let items = [];
    
    if (responseData.tasks && Array.isArray(responseData.tasks) && responseData.tasks.length > 0) {
      // keywords_data endpoint uses tasks structure
      const task = responseData.tasks[0];
      console.log(`[VOL] Using tasks structure`);
      console.log(`  Task status_code: ${task.status_code}`);
      console.log(`  Task status_message: ${task.status_message}`);
      console.log(`  Task result type: ${Array.isArray(task.result) ? 'array' : typeof task.result}`);
      
      // Log full task structure for debugging
      console.log(`[VOL] Full task structure:`, JSON.stringify(task, null, 2).substring(0, 1000));
      
      // Check task-level success
      const taskSuccess = task.status_code && (
        String(task.status_code).startsWith("200") || 
        task.status_code === 20000 ||
        task.status_message === "Ok."
      );
      
      if (!taskSuccess) {
        console.error(`[VOL] Task failed: status_code=${task.status_code}, message=${task.status_message}`);
        console.error(`[VOL] Task error (if any):`, task.error || 'none');
        
        // If payment required, log a helpful message
        if (task.status_code === 40200 || task.status_message === 'Payment Required.') {
          console.error(`[VOL] ⚠️  PAYMENT REQUIRED: DataForSEO account needs credits for keywords_data/google_ads/search_volume/live endpoint`);
          console.error(`[VOL] Search volume data will be unavailable until credits are added to your DataForSEO account`);
        }
        
        console.error(`[VOL] Full task data:`, JSON.stringify(task, null, 2));
        return {};
      }
      
      // Check if task has error field
      if (task.error) {
        console.error(`[VOL] Task has error field:`, task.error);
        console.error(`[VOL] Full task:`, JSON.stringify(task, null, 2));
        return {};
      }
      
      if (Array.isArray(task.result)) {
        // Direct result array in task
        items = task.result;
        console.log(`[VOL] Found ${items.length} items in task.result[]`);
      } else {
        console.error(`[VOL] Task result is not an array:`, typeof task.result);
        console.error(`[VOL] Task keys:`, Object.keys(task));
      }
    } else if (Array.isArray(responseData.result)) {
      // Fallback: direct result array (if not in tasks)
      items = responseData.result;
      console.log(`[VOL] Using responseData.result[] (direct array), found ${items.length} items`);
    }
    
    // If still no items, log full response structure for debugging
    if (items.length === 0) {
      console.error(`[VOL] No items found! Full response structure:`);
      console.error(`[VOL] responseData keys: ${Object.keys(responseData).join(', ')}`);
      console.error(`[VOL] Full responseData (first 2000 chars):`);
      console.error(JSON.stringify(responseData, null, 2).substring(0, 2000));
    }
    
    console.log(`[VOL] Result count: ${items.length}`);
    
    // Log raw response from DataForSEO before any mapping
    console.log(`[VOL] Raw results from DataForSEO:`);
    for (const item of items) {
      const kw = item.keyword || item.keyword_info?.keyword || (typeof item.keyword_info === 'string' ? item.keyword_info : null);
      const searchVolume = item.keyword_info?.search_volume ?? item.search_volume ?? null;
      console.log(`[VOL] Raw result: keyword="${kw ?? 'MISSING'}", search_volume=${searchVolume ?? 'null'}`);
      
      // If this is "alan ranger", log the FULL item structure
      if (kw && normalizeKeyword(kw) === 'alan ranger') {
        console.log(`[VOL] FULL ITEM STRUCTURE for "alan ranger":`);
        console.log(JSON.stringify(item, null, 2));
        console.log(`[VOL] item.keyword: ${item.keyword}`);
        console.log(`[VOL] item.keyword_info: ${JSON.stringify(item.keyword_info)}`);
        console.log(`[VOL] item.search_volume: ${item.search_volume}`);
        console.log(`[VOL] item.keyword_info?.search_volume: ${item.keyword_info?.search_volume}`);
        console.log(`[VOL] All item keys: ${Object.keys(item).join(', ')}`);
      }
    }

    const volumeByKeyword = {};
    console.log(`[Keyword Overview] Processing ${items.length} items from DataForSEO response`);
    
    for (const item of items) {
      // DataForSEO keywords_data/google_ads/search_volume/live structure:
      // - item.keyword (direct)
      // Fallback for keyword_overview endpoint:
      // - item.keyword_info.keyword
      const kw = item.keyword || item.keyword_info?.keyword || (typeof item.keyword_info === 'string' ? item.keyword_info : null);
      
      if (!kw) {
        console.warn("[Keyword Overview] Item missing keyword. Item keys:", Object.keys(item));
        console.warn("[Keyword Overview] Item sample:", JSON.stringify(item).substring(0, 300));
        continue;
      }
      
      const normalizedKw = normalizeKeyword(kw);
      
      // Search volume structure for keywords_data/google_ads/search_volume/live:
      // - item.search_volume (direct)
      // Fallback for keyword_overview:
      // - item.keyword_info.search_volume
      // IMPORTANT: Treat 0 as a valid value, only use null if truly missing
      const searchVolume = item.search_volume !== undefined 
        ? item.search_volume 
        : (item.keyword_info?.search_volume !== undefined ? item.keyword_info.search_volume : null);
      
      // Monthly searches structure:
      // - item.monthly_searches (direct array)
      // Fallback: item.keyword_info.monthly_searches
      const monthlySearches = item.monthly_searches || item.keyword_info?.monthly_searches || undefined;

      console.log(`[Keyword Overview] Processing item: original="${kw}", normalized="${normalizedKw}", volume=${searchVolume ?? 'null'}`);

      volumeByKeyword[normalizedKw] = {
        search_volume: searchVolume, // Can be 0, null, or a number
        monthly_searches: monthlySearches,
      };
    }

    console.log(`[Keyword Overview] Built volume map with ${Object.keys(volumeByKeyword).length} entries`);
    
    // Log the volume map summary for debugging
    console.log(`[Keyword Overview] Volume map entries:`);
    Object.entries(volumeByKeyword).forEach(([kw, data]) => {
      console.log(`  "${kw}" → ${data.search_volume ?? 'null'}`);
    });
    
    return volumeByKeyword;
  } catch (err) {
    console.error("[Keyword Overview] Error fetching Keyword Overview:", err.message, err.stack);
    return {}; // Return empty map on error, don't block ranking results
  }
}

// Default SERP depth for audits. Reverted 100 → 50 on 2026-04-22 after a
// single "full audit" click burned $50-70 of DFS credit. depth=100 with
// expand_ai_overview=true costs ~$0.025 per keyword; depth=50 without AIO
// expansion is ~$0.002 (the historical "few dollars per full audit" rate).
// Callers can still pass ?depth=100 explicitly for deep investigations.
const DEFAULT_SERP_DEPTH = 50;
const MAX_SERP_DEPTH = 100; // DFS supports up to 700; cap at 100 to keep a manual `?depth=100` override possible.

function resolveSerpDepth(rawDepth) {
  const n = Number(rawDepth);
  if (!Number.isFinite(n)) return DEFAULT_SERP_DEPTH;
  const clamped = Math.max(10, Math.min(MAX_SERP_DEPTH, Math.round(n)));
  return clamped;
}

// 2026-04-22 spend guard: once DFS reports "Payment Required" or a similar
// fatal auth/billing failure we flip this flag and short-circuit every
// subsequent keyword in the same handler invocation. Prevents a single
// scan click from firing 100+ paid requests (at $0.025 each at depth=100
// with AIO expansion) after the account is already depleted.
const DFS_FATAL_STATUS_CODES = new Set([40100, 40101, 40200, 40300, 40400]);

function isDfsFatalStatus(statusCode) {
  if (statusCode === undefined || statusCode === null) return false;
  const n = Number(statusCode);
  if (!Number.isFinite(n)) return false;
  return DFS_FATAL_STATUS_CODES.has(n);
}

function buildEmptySerpResult(keyword, depth, errorMessage, errorCode, locationName = null) {
  const classInfo = resolveKeywordClass(keyword);
  const loc = resolveTrackingLocation(keyword);
  const capture = resolveLocalCaptureFields(keyword);
  const isLocal = loc.tier === 'L';
  const errMsg = errorMessage || 'DataForSEO request failed';
  const emptyStatus = /empty SERP/i.test(errMsg) ? CAPTURE_STATUS.EMPTY : CAPTURE_STATUS.ERROR;
  return {
    keyword,
    location_name: locationName || loc.location_name,
    location_code: capture.location_code ?? loc.location_code ?? null,
    location_coordinate: isLocal ? (capture.location_coordinate || null) : null,
    device: isLocal ? getBusinessDevice() : 'desktop',
    os: 'windows',
    best_rank_group: null,
    best_rank_absolute: null,
    best_url: null,
    best_title: null,
    has_ai_overview: false,
    serp_features: buildSerpCaptureFeatures({
      local_pack: false,
      featured_snippet: false,
      people_also_ask: false,
    }, {
      capture_status: emptyStatus,
      crawl_incomplete: true,
      organic_count: 0,
      serp_depth: depth,
      location_code: capture.location_code ?? loc.location_code,
      location_coordinate: isLocal ? (capture.location_coordinate || null) : null,
      geo_method: capture.geo_method || null,
      method_version: capture.method_version || null,
      error: errMsg,
      checked_at: new Date().toISOString(),
      best_rank_group: null,
      best_rank_absolute: null,
      serp_surface_stack: [],
    }),
    ai_overview_present_any: false,
    local_pack_present_any: false,
    paa_present_any: false,
    featured_snippet_present_any: false,
    local_pack_position: null,
    kp_present: false,
    kp_ours: false,
    featured_snippet_ours: false,
    paa_ours: false,
    keyword_class: classInfo.keyword_class,
    class_unmapped: classInfo.class_unmapped,
    ai_overview_citations: null,
    serp_surface_stack: [],
    serp_depth: depth,
    organic_count: 0,
    dfs_cost: null,
    se_results_count: null,
    crawl_incomplete: true,
    error: errMsg,
    error_code: errorCode ?? null,
  };
}

async function fetchSerpForKeyword(keyword, auth, targetRoot, depth = DEFAULT_SERP_DEPTH, opts = {}) {
  const endpoint =
    "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";

  // 2026-04-22: expand_ai_overview is the main cost driver (~3-5x per request).
  // Default is now OFF. Callers opt in via ?ai_overview=1 on the handler, which
  // sets expandAiOverview: true here. has_ai_overview flag (from the item list)
  // still works without expansion — only the full citation list is skipped.
  const expandAiOverview = Boolean(opts.expandAiOverview);
  const locationName = opts.location_name || "United Kingdom";
  const locationCode = opts.location_code != null ? opts.location_code : null;
  const isLocalTier = opts.tier === 'L';
  const device = isLocalTier ? getBusinessDevice() : 'desktop';
  const os = device === 'desktop' ? 'windows' : 'android';
  // Primary Local series = verified GBP pin. City-code only when caller opts in
  // (forceCityCode / explicit null coordinate with geo_method city).
  const locationCoordinate = Object.prototype.hasOwnProperty.call(opts, 'location_coordinate')
    ? (opts.location_coordinate || null)
    : (isLocalTier ? (resolveLocalCaptureFields(keyword).location_coordinate || null) : null);
  const geoMethod = opts.geo_method
    || (isLocalTier
      ? (locationCoordinate ? 'gbp_pin' : 'coventry_city_code')
      : null);
  const methodVersion = opts.method_version
    || (geoMethod === 'gbp_pin'
      ? 'local_gbp_pin_v1'
      : (geoMethod === 'coventry_city_code' ? 'local_city_code_v1' : (locationCode === 2826 ? 'national_uk_v1' : null)));

  try {
    const taskPayload = {
      keyword,
      language_code: "en",
      device,
      os,
      depth,
      load_async_ai_overview: expandAiOverview,
      expand_ai_overview: expandAiOverview,
    };
    // Prefer location_code when present (national UK = 2826; Local = 9215523).
    if (locationCode != null) taskPayload.location_code = locationCode;
    else taskPayload.location_name = locationName;
    if (locationCoordinate) taskPayload.location_coordinate = locationCoordinate;

    const dfResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify([taskPayload]),
    });

    const data = await dfResponse.json();

    if (!dfResponse.ok || !String(data.status_code).startsWith("200")) {
      const taskStatus = data?.tasks?.[0]?.status_code;
      const topStatus = data?.status_code;
      let fatalStatus = null;
      if (isDfsFatalStatus(topStatus)) fatalStatus = topStatus;
      else if (isDfsFatalStatus(taskStatus)) fatalStatus = taskStatus;
      if (fatalStatus) {
        console.warn(`[SERP-RANK-TEST] Fatal DFS status ${fatalStatus} on "${keyword}" — short-circuiting remaining keywords.`);
      }
      return Object.assign(
        buildEmptySerpResult(keyword, depth, data.status_message || "DataForSEO request failed", topStatus || taskStatus || null, locationName),
        fatalStatus ? { fatal: true } : {}
      );
    }

    const task = data.tasks?.[0];
    const taskOk = task?.status_code == null || String(task.status_code).startsWith("200");
    const result = task?.result?.[0];
    const items = result?.items ?? [];

    // DFS sometimes returns top-level 20000 with an empty/missing result payload
    // (seen especially on Coventry name-only location calls under concurrency).
    // Treat as a hard miss so callers can retry / refuse to persist.
    if (!taskOk || !result || !Array.isArray(items) || items.length === 0) {
      const msg = !taskOk
        ? (task?.status_message || `DFS task status ${task?.status_code}`)
        : 'DFS returned empty SERP result';
      return buildEmptySerpResult(keyword, depth, msg, task?.status_code ?? data.status_code ?? null, locationName);
    }

    // Filter organic items - exact match on type
    const ourOrganic = items.filter((item) => {
      if (item.type !== "organic") return false;
      const d = normalizeDomain(item.domain || item.url);
      return d && d.endsWith(targetRoot);
    });

    // Find best rank
    let bestRankGroup = null;
    let bestRankAbsolute = null;
    let bestUrl = null;
    let bestTitle = null;

    for (const item of ourOrganic) {
      if (bestRankGroup === null || item.rank_group < bestRankGroup) {
        bestRankGroup = item.rank_group;
        bestRankAbsolute = item.rank_absolute;
        bestUrl = item.url;
        bestTitle = item.title;
      }
    }

    // Derive SERP features from result.item_types
    const itemTypes = result?.item_types || [];
    
    // Extract individual boolean fields for Supabase storage
    const ai_overview_present_any = itemTypes.includes("ai_overview");
    const local_pack_present_any = itemTypes.includes("local_pack");
    const paa_present_any = itemTypes.includes("people_also_ask");
    const featured_snippet_present_any = itemTypes.includes("featured_snippet");

    // Phase 1 surfaces: pack position, KP, FS/PAA ownership (parse-only, no extra DFS)
    const surfaces = extractSerpSurfaces(items, targetRoot);
    const classInfo = resolveKeywordClass(keyword);
    
    // Keep serp_features object for backward compatibility (+ ownership extras)
    const serpFeatures = {
      local_pack: local_pack_present_any,
      featured_snippet: featured_snippet_present_any,
      people_also_ask: paa_present_any,
      ...(surfaces.serp_features_extra || {}),
    };

    // Phase 1: extract Google AI Overview citations from the same response.
    const aiOverviewCitations = extractCitationsFromDfsResult(result);

    const serpSurfaceStack = buildSerpSurfaceStack(items, targetRoot);
    const organicCount = items.filter((item) => item.type === 'organic').length;
    const taskCost = task?.cost != null ? Number(task.cost) : (data?.cost != null ? Number(data.cost) : null);
    const seResultsCount = result?.se_results_count != null ? Number(result.se_results_count) : null;

    const serpResult = {
      keyword,
      location_name: locationName,
      location_code: locationCode,
      location_coordinate: locationCoordinate,
      device,
      os,
      best_rank_group: bestRankGroup,
      best_rank_absolute: bestRankAbsolute,
      best_url: bestUrl,
      best_title: bestTitle,
      has_ai_overview: ai_overview_present_any,
      serp_features: serpFeatures,
      // New boolean fields for Supabase storage
      ai_overview_present_any,
      local_pack_present_any,
      paa_present_any,
      featured_snippet_present_any,
      local_pack_position: surfaces.local_pack_position,
      kp_present: surfaces.kp_present,
      kp_ours: surfaces.kp_ours,
      featured_snippet_ours: surfaces.featured_snippet_ours,
      paa_ours: surfaces.paa_ours,
      keyword_class: classInfo.keyword_class,
      class_unmapped: classInfo.class_unmapped,
      // Phase 1: Google AI Overview citation slot (engine = google_aio)
      ai_overview_citations: aiOverviewCitations,
      serp_surface_stack: serpSurfaceStack,
      serp_depth: depth,
      dfs_cost: Number.isFinite(taskCost) ? taskCost : null,
      se_results_count: Number.isFinite(seResultsCount) ? seResultsCount : null,
      organic_count: organicCount,
      crawl_incomplete: false,
    };
    if (isIncompleteSerpCrawl({
      depth,
      organicCount,
      itemsCount: items.length,
      seResultsCount,
      cost: taskCost,
    })) {
      serpResult.crawl_incomplete = true;
      serpResult.error = SERP_CRAWL_INCOMPLETE_ERROR;
    }
    serpResult.serp_features = buildSerpCaptureFeatures(serpFeatures, {
      capture_status: serpResult.crawl_incomplete
        ? CAPTURE_STATUS.INCOMPLETE
        : (bestRankGroup != null ? CAPTURE_STATUS.COMPLETE_RANKED : CAPTURE_STATUS.COMPLETE_NO_MATCH),
      crawl_incomplete: serpResult.crawl_incomplete === true,
      organic_count: organicCount,
      dfs_cost: taskCost,
      se_results_count: seResultsCount,
      serp_depth: depth,
      location_code: locationCode,
      location_coordinate: locationCoordinate,
      geo_method: geoMethod,
      method_version: methodVersion,
      error: serpResult.error || null,
      checked_at: new Date().toISOString(),
      best_rank_group: bestRankGroup,
      best_rank_absolute: bestRankAbsolute,
      serp_surface_stack: serpSurfaceStack,
      dfs_task_id: task?.id || null,
    });
    // Keep legacy serp_features keys used by older UI readers.
    serpResult.serp_features.local_pack = local_pack_present_any;
    serpResult.serp_features.featured_snippet = featured_snippet_present_any;
    serpResult.serp_features.people_also_ask = paa_present_any;
    Object.assign(serpResult.serp_features, surfaces.serp_features_extra || {});
    // Release 2: attach Surface Visibility for single-keyword verification
    try {
      serpResult.surface_visibility = computeKeywordSurfaceScore({
        ...serpResult,
        ai_engines: {
          google_aio: aiOverviewCitations || { alan_citations_count: 0 },
        },
      });
    } catch (_e) {
      /* non-fatal */
    }
    // Release 0 v3: Top-of-Page score for single-keyword verification
    try {
      const top = computeKeywordTopOfPageScore(serpResult);
      serpResult.top_of_page = {
        score: top.score,
        best_surface: top.best_surface,
        best_slot: top.best_slot,
        components: top.components,
      };
    } catch (_e) {
      /* non-fatal */
    }
    return serpResult;
  } catch (err) {
    console.error(`Error fetching SERP for keyword "${keyword}":`, err);
    return buildEmptySerpResult(keyword, depth, "Unexpected server error", null);
  }
}

export default async function handler(req, res) {
  // Log handler entry immediately
  console.log(`[SERP-RANK-TEST] Handler called - Method: ${req.method}, Query:`, req.query);
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    console.log(`[SERP-RANK-TEST] OPTIONS preflight request`);
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
  }

  // Parse keywords from GET query or POST JSON body ({ keywords: string[], depth?: number })
  let keywords = [];
  let body = null;
  if (req.method === 'POST') {
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch {
      body = {};
    }
    if (Array.isArray(body.keywords)) {
      keywords = body.keywords.map(String).map((k) => k.trim()).filter((k) => k.length > 0);
    }
  } else if (req.query.keyword) {
    keywords = [String(req.query.keyword)];
  } else if (req.query.keywords) {
    keywords = String(req.query.keywords)
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0);
  }

  console.log(`[SERP-RANK-TEST] Parsed keywords:`, keywords);
  
  if (keywords.length === 0) {
    console.log(`[SERP-RANK-TEST] ERROR: No keywords provided`);
    res.status(400).json({
      error: "keyword or keywords is required",
    });
    return;
  }

  // Pre-flight: every Local-tier keyword must resolve verified GBP pin + Coventry code
  // before any DataForSEO spend (dashboard can also POST preflight_only: true).
  // Opt-in city-code series via force_city_code — never the default weekly path.
  const forceCityCode = body?.force_city_code === true
    || /^(1|true|yes)$/i.test(String(req.query.force_city_code || ''));
  const localPreflight = preflightLocalCapture(keywords, { forceCityCode });
  if (body?.preflight_only === true || /^(1|true|yes)$/i.test(String(req.query.preflight_only || ''))) {
    return res.status(localPreflight.ok ? 200 : 400).json({
      status: localPreflight.ok ? 'ok' : 'error',
      preflight: localPreflight,
      spend_limits: createDfsSpendTracker().snapshot(),
      meta: { generatedAt: new Date().toISOString() },
    });
  }
  if (!localPreflight.ok) {
    console.error(`[SERP-RANK-TEST] Local capture preflight failed:`, localPreflight);
    return res.status(400).json({
      error: 'Local-tier capture preflight failed — refusing DataForSEO spend',
      preflight: localPreflight,
    });
  }

  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    res.status(500).json({
      error: "DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD env vars are missing",
    });
    return;
  }

  const auth = Buffer.from(`${login}:${password}`).toString("base64");

  // Normalize target domain
  const targetRoot = normalizeDomain(
    process.env.AI_GEO_DOMAIN || "https://www.alanranger.com"
  );

  // Limit batch size to prevent timeouts (Vercel has 10s free tier, 60s hobby tier)
  const MAX_KEYWORDS_PER_REQUEST = 20;
  if (keywords.length > MAX_KEYWORDS_PER_REQUEST) {
    console.log(`[Handler] ⚠️ Too many keywords (${keywords.length}), limiting to ${MAX_KEYWORDS_PER_REQUEST}`);
    keywords = keywords.slice(0, MAX_KEYWORDS_PER_REQUEST);
  }

  // Optional ?depth= override. Default 50, clamped to [10, 100]. Lets us
  // verify "not ranked at all" vs. "ranks at 51-100" without changing the
  // default cost profile of the audit.
  const depth = resolveSerpDepth(body?.depth ?? req.query.depth);
  // 2026-04-22: AIO expansion is now opt-in. Pass ?ai_overview=1 to request
  // Google AI Overview citations (expensive). Default false keeps routine
  // audits cheap (~$0.002/keyword instead of ~$0.025).
  const expandAiOverview = /^(1|true|yes)$/i.test(String(body?.ai_overview ?? req.query.ai_overview ?? ''));
  console.log(`[Handler] Using SERP depth: ${depth}, expand_ai_overview: ${expandAiOverview}`);

  // Always resolve from the locked server-side map. Never trust client
  // `locations` — a bad/empty client map previously forced 90/90 UK unmapped
  // (SPA rewrite served HTML for the locked JSON, then the API honoured it).
  const resolveLoc = (keyword) => {
    const resolved = resolveTrackingLocation(keyword);
    const capture = resolveLocalCaptureFields(keyword, { forceCityCode });
    return {
      location_name: resolved.location_name,
      location_code: capture.location_code ?? resolved.location_code,
      location_coordinate: capture.location_coordinate,
      tier: resolved.tier,
      location_unmapped: resolved.unmapped === true,
      geo_method: capture.geo_method,
      method_version: capture.method_version,
    };
  };

  // Optional comparable baselines for confirmation (keyword → prior row).
  const baselinesIn = (body?.baselines && typeof body.baselines === 'object')
    ? body.baselines
    : {};
  const spend = createDfsSpendTracker();

  // Declared outside try so mergeVolume can close over it (const inside try is block-scoped).
  let volumeByKeyword = {};

  const mergeVolume = (keyword, result, loc) => {
    const normalizedKw = normalizeKeyword(keyword);
    const volumeData = volumeByKeyword[normalizedKw];
    const searchVolume = volumeData !== undefined
      ? (volumeData.search_volume !== undefined ? volumeData.search_volume : null)
      : null;
    return {
      ...result,
      location_name: result.location_name || loc.location_name,
      location_unmapped: loc.location_unmapped === true,
      search_volume: searchVolume,
      search_volume_trend: volumeData?.monthly_searches || undefined,
    };
  };

  const markIncompleteResult = (result) => {
    if (!result || result.fatal) return result;
    if (!(
      result.crawl_incomplete
      || !Array.isArray(result.serp_surface_stack)
      || result.serp_surface_stack.length === 0
    )) {
      return result;
    }
    result.crawl_incomplete = true;
    result.error = result.error || SERP_CRAWL_INCOMPLETE_ERROR;
    result.best_rank_group = null;
    result.best_rank_absolute = null;
    result.best_url = null;
    result.best_title = null;
    const emptyStack = !Array.isArray(result.serp_surface_stack) || result.serp_surface_stack.length === 0;
    result.serp_features = buildSerpCaptureFeatures(result.serp_features, {
      capture_status: emptyStack ? CAPTURE_STATUS.EMPTY : CAPTURE_STATUS.INCOMPLETE,
      crawl_incomplete: true,
      organic_count: result.organic_count ?? 0,
      dfs_cost: result.dfs_cost ?? null,
      se_results_count: result.se_results_count ?? null,
      serp_depth: depth,
      location_code: result.location_code,
      location_coordinate: result.location_coordinate,
      geo_method: result.serp_features?.geo_method || locGeoFallback(result),
      method_version: result.serp_features?.method_version || null,
      error: result.error,
      checked_at: new Date().toISOString(),
      best_rank_group: null,
      best_rank_absolute: null,
      serp_surface_stack: result.serp_surface_stack,
    });
    return result;
  };

  function locGeoFallback(result) {
    if (result?.location_coordinate) return 'gbp_pin';
    if (Number(result?.location_code) === 9215523) return 'coventry_city_code';
    if (Number(result?.location_code) === 2826) return 'uk_national';
    return null;
  }

  // Primary Local = GBP pin. Thin retries reuse the same capture path.
  // Significant worsenings get at most one bounded confirmation (spend-capped).
  const fetchOneKeyword = async (keyword, loc) => {
    const opts = {
      expandAiOverview,
      location_name: loc.location_name,
      location_code: loc.location_code,
      location_coordinate: loc.location_coordinate,
      tier: loc.tier,
      geo_method: loc.geo_method,
      method_version: loc.method_version,
    };
    const maxThin = spend.limits.thin_max_attempts;
    let result = null;
    for (let attempt = 1; attempt <= maxThin; attempt++) {
      const gate = spend.canAttempt();
      if (!gate.ok) {
        if (!result) {
          result = buildEmptySerpResult(
            keyword,
            depth,
            `Aborted: ${gate.reason}`,
            null,
            loc.location_name
          );
        }
        break;
      }
      result = await fetchSerpForKeyword(keyword, auth, targetRoot, depth, opts);
      spend.recordAttempt(result?.dfs_cost);
      if (result?.fatal) break;
      const incomplete = result?.crawl_incomplete === true
        || !Array.isArray(result?.serp_surface_stack)
        || result.serp_surface_stack.length === 0
        || (result?.error && isIncompleteSerpCrawl({
          depth,
          organicCount: result?.organic_count || 0,
          itemsCount: result?.organic_count || 0,
          seResultsCount: result?.se_results_count,
          cost: result?.dfs_cost,
          error: result?.error,
        }));
      if (!incomplete) break;
      if (attempt < maxThin) {
        console.warn(
          `[Handler] Incomplete DFS crawl for "${keyword}" `
          + `(organic=${result?.organic_count ?? 0}, cost=${result?.dfs_cost ?? 'n/a'}, `
          + `se_results=${result?.se_results_count ?? 'n/a'}) — retry ${attempt}/${maxThin - 1}`
        );
      }
    }
    result = markIncompleteResult(result);

    const baselineRaw = baselinesIn[keyword] || baselinesIn[normalizeKeyword(keyword)] || null;
    let confirmation = null;
    let confirmCount = 0;
    if (baselineRaw && result && !result.fatal && isSignificantWorsening(baselineRaw, result)) {
      const gate = spend.canConfirm(confirmCount);
      if (gate.ok) {
        spend.recordConfirm();
        confirmCount += 1;
        confirmation = await fetchSerpForKeyword(keyword, auth, targetRoot, depth, opts);
        spend.recordAttempt(confirmation?.dfs_cost);
        confirmation = markIncompleteResult(confirmation);
      }
    }

    const budgetExhausted = !!spend.snapshot().stopped_reason
      || (baselineRaw && isSignificantWorsening(baselineRaw, result) && !confirmation);
    const resolved = resolveConfirmationState(baselineRaw, result, confirmation, {
      budgetExhausted: budgetExhausted && !confirmation,
    });
    // Current observation = confirmation when present (latest), else primary.
    // Never pick the "best" of the two.
    const current = confirmation && !confirmation.fatal ? confirmation : result;
    if (current?.serp_features) {
      current.serp_features = buildConfirmationFeatures(current.serp_features, {
        state: resolved.state,
        baseline: baselineRaw,
        primary: result,
        confirmation,
        budgetExhausted: resolved.state === 'exhausted_budget',
      });
    }
    return current;
  };

  try {
    // Log handler entry with keywords
    console.log(`[Handler] === START === Processing ${keywords.length} keywords`);
    console.log(`[Handler] Keywords received:`, keywords);
    
    // Fetch keyword search volume (best-effort, non-blocking)
    console.log(`[Handler] Calling fetchKeywordOverview...`);
    volumeByKeyword = await fetchKeywordOverview(keywords, auth) || {};
    console.log(`[Handler] Volume map keys: ${Object.keys(volumeByKeyword).join(', ')}`);
    console.log(`[Handler] Volume map size: ${Object.keys(volumeByKeyword).length}`);

    // Process keywords in parallel with concurrency limit to speed up processing
    // IMPORTANT: Process ALL keywords, including Brand segment - do not filter
    const CONCURRENCY_LIMIT = 5; // Process 5 keywords at a time
    const perKeyword = [];
    // 2026-04-22: set true once any DFS call returns a fatal billing/auth
    // status so the remaining keywords short-circuit to empty rows instead
    // of racking up more paid failed requests.
    let dfsFatalHit = false;
    let dfsFatalReason = null;
    
    // Process keywords in batches to respect concurrency limit
    for (let i = 0; i < keywords.length; i += CONCURRENCY_LIMIT) {
      if (dfsFatalHit) {
        const remaining = keywords.slice(i);
        console.warn(`[Handler] ABORTING remaining ${remaining.length} keyword(s) after fatal DFS status: ${dfsFatalReason}`);
        remaining.forEach((kw) => {
          const loc = resolveLoc(kw);
          perKeyword.push(buildEmptySerpResult(kw, depth, `Aborted after fatal DFS error: ${dfsFatalReason}`, null, loc.location_name));
        });
        break;
      }
      const batch = keywords.slice(i, i + CONCURRENCY_LIMIT);
      console.log(`[Handler] Processing batch ${Math.floor(i / CONCURRENCY_LIMIT) + 1} (keywords ${i + 1}-${Math.min(i + CONCURRENCY_LIMIT, keywords.length)})`);
      
      const batchPromises = batch.map(async (keyword) => {
        try {
          const loc = resolveLoc(keyword);
          // Local GBP-pin series — grid PARKED (no fetchLocalGridSerp).
          const result = await fetchOneKeyword(keyword, loc);
          const mergedResult = mergeVolume(keyword, result, loc);
          console.log(`[VOL MAP] For row keyword "${keyword}" ⇒ search_volume=${mergedResult.search_volume ?? 'none'}`);
          return mergedResult;
        } catch (err) {
          console.error(`[Handler] Error processing keyword "${keyword}":`, err);
          return {
            keyword,
            best_rank_group: null,
            best_rank_absolute: null,
            best_url: null,
            best_title: null,
            has_ai_overview: false,
            serp_features: {
              local_pack: false,
              featured_snippet: false,
              people_also_ask: false,
            },
            search_volume: null,
            search_volume_trend: undefined,
            serp_depth: depth,
            error: err.message || "Error processing keyword",
          };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      perKeyword.push(...batchResults);
      // 2026-04-22 spend guard: if any result in this concurrency batch
      // flagged a fatal DFS status (402/401/403/404), stop issuing further
      // paid requests for the remaining keywords.
      const fatalResult = batchResults.find((r) => r?.fatal);
      if (fatalResult) {
        dfsFatalHit = true;
        dfsFatalReason = `${fatalResult.error_code || ''} ${fatalResult.error || ''}`.trim() || 'DFS fatal status';
      }
    }
    
    // Retry fetching search_volume for keywords that didn't get it in the initial batch
    // This handles cases where DataForSEO's batch API might miss some keywords
    // 2026-04-22: skip the retry if we already hit a fatal DFS status — no
    // point spending more credits after the account is depleted.
    const missingVolumeKeywords = dfsFatalHit
      ? []
      : perKeyword.filter(k => k.search_volume === null || k.search_volume === undefined);
    if (missingVolumeKeywords.length > 0) {
      console.log(`[Handler] Retrying search_volume fetch for ${missingVolumeKeywords.length} keywords that didn't get volume data`);
      const retryKeywords = missingVolumeKeywords.map(k => k.keyword);
      const retryVolumeMap = await fetchKeywordOverview(retryKeywords, auth);
      
      // Update perKeyword with retry results
      for (const item of perKeyword) {
        if (item.search_volume === null || item.search_volume === undefined) {
          const normalizedKw = normalizeKeyword(item.keyword);
          const retryVolumeData = retryVolumeMap[normalizedKw];
          
          if (retryVolumeData !== undefined && retryVolumeData.search_volume !== undefined) {
            item.search_volume = retryVolumeData.search_volume;
            item.search_volume_trend = retryVolumeData.monthly_searches;
            console.log(`[Handler] ✓ Retry successful for "${item.keyword}" → search_volume: ${item.search_volume}`);
          } else {
            // Try alternative normalizations (e.g., with/without extra spaces)
            const altNormalizations = [
              item.keyword.toLowerCase().trim(),
              item.keyword.toLowerCase().trim().replace(/\s+/g, ' '),
              item.keyword.toLowerCase().trim().replace(/\s{2,}/g, ' ')
            ];
            
            for (const altNorm of altNormalizations) {
              if (retryVolumeMap[altNorm] !== undefined && retryVolumeMap[altNorm].search_volume !== undefined) {
                item.search_volume = retryVolumeMap[altNorm].search_volume;
                item.search_volume_trend = retryVolumeMap[altNorm].monthly_searches;
                console.log(`[Handler] ✓ Retry successful for "${item.keyword}" (alt normalization "${altNorm}") → search_volume: ${item.search_volume}`);
                break;
              }
            }
            
            if (item.search_volume === null || item.search_volume === undefined) {
              console.log(`[Handler] ✗ Retry failed for "${item.keyword}" - DataForSEO may not have search volume data for this keyword`);
            }
          }
        }
      }
    }
    
    // Log final per-keyword payload summary
    console.log(`[Handler] Final per-keyword payload summary:`);
    perKeyword.forEach((item, idx) => {
      console.log(`  ${idx + 1}. "${item.keyword}" → search_volume: ${item.search_volume ?? 'null'}`);
    });

    // Build summary
    const totalKeywords = perKeyword.length;
    const keywordsWithRank = perKeyword.filter(
      (k) => k.best_rank_group !== null
    ).length;
    
    // Calculate tracked keyword visibility metrics (Ranking API only - not used in AI GEO pillars)
    // Filter to valid ranking rows (best_rank_group is a number, not null)
    const validRankingRows = perKeyword.filter(
      (k) => k.best_rank_group !== null && typeof k.best_rank_group === 'number'
    );
    
    let avgPositionUnweighted = null;
    let avgPositionVolumeWeighted = null;
    const keywordsUsedForAvg = validRankingRows.length;
    const keywordsWithVolume = perKeyword.filter(
      (k) => k.search_volume !== null && k.search_volume !== undefined && k.search_volume > 0
    ).length;
    
    if (validRankingRows.length >= 1) {
      // Unweighted average position (diagnostic only)
      const sumRanks = validRankingRows.reduce((sum, k) => sum + k.best_rank_group, 0);
      avgPositionUnweighted = sumRanks / validRankingRows.length;
      
      // Demand-weighted average position
      let sumWeightedRanks = 0;
      let sumVolumes = 0;
      
      for (const row of validRankingRows) {
        // Use search_volume if available; if missing or 0, use fallback of 10
        const vol = (row.search_volume !== null && row.search_volume !== undefined && row.search_volume > 0)
          ? row.search_volume
          : 10;
        
        sumWeightedRanks += row.best_rank_group * vol;
        sumVolumes += vol;
      }
      
      // Only set if sum of volumes > 0 (shouldn't happen with fallback, but guard anyway)
      if (sumVolumes > 0) {
        avgPositionVolumeWeighted = sumWeightedRanks / sumVolumes;
      }
    }

    res.status(200).json({
      summary: {
        total_keywords: totalKeywords,
        keywords_with_rank: keywordsWithRank,
        avg_position_unweighted: avgPositionUnweighted !== null ? Math.round(avgPositionUnweighted * 100) / 100 : null,
        avg_position_volume_weighted: avgPositionVolumeWeighted !== null ? Math.round(avgPositionVolumeWeighted * 100) / 100 : null,
        keywords_used_for_avg: keywordsUsedForAvg,
        keywords_with_volume: keywordsWithVolume,
        depth,
        // 2026-04-22 spend guard: surface the abort reason to the client so
        // it can stop firing subsequent batches and show a loud banner.
        dfs_fatal: dfsFatalHit,
        dfs_fatal_reason: dfsFatalReason,
      },
      spend_limits: spend.snapshot(),
      preflight: localPreflight,
      per_keyword: perKeyword,
    });
  } catch (err) {
    console.error("[SERP-RANK-TEST] Handler error:", err);
    res.status(500).json({ error: err.message || "Unexpected server error" });
  }
}

export { fetchSerpForKeyword, DEFAULT_SERP_DEPTH };
