// Shared read/write helper for the Revenue Truth payload cache.
//
// The diagnosis (~12-26s) and findings (~8s) endpoints recompute heavy Supabase
// aggregations on every request. Their inputs (Booking Sheet + GSC data) only
// change on the daily sync crons or on a manual Booking Sheet upload, so we
// precompute the payloads into `public.revenue_truth_payload_cache` and serve
// the cached blob. A TTL guard bounds staleness if the warming cron is missed,
// and the cached row also doubles as a stale-fallback when a live build fails
// (which is what used to surface as an intermittent HTTP 500).

const TABLE = 'revenue_truth_payload_cache';
const DEFAULT_TTL_MS = 26 * 60 * 60 * 1000; // 26h: longer than the daily cron gap

export function diagnosisCacheKey(opts) {
  return [
    'diagnosis',
    'w' + opts.windowMonths,
    'min' + opts.minImpressions,
    'jlr' + (opts.includeJlr ? 1 : 0),
    'event' + (opts.includeEvent ? 1 : 0)
  ].join(':');
}

export function findingsCacheKey() {
  return 'findings:v1';
}

export async function readCache(supabase, propertyUrl, cacheKey, opts = {}) {
  const ttlMs = opts.ttlMs == null ? DEFAULT_TTL_MS : opts.ttlMs;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('payload, computed_at')
      .eq('property_url', propertyUrl)
      .eq('cache_key', cacheKey)
      .maybeSingle();
    if (error || !data) return null;
    const ageMs = Date.now() - new Date(data.computed_at).getTime();
    return {
      payload: data.payload,
      computedAt: data.computed_at,
      ageMs,
      fresh: Number.isFinite(ttlMs) ? ageMs <= ttlMs : true
    };
  } catch (_e) {
    return null;
  }
}

export async function writeCache(supabase, propertyUrl, cacheKey, payload, buildMs) {
  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert({
        property_url: propertyUrl,
        cache_key: cacheKey,
        payload,
        computed_at: new Date().toISOString(),
        build_ms: Number.isFinite(buildMs) ? Math.round(buildMs) : null
      }, { onConflict: 'property_url,cache_key' });
    return !error;
  } catch (_e) {
    return false;
  }
}

export async function invalidateCache(supabase, propertyUrl) {
  try {
    await supabase.from(TABLE).delete().eq('property_url', propertyUrl);
    return true;
  } catch (_e) {
    return false;
  }
}

// Generic resolver: fresh cache -> live build (write-through) -> stale fallback.
// `build` is an async () => payload. `cacheable` lets callers bypass caching for
// param-specific requests (e.g. ?pages=…) that should never be cached.
export async function resolveWithCache(supabase, propertyUrl, cacheKey, build, opts = {}) {
  const cacheable = opts.cacheable !== false;
  if (cacheable) {
    const hit = await readCache(supabase, propertyUrl, cacheKey);
    if (hit && hit.fresh) {
      return { ...hit.payload, _cache: { hit: true, computedAt: hit.computedAt, ageMs: hit.ageMs } };
    }
  }
  try {
    const t0 = Date.now();
    const payload = await build();
    const builtMs = Date.now() - t0;
    if (cacheable) await writeCache(supabase, propertyUrl, cacheKey, payload, builtMs);
    return { ...payload, _cache: { hit: false, builtMs } };
  } catch (err) {
    if (cacheable) {
      const stale = await readCache(supabase, propertyUrl, cacheKey, { ttlMs: Infinity });
      if (stale) {
        return { ...stale.payload, _cache: { hit: true, stale: true, computedAt: stale.computedAt, ageMs: stale.ageMs } };
      }
    }
    throw err;
  }
}
