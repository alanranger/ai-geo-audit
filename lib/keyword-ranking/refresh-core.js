/**
 * Shared helpers for pulling + persisting keyword_rankings rows.
 *
 * Consumed by:
 *   - api/cron/keyword-ranking-ai.js  (scheduled full audit)
 *   - api/aigeo/refresh-keywords.js   (ad-hoc per-keyword refresh, 1..N keywords)
 *
 * Both flows need identical DFS fetch + AI Mode fetch + row-shape construction,
 * so this module exists to avoid the two staying in lock-step by copy-paste.
 *
 * The refresh flow differs only in that it stamps `last_refreshed_at` on each
 * row before upsert; the cron does not (the audit_date / updated_at pair is
 * enough for full-audit freshness tracking). Callers control that via the
 * `stampRefreshedAt` option on `buildKeywordRows`.
 */

import { resolveTrackingLocation } from './tracking-location.js';
import { resolveKeywordClass } from './tracking-class.js';
import { resolveTrackedSegment } from './tracked-set-v3.js';
import { coalesceSearchVolume } from './ke-search-volumes.js';
import { applyTrackedEmptySerpStubs } from './empty-serp-stub.js';

// Must match serp-rank-test.js DEFAULT_SERP_DEPTH (lowered 100 → 50 for cost/speed).
// depth=100 was making each refresh keyword ~2× slower/dearer and contributing to
// the refresh HTTP 504s. Deep one-off investigations can still pass ?depth=100.
const DEFAULT_DEPTH = 50;

export const normalizeKeyword = (value) => String(value || '').trim().toLowerCase();

export function buildLocationsMap(keywords) {
  const map = {};
  for (const kw of keywords || []) {
    const loc = resolveTrackingLocation(kw);
    map[kw] = {
      location_name: loc.location_name,
      location_code: loc.location_code,
      tier: loc.tier,
      proximity_noisy: Boolean(loc.proximity_noisy),
      unmapped: Boolean(loc.unmapped),
    };
  }
  return map;
}

export const splitIntoBatches = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export const runBatches = async (items, batchSize, handler, concurrency = 4) => {
  const batches = splitIntoBatches(items, batchSize);
  const results = [];
  let index = 0;
  const workerCount = Math.max(1, Math.min(concurrency, batches.length));

  const workers = Array.from({ length: workerCount }, async () => {
    while (index < batches.length) {
      const currentIndex = index;
      index += 1;
      const batch = batches[currentIndex];
      const batchResult = await handler(batch);
      if (Array.isArray(batchResult) && batchResult.length > 0) {
        results.push(...batchResult);
      }
    }
  });

  await Promise.all(workers);
  return results;
};

export const fetchJson = async (url, options) => {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json();
};

export const fetchSerpRows = async (
  baseUrl,
  keywords,
  { batchSize = 20, concurrency = 4, depth = DEFAULT_DEPTH } = {}
) => runBatches(
  keywords,
  batchSize,
  async (batch) => {
    const serpResp = await fetchJson(
      `${baseUrl}/api/aigeo/serp-rank-test`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords: batch,
          depth,
          locations: buildLocationsMap(batch),
        })
      }
    );
    return Array.isArray(serpResp?.per_keyword) ? serpResp.per_keyword : [];
  },
  concurrency
);

export const fetchAiRows = async (
  baseUrl,
  keywords,
  { batchSize = 10, concurrency = 4 } = {}
) => runBatches(
  keywords,
  batchSize,
  async (batch) => {
    const aiResp = await fetchJson(`${baseUrl}/api/aigeo/ai-mode-serp-batch-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queries: batch,
        locations: buildLocationsMap(batch),
      })
    });
    return Array.isArray(aiResp?.per_query) ? aiResp.per_query : [];
  },
  concurrency
);

// Phase 1: build the per-engine `ai_engines` JSONB from the two upstream calls.
// serp-rank-test returns an already-normalised engine-slot shape on
// `row.ai_overview_citations`; ai-mode-serp-batch-test still uses the legacy
// field names, which we convert to the same slot shape here.
const buildGoogleAioSlot = (serpRow) => {
  const slot = serpRow?.ai_overview_citations;
  if (slot && typeof slot === 'object') return slot;
  return null;
};

const buildGoogleAiModeSlot = (aiRow) => {
  if (!aiRow || typeof aiRow !== 'object') return null;
  const citationsRaw = Array.isArray(aiRow.alanranger_citations)
    ? aiRow.alanranger_citations
    : [];
  return {
    present: Boolean(aiRow.has_ai_overview),
    total_citations: Number(aiRow.total_citations || 0),
    alan_citations_count: Number(aiRow.alanranger_citations_count || 0),
    alan_citations: citationsRaw,
    sample_citations: Array.isArray(aiRow.sample_citations) ? aiRow.sample_citations : [],
    checked_at: new Date().toISOString(),
  };
};

export const buildAiEngines = (serpRow, aiRow) => {
  const engines = {};
  const aio = buildGoogleAioSlot(serpRow);
  if (aio) engines.google_aio = aio;
  const aiMode = buildGoogleAiModeSlot(aiRow);
  if (aiMode) engines.google_ai_mode = aiMode;
  return Object.keys(engines).length > 0 ? engines : null;
};

/**
 * Fuse SERP + AI Mode responses for a set of keywords into the combined row
 * shape the dashboard expects. Returns one entry per SERP row (which is the
 * canonical source of truth for keyword coverage).
 */
export const buildCombinedRows = (serpRows, aiRows) => {
  const aiMap = new Map(aiRows.map((row) => [normalizeKeyword(row?.query), row]));
  return serpRows.map((row) => {
    const keyword = row?.keyword || '';
    const ai = aiMap.get(normalizeKeyword(keyword)) || {};
    const loc = resolveTrackingLocation(keyword);
    const locationName = row?.location_name || ai?.location_name || loc.location_name;
    const classInfo = resolveKeywordClass(keyword);
    const segment = resolveTrackedSegment(keyword, classInfo.keyword_class, row?.segment);
    return {
      keyword,
      location_name: locationName,
      proximity_noisy: Boolean(loc.proximity_noisy),
      location_unmapped: Boolean(loc.unmapped),
      keyword_class: row?.keyword_class || classInfo.keyword_class,
      class_unmapped: row?.class_unmapped === true || classInfo.class_unmapped,
      segment,
      segment_source: 'manual',
      segment_confidence: 1,
      segment_reason: 'tracked-set: brand or money (2026-07-14)',
      best_rank_group: row?.best_rank_group ?? null,
      best_rank_absolute: row?.best_rank_absolute ?? null,
      best_url: row?.best_url || null,
      best_title: row?.best_title || null,
      has_ai_overview: Boolean(row?.has_ai_overview || ai?.has_ai_overview),
      ai_total_citations: ai?.total_citations ?? 0,
      ai_alan_citations_count: ai?.alanranger_citations_count ?? 0,
      ai_alan_citations: ai?.alanranger_citations || [],
      serp_features: row?.serp_features || null,
      ai_overview_present_any: row?.ai_overview_present_any ?? row?.has_ai_overview ?? false,
      local_pack_present_any: row?.local_pack_present_any ?? false,
      paa_present_any: row?.paa_present_any ?? false,
      featured_snippet_present_any: row?.featured_snippet_present_any ?? false,
      local_pack_position: row?.local_pack_position ?? null,
      kp_present: row?.kp_present === true,
      kp_ours: row?.kp_ours === true,
      featured_snippet_ours: row?.featured_snippet_ours === true,
      paa_ours: row?.paa_ours === true,
      search_volume: coalesceSearchVolume(keyword, row?.search_volume ?? null),
      serp_depth: row?.serp_depth ?? null,
      serp_surface_stack: row?.serp_surface_stack ?? null,
      ai_engines: buildAiEngines(row, ai)
    };
  });
};

export const buildSummary = (combinedRows) => ({
  total_keywords: combinedRows.length,
  keywords_with_rank: combinedRows.filter((r) => r.best_rank_group !== null && r.best_rank_group !== undefined).length,
  keywords_with_ai_overview: combinedRows.filter((r) => r.has_ai_overview).length,
  keywords_where_alanranger_cited: combinedRows.filter((r) => r.ai_alan_citations_count > 0).length,
  keywords_top_3: combinedRows.filter((r) => r.best_rank_group !== null && r.best_rank_group <= 3).length,
  keywords_top_10: combinedRows.filter((r) => r.best_rank_group !== null && r.best_rank_group <= 10).length
});

/**
 * Project combinedRows into the exact shape `keyword_rankings` expects.
 * When `stampRefreshedAt` is truthy, every row carries a `last_refreshed_at`
 * timestamp (used by the ad-hoc refresh flow so the UI can show freshness).
 */
export const buildKeywordRows = (combinedRows, auditDate, propertyUrl, { stampRefreshedAt = false } = {}) => {
  const refreshedAt = stampRefreshedAt ? new Date().toISOString() : null;
  const mapped = combinedRows.map((row) => {
    const payload = {
      audit_date: auditDate,
      property_url: propertyUrl,
      keyword: row.keyword,
      location_name: row.location_name || null,
      location_unmapped: row.location_unmapped === true,
      keyword_class: row.keyword_class || null,
      class_unmapped: row.class_unmapped === true,
      segment: row.segment,
      segment_source: row.segment_source,
      segment_confidence: row.segment_confidence,
      segment_reason: row.segment_reason,
      best_rank_group: row.best_rank_group,
      best_rank_absolute: row.best_rank_absolute,
      best_url: row.best_url,
      best_title: row.best_title,
      has_ai_overview: row.has_ai_overview,
      ai_total_citations: row.ai_total_citations,
      ai_alan_citations_count: row.ai_alan_citations_count,
      ai_alan_citations: row.ai_alan_citations,
      serp_features: row.serp_features,
      ai_overview_present_any: row.ai_overview_present_any,
      local_pack_present_any: row.local_pack_present_any,
      paa_present_any: row.paa_present_any,
      featured_snippet_present_any: row.featured_snippet_present_any,
      local_pack_position: row.local_pack_position ?? null,
      kp_present: row.kp_present === true,
      kp_ours: row.kp_ours === true,
      featured_snippet_ours: row.featured_snippet_ours === true,
      paa_ours: row.paa_ours === true,
      search_volume: row.search_volume,
      serp_surface_stack: (Array.isArray(row.serp_surface_stack) && row.serp_surface_stack.length > 0)
        ? row.serp_surface_stack
        : null,
      ai_engines: row.ai_engines || null,
      error: row.error || null,
    };
    if (refreshedAt) payload.last_refreshed_at = refreshedAt;
    return payload;
  });
  // LOCKED tracked keywords with empty SERP → stub (error gate) instead of drop.
  return applyTrackedEmptySerpStubs(mapped);
};

export const deleteKeywordRowsForDate = async (propertyUrl, auditDate) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase not configured for deleteKeywordRowsForDate');
  }
  const response = await fetch(
    `${supabaseUrl}/rest/v1/keyword_rankings?audit_date=eq.${encodeURIComponent(auditDate)}&property_url=eq.${encodeURIComponent(propertyUrl)}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'return=representation',
      },
    }
  );
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to delete keyword rows for ${auditDate}: HTTP ${response.status} ${text}`);
  }
  const deletedText = await response.text();
  const deleted = deletedText ? JSON.parse(deletedText) : [];
  return Array.isArray(deleted) ? deleted.length : 0;
};

export const saveKeywordBatch = async (baseUrl, payload) => {
  await fetchJson(`${baseUrl}/api/supabase/save-keyword-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
};

/**
 * Derive the absolute base URL for internal function-to-function HTTPS calls
 * from the inbound request. Vercel provides `x-forwarded-host` + `x-forwarded-proto`
 * in preview/production; local dev falls back to req.headers.host.
 */
export const resolveBaseUrl = (req) => {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) throw new Error('Cannot resolve base URL: missing host header');
  return `${proto}://${host}`;
};

export const DEFAULT_REFRESH_DEPTH = DEFAULT_DEPTH;
