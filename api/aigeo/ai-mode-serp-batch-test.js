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

  // For now use a small default set of queries if none are posted
  const defaultQueries = [
    "beginners photography course",
    "landscape photography workshops",
    "camera courses for beginners",
    "photography lessons online",
    "beginners photography classes"
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
    } catch (e) {
      // ignore parse errors; stick with default queries
    }
  }

  const endpoint =
    "https://api.dataforseo.com/v3/serp/google/ai_mode/live/advanced";

  const auth = Buffer.from(`${login}:${password}`).toString("base64");

  try {
    const dfResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(
        queries.map((keyword) => ({
          keyword,
          language_name: "English",
          location_name: "United Kingdom",
          device: "desktop",
          os: "windows",
        }))
      ),
    });

    const data = await dfResponse.json();

    if (!dfResponse.ok || data.status_code !== 20000) {
      res.status(502).json({
        error: "DataForSEO request failed",
        httpStatus: dfResponse.status,
        dfsStatus: data.status_code,
        dfsMessage: data.status_message,
      });
      return;
    }

    const tasks = data.tasks || [];

    const perQuery = tasks.map((task) => {
      const keyword = task.data && task.data.keyword
        ? task.data.keyword
        : "unknown";

      const metrics = extractCitationsFromTask(task);
      return {
        query: keyword,
        ...metrics,
      };
    });

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
  } catch (err) {
    console.error("DataForSEO error", err);
    res.status(500).json({ error: "Unexpected server error" });
  }
}

