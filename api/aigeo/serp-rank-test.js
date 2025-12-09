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

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
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

  if (keywords.length === 0) {
    res.status(400).json({
      error: "keyword or keywords is required",
    });
    return;
  }

  const endpoint =
    "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";

  const auth = Buffer.from(`${login}:${password}`).toString("base64");

  // Normalize target domain
  const targetRoot = normalizeDomain(
    process.env.AI_GEO_DOMAIN || "https://www.alanranger.com"
  );

  try {
    // Build tasks array - body should be a JSON array directly, not { tasks: [...] }
    const tasks = keywords.map((keyword) => ({
      keyword,
      language_code: "en",
      location_code: 2826, // United Kingdom
      device: "desktop",
      os: "windows",
      depth: 50,
    }));

    const dfResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(tasks), // Array directly, not { tasks: tasks }
    });

    const data = await dfResponse.json();

    if (!dfResponse.ok || !String(data.status_code).startsWith("200")) {
      res.status(502).json({
        error: "DataForSEO request failed",
        httpStatus: dfResponse.status,
        dfsStatus: data.status_code,
        dfsMessage: data.status_message || "Unknown error",
      });
      return;
    }

    const perKeyword = [];

    // Process each task result
    const tasksData = data.tasks || [];
    for (let i = 0; i < tasksData.length; i++) {
      const task = tasksData[i];
      const keyword = task.data && task.data.keyword ? task.data.keyword : keywords[i] || "unknown";

      // Extract result structure: data.tasks[0].result[0]
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

      perKeyword.push({
        keyword,
        best_rank_group: bestRankGroup,
        best_rank_absolute: bestRankAbsolute,
        best_url: bestUrl,
        best_title: bestTitle,
        has_ai_overview: hasAiOverview,
        serp_features: serpFeatures,
      });
    }

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
