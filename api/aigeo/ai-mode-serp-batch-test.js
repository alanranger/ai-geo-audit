// /api/aigeo/ai-mode-serp-batch-test.js

function extractCitationsFromTask(task) {
  const result = task && task.result && task.result[0];
  const items = (result && result.items) || [];

  const aiOverview = items.find((item) => item.type === "ai_overview");

  let rawRefs = [];
  if (aiOverview && Array.isArray(aiOverview.references)) {
    rawRefs = aiOverview.references;
  }

  // Fallback: also look for links inside ai_overview items
  if ((!rawRefs || rawRefs.length === 0) && aiOverview && Array.isArray(aiOverview.items)) {
    for (const el of aiOverview.items) {
      if (!el.links) continue;
      for (const link of el.links) {
        rawRefs.push({
          source: link.title || null,
          domain: link.domain || null,
          url: link.url || null,
          title: link.title || null,
          text: null,
        });
      }
    }
  }

  const byUrl = {};
  for (const ref of rawRefs) {
    if (!ref || !ref.url) continue;
    const url = ref.url;
    let domain = ref.domain;
    if (!domain) {
      try {
        domain = new URL(url).hostname;
      } catch {
        domain = null;
      }
    }
    if (!byUrl[url]) {
      byUrl[url] = {
        source: ref.source || null,
        title: ref.title || null,
        url,
        domain,
      };
    }
  }

  const citations = Object.values(byUrl);
  const alanCitations = citations.filter((c) =>
    c.domain ? c.domain.includes("alanranger.com") : c.url.includes("alanranger.com")
  );

  return {
    has_ai_overview: !!aiOverview,
    total_citations: citations.length,
    alanranger_citations_count: alanCitations.length,
    alanranger_citations: alanCitations,
    sample_citations: citations.slice(0, 10),
  };
}

async function fetchAiModeForKeyword(keyword, auth) {
  const endpoint =
    "https://api.dataforseo.com/v3/serp/google/ai_mode/live/advanced";

  const dfResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify([
      {
        keyword,
        language_name: "English",
        location_name: "United Kingdom",
        device: "desktop",
        os: "windows",
      },
    ]),
  });

  let data;
  try {
    data = await dfResponse.json();
  } catch (parseError) {
    console.error(`[AI Mode] Failed to parse DataForSEO response for "${keyword}":`, parseError.message);
    return {
      query: keyword,
      has_ai_overview: false,
      total_citations: 0,
      alanranger_citations_count: 0,
      alanranger_citations: [],
      sample_citations: [],
      error: `Failed to parse response: ${parseError.message}`,
    };
  }

  if (!dfResponse.ok || data.status_code !== 20000) {
    console.error(`[AI Mode] DataForSEO API error for "${keyword}":`, data.status_message || `HTTP ${dfResponse.status}`);
    return {
      query: keyword,
      has_ai_overview: false,
      total_citations: 0,
      alanranger_citations_count: 0,
      alanranger_citations: [],
      sample_citations: [],
      error: data.status_message || `DataForSEO request failed (HTTP ${dfResponse.status})`,
    };
  }

  const tasks = data.tasks || [];
  if (!tasks.length || !tasks[0].result || !tasks[0].result.length) {
    return {
      query: keyword,
      has_ai_overview: false,
      total_citations: 0,
      alanranger_citations_count: 0,
      alanranger_citations: [],
      sample_citations: [],
      error: "No result items",
    };
  }

  const metrics = extractCitationsFromTask(tasks[0]);
  return {
    query: keyword,
    ...metrics,
  };
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

  // Default set for now; can later be imported from a shared module
  const defaultQueries = [
    "beginners photography classes",
    "photography lessons online",
    "camera courses for beginners",
    "alan ranger",
    "beginners photography course",
  ];

  let queries = defaultQueries;

  if (req.method === "POST") {
    try {
      const body = await new Promise((resolve, reject) => {
        let raw = "";
        req.on("data", (chunk) => (raw += chunk));
        req.on("end", () => {
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch (e) {
            reject(e);
          }
        });
      });
      if (Array.isArray(body.queries) && body.queries.length > 0) {
        queries = body.queries.map(String);
      }
    } catch {
      // ignore parse errors; keep default queries
    }
  }

  const auth = Buffer.from(`${login}:${password}`).toString("base64");

  const perQuery = [];
  for (const keyword of queries) {
    try {
      const result = await fetchAiModeForKeyword(keyword, auth);
      perQuery.push(result);
    } catch (err) {
      console.error(`[AI Mode] Error processing keyword "${keyword}":`, err.message);
      console.error(`[AI Mode] Stack:`, err.stack);
      perQuery.push({
        query: keyword,
        has_ai_overview: false,
        total_citations: 0,
        alanranger_citations_count: 0,
        alanranger_citations: [],
        sample_citations: [],
        error: err.message || "Unexpected server error",
      });
    }
  }

  const totalQueries = perQuery.length;
  const withAi = perQuery.filter((q) => q.has_ai_overview).length;
  const whereCited = perQuery.filter((q) => q.alanranger_citations_count > 0).length;

  res.status(200).json({
    summary: {
      total_queries: totalQueries,
      queries_with_ai_overview: withAi,
      queries_where_alanranger_cited: whereCited,
    },
    per_query: perQuery,
  });
}
