/**
 * DataForSEO Organic SERP Rank Test API
 * 
 * Test endpoint to fetch classic organic rankings and SERP features per keyword.
 * Uses DataForSEO Google Organic SERP Live Advanced API.
 * 
 * Returns:
 * - best_rank_group: best ranking group for alanranger.com (if found)
 * - best_rank_absolute: best absolute rank for alanranger.com (if found)
 * - best_url: URL of best ranking page
 * - best_title: title of best ranking page
 * - has_ai_overview: whether AI overview element appeared
 * - serp_features: object with local_pack, featured_snippet, people_also_ask flags
 */

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
 * Fetch keyword search volume from DataForSEO Labs Keyword Overview
 * Returns a map: keyword (normalized) -> { search_volume, monthly_searches }
 */
async function fetchKeywordOverview(keywords, auth) {
  const endpoint = "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live";
  
  try {
    // Log ALL keywords being sent to DataForSEO with [VOL] prefix
    console.log(`[VOL] Sending keywords to search_volume:`, keywords);
    console.log(`[Keyword Overview] Sending ${keywords.length} keywords to DataForSEO:`);
    keywords.forEach((kw, idx) => {
      console.log(`  ${idx + 1}. "${kw}" (normalized: "${normalizeKeyword(kw)}")`);
    });
    
    // Log request body to verify no filtering/deduplication issues
    const requestBody = {
      keywords: keywords,
      language_code: "en",
      location_code: 2826, // United Kingdom
    };
    console.log(`[VOL] Request body to DataForSEO:`, JSON.stringify(requestBody));
    
    const dfResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify([requestBody]),
    });

    const data = await dfResponse.json();

    console.log(`[Keyword Overview] Response status: ${dfResponse.status}, API status_code: ${data.status_code}`);
    
    if (!dfResponse.ok || !String(data.status_code).startsWith("200")) {
      console.error("[Keyword Overview] API error:", {
        status_code: data.status_code,
        status_message: data.status_message,
        full_response: JSON.stringify(data).substring(0, 500)
      });
      return {};
    }

    // Handle DataForSEO response structure
    // Structure can be: data.tasks[0].result[0].items[] OR data.tasks[0].result.items[]
    const task = data.tasks?.[0];
    if (!task) {
      console.error("[Keyword Overview] No task found in response:", JSON.stringify(data).substring(0, 500));
      return {};
    }

    // Try both possible structures
    let items = [];
    if (Array.isArray(task.result) && task.result.length > 0) {
      // Structure: tasks[0].result[0].items[]
      items = task.result[0]?.items || [];
    } else if (task.result && Array.isArray(task.result.items)) {
      // Structure: tasks[0].result.items[]
      items = task.result.items;
    } else if (task.result && !Array.isArray(task.result)) {
      // Structure: tasks[0].result.items[] (result is object, not array)
      items = task.result.items || [];
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
      // DataForSEO Labs API structure can vary:
      // - item.keyword (direct)
      // - item.keyword_info.keyword
      // - item.keyword_info might be an object with keyword property
      const kw = item.keyword || item.keyword_info?.keyword || (typeof item.keyword_info === 'string' ? item.keyword_info : null);
      
      if (!kw) {
        console.warn("[Keyword Overview] Item missing keyword. Item keys:", Object.keys(item));
        console.warn("[Keyword Overview] Item sample:", JSON.stringify(item).substring(0, 300));
        continue;
      }
      
      const normalizedKw = normalizeKeyword(kw);
      
      // Search volume can be at: item.keyword_info.search_volume OR item.search_volume
      // IMPORTANT: Treat 0 as a valid value, only use null if truly missing
      const searchVolume = item.keyword_info?.search_volume !== undefined 
        ? item.keyword_info.search_volume 
        : (item.search_volume !== undefined ? item.search_volume : null);
      const monthlySearches = item.keyword_info?.monthly_searches || item.monthly_searches || undefined;

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

async function fetchSerpForKeyword(keyword, auth, targetRoot) {
  const endpoint =
    "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";

  try {
    const dfResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify([
        {
          keyword,
          language_code: "en",
          location_code: 2826, // United Kingdom
          device: "desktop",
          os: "windows",
          depth: 50,
        },
      ]),
    });

    const data = await dfResponse.json();

    if (!dfResponse.ok || !String(data.status_code).startsWith("200")) {
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
        error: data.status_message || "DataForSEO request failed",
      };
    }

    const task = data.tasks?.[0];
    const result = task?.result?.[0];
    const items = result?.items ?? [];

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
    
    const serpFeatures = {
      local_pack: itemTypes.includes("local_pack"),
      featured_snippet: itemTypes.includes("featured_snippet"),
      people_also_ask: itemTypes.includes("people_also_ask"),
    };

    const hasAiOverview = itemTypes.includes("ai_overview");

    return {
      keyword,
      best_rank_group: bestRankGroup,
      best_rank_absolute: bestRankAbsolute,
      best_url: bestUrl,
      best_title: bestTitle,
      has_ai_overview: hasAiOverview,
      serp_features: serpFeatures,
    };
  } catch (err) {
    console.error(`Error fetching SERP for keyword "${keyword}":`, err);
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
      error: "Unexpected server error",
    };
  }
}

export default async function handler(req, res) {
  // Log handler entry immediately
  console.log(`[SERP-RANK-TEST] Handler called - Method: ${req.method}, Query:`, req.query);
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    console.log(`[SERP-RANK-TEST] OPTIONS preflight request`);
    return res.status(200).end();
  }

  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    res.status(500).json({
      error: "DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD env vars are missing",
    });
    return;
  }

  // Parse keyword or keywords query param
  let keywords = [];
  
  if (req.query.keyword) {
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

  const auth = Buffer.from(`${login}:${password}`).toString("base64");

  // Normalize target domain
  const targetRoot = normalizeDomain(
    process.env.AI_GEO_DOMAIN || "https://www.alanranger.com"
  );

  try {
    // Log handler entry with keywords
    console.log(`[Handler] === START === Processing ${keywords.length} keywords`);
    console.log(`[Handler] Keywords received:`, keywords);
    
    // Fetch keyword search volume (best-effort, non-blocking)
    console.log(`[Handler] Calling fetchKeywordOverview...`);
    const volumeByKeyword = await fetchKeywordOverview(keywords, auth);
    console.log(`[Handler] Volume map keys: ${Object.keys(volumeByKeyword).join(', ')}`);
    console.log(`[Handler] Volume map size: ${Object.keys(volumeByKeyword).length}`);

    // Call DataForSEO once per keyword (required by Live API)
    // IMPORTANT: Process ALL keywords, including Brand segment - do not filter
    const perKeyword = [];
    for (const keyword of keywords) {
      const result = await fetchSerpForKeyword(keyword, auth, targetRoot);
      
      // Merge search volume data using normalized keyword lookup
      const normalizedKw = normalizeKeyword(keyword);
      const volumeData = volumeByKeyword[normalizedKw];
      
      // IMPORTANT: Treat 0 as a valid value, only use null if key doesn't exist in map
      const searchVolume = volumeData !== undefined 
        ? (volumeData.search_volume !== undefined ? volumeData.search_volume : null)
        : null;
      const searchVolumeTrend = volumeData?.monthly_searches || undefined;
      
      // Log mapping for each row
      console.log(`[VOL MAP] For row keyword "${keyword}" (normalized "${normalizedKw}") ⇒ search_volume=${searchVolume !== null && searchVolume !== undefined ? searchVolume : 'none'}`);
      
      const mergedResult = {
        ...result,
        search_volume: searchVolume, // Can be 0, null, or a number
        search_volume_trend: searchVolumeTrend,
      };
      
      if (mergedResult.search_volume !== null && mergedResult.search_volume !== undefined) {
        console.log(`[Handler] ✓ Merged "${keyword}" (normalized: "${normalizedKw}") with volume: ${mergedResult.search_volume}`);
      } else {
        console.log(`[Handler] ✗ No search_volume found for keyword "${keyword}" (normalized: "${normalizedKw}")`);
        console.log(`[Handler] Available keys in volume map: ${Object.keys(volumeByKeyword).map(k => `"${k}"`).join(', ')}`);
      }
      
      perKeyword.push(mergedResult);
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

    res.status(200).json({
      summary: {
        total_keywords: totalKeywords,
        keywords_with_rank: keywordsWithRank,
      },
      per_keyword: perKeyword,
    });
  } catch (err) {
    console.error("DataForSEO error", err);
    res.status(500).json({ error: "Unexpected server error" });
  }
}
