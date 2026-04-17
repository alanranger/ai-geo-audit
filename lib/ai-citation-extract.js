// Shared AI-citation extractor.
// Parses DataForSEO `ai_overview` items (from either the organic SERP response
// with load_async_ai_overview enabled, or from the google/ai_mode endpoint)
// into a normalised citation struct.

const ALAN_DOMAIN_DEFAULT = 'alanranger.com';

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function refFromLink(link) {
  return {
    source: link?.title || null,
    domain: link?.domain || null,
    url: link?.url || null,
    title: link?.title || null,
    text: null,
  };
}

function collectReferencesFromLinks(aiOverview) {
  const refs = [];
  const elements = Array.isArray(aiOverview?.items) ? aiOverview.items : [];
  for (const el of elements) {
    if (!Array.isArray(el?.links)) continue;
    for (const link of el.links) {
      if (!link?.url) continue;
      refs.push(refFromLink(link));
    }
  }
  return refs;
}

function pickRawReferences(aiOverview) {
  if (!aiOverview) return [];
  if (Array.isArray(aiOverview.references) && aiOverview.references.length > 0) {
    return aiOverview.references;
  }
  return collectReferencesFromLinks(aiOverview);
}

function dedupeByUrl(rawRefs) {
  const byUrl = {};
  for (const ref of rawRefs) {
    if (!ref?.url) continue;
    const url = ref.url;
    const domain = ref.domain || safeHostname(url);
    if (!byUrl[url]) {
      byUrl[url] = {
        source: ref.source || null,
        title: ref.title || null,
        url,
        domain,
      };
    }
  }
  return Object.values(byUrl);
}

function isAlanCitation(c, alanDomain) {
  const needle = alanDomain || ALAN_DOMAIN_DEFAULT;
  if (c.domain) return c.domain.toLowerCase().includes(needle);
  return (c.url || '').toLowerCase().includes(needle);
}

/**
 * Extract normalised citation data from a single DFS `ai_overview` item.
 * Returns the engine-slot shape used in `keyword_rankings.ai_engines`:
 *   { present, total_citations, alan_citations_count, alan_citations,
 *     sample_citations, checked_at }
 */
export function extractCitationsFromAiOverviewItem(aiOverview, alanDomain) {
  if (!aiOverview) {
    return {
      present: false,
      total_citations: 0,
      alan_citations_count: 0,
      alan_citations: [],
      sample_citations: [],
      checked_at: new Date().toISOString(),
    };
  }
  const rawRefs = pickRawReferences(aiOverview);
  const citations = dedupeByUrl(rawRefs);
  const alan = citations.filter((c) => isAlanCitation(c, alanDomain));
  return {
    present: true,
    total_citations: citations.length,
    alan_citations_count: alan.length,
    alan_citations: alan,
    sample_citations: citations.slice(0, 10),
    checked_at: new Date().toISOString(),
  };
}

/**
 * Find the `ai_overview` item inside a DFS `result[0]` object and extract it.
 * Works for both /serp/google/organic/live/advanced (with AIO flags) and
 * /serp/google/ai_mode/live/advanced responses.
 */
export function extractCitationsFromDfsResult(result, alanDomain) {
  const items = Array.isArray(result?.items) ? result.items : [];
  const aiOverview = items.find((it) => it?.type === 'ai_overview');
  return extractCitationsFromAiOverviewItem(aiOverview, alanDomain);
}

/**
 * Legacy-shape helper so existing ai-mode-serp-batch-test consumers keep working.
 * Returns the old key names (`has_ai_overview`, `alanranger_citations_count`, etc.)
 */
export function toLegacyShape(engineSlot) {
  return {
    has_ai_overview: !!engineSlot?.present,
    total_citations: engineSlot?.total_citations || 0,
    alanranger_citations_count: engineSlot?.alan_citations_count || 0,
    alanranger_citations: engineSlot?.alan_citations || [],
    sample_citations: engineSlot?.sample_citations || [],
  };
}
