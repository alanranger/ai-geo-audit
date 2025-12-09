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

  try {
    // Build tasks array for all keywords
    const tasks = keywords.map((keyword) => ({
      keyword,
      location_name: "United Kingdom",
      language_code: "en",
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
      body: JSON.stringify({ tasks }),
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

      // Guard for missing result
      if (!task.result || !Array.isArray(task.result) || task.result.length === 0) {
        perKeyword.push({
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
        });
        continue;
      }

      // Use first result entry
      const result = task.result[0];
      const items = result.items || [];

      // Filter organic items
      const organicItems = items.filter((i) => i.type === "organic");

      // Find alanranger.com items
      const arItems = organicItems.filter((i) =>
        (i.domain || "").includes("alanranger.com")
      );

      let bestRankGroup = null;
      let bestRankAbsolute = null;
      let bestUrl = null;
      let bestTitle = null;

      if (arItems.length > 0) {
        // Find item with smallest rank_group (fallback to rank_absolute)
        let bestItem = arItems[0];
        let bestRank = bestItem.rank_group !== undefined 
          ? bestItem.rank_group 
          : (bestItem.rank_absolute !== undefined ? bestItem.rank_absolute : Infinity);

        for (const item of arItems) {
          const rank = item.rank_group !== undefined
            ? item.rank_group
            : (item.rank_absolute !== undefined ? item.rank_absolute : Infinity);
          
          if (rank < bestRank) {
            bestRank = rank;
            bestItem = item;
          }
        }

        bestRankGroup = bestItem.rank_group !== undefined ? bestItem.rank_group : null;
        bestRankAbsolute = bestItem.rank_absolute !== undefined ? bestItem.rank_absolute : null;
        bestUrl = bestItem.url || null;
        bestTitle = bestItem.title || null;
      }

      // Derive SERP features
      const has_ai_overview = items.some((i) => i.type === "ai_overview_element");
      const has_local_pack = items.some((i) => i.type === "local_pack");
      const has_featured_snippet = items.some(
        (i) => i.type === "featured_snippet" || i.type === "answer_box"
      );
      const has_people_also_ask = items.some((i) => i.type === "people_also_ask");

      perKeyword.push({
        keyword,
        best_rank_group: bestRankGroup,
        best_rank_absolute: bestRankAbsolute,
        best_url: bestUrl,
        best_title: bestTitle,
        has_ai_overview,
        serp_features: {
          local_pack: has_local_pack,
          featured_snippet: has_featured_snippet,
          people_also_ask: has_people_also_ask,
        },
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

