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

      // Get all items from all result entries
      // Handle both array and single object structures
      let allItems = [];
      
      if (task.result) {
        if (Array.isArray(task.result)) {
          // Array of result objects, each with items
          allItems = task.result.flatMap(r => {
            if (r && Array.isArray(r.items)) return r.items;
            if (r && r.items) return [r.items];
            // If r itself is an item (no .items property), include it
            if (r && r.type) return [r];
            return [];
          });
        } else if (task.result.items) {
          // Single result object with items array
          allItems = Array.isArray(task.result.items) ? task.result.items : [];
        } else if (task.result.type) {
          // Result itself is an item
          allItems = [task.result];
        }
      }
      
      // Debug: log what we found
      console.log(`[DEBUG] Keyword: ${keyword}, task.result type: ${typeof task.result}, isArray: ${Array.isArray(task.result)}, allItems count: ${allItems.length}`);
      if (task.result) {
        console.log(`[DEBUG] task.result keys: ${Object.keys(task.result).join(', ')}`);
        if (Array.isArray(task.result) && task.result.length > 0) {
          console.log(`[DEBUG] First result entry keys: ${Object.keys(task.result[0]).join(', ')}`);
        }
      }

      // Debug: log item types found
      const itemTypes = [...new Set(allItems.map(i => i.type).filter(Boolean))];
      console.log(`[DEBUG] Keyword: ${keyword}, Total items: ${allItems.length}, Item types: ${itemTypes.join(', ')}`);

      // Filter organic items (broadened to include any type containing "organic")
      const organicItems = allItems.filter(i =>
        i.type && i.type.toLowerCase().includes("organic")
      );

      // Debug: log organic items found
      console.log(`[DEBUG] Organic items found: ${organicItems.length}`);
      if (organicItems.length > 0) {
        const sampleDomains = organicItems.slice(0, 5).map(i => i.domain || i.url || 'no domain/url').join(', ');
        console.log(`[DEBUG] Sample organic domains/URLs: ${sampleDomains}`);
      }

      // Find alanranger.com items (check both domain and url)
      const arItems = organicItems.filter(i =>
        (i.domain && i.domain.toLowerCase().includes("alanranger")) ||
        (i.url && i.url.toLowerCase().includes("alanranger"))
      );

      // Debug: log alanranger items found
      console.log(`[DEBUG] Alanranger items found: ${arItems.length}`);
      if (arItems.length > 0) {
        arItems.forEach(item => {
          console.log(`[DEBUG] Found: domain=${item.domain}, url=${item.url}, rank_group=${item.rank_group}, rank_absolute=${item.rank_absolute}`);
        });
      }

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
      const has_ai_overview = allItems.some((i) => i.type === "ai_overview_element");
      const has_local_pack = allItems.some((i) => i.type === "local_pack");
      const has_featured_snippet = allItems.some(
        (i) => i.type === "featured_snippet" || i.type === "answer_box"
      );
      const has_people_also_ask = allItems.some((i) => i.type === "people_also_ask");

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
        // Diagnostic info (remove in production)
        _debug: {
          total_items: allItems.length,
          organic_items: organicItems.length,
          alanranger_items: arItems.length,
          item_types: [...new Set(allItems.map(i => i.type).filter(Boolean))].slice(0, 10),
          sample_organic_domains: organicItems.slice(0, 3).map(i => i.domain || i.url || 'N/A'),
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

