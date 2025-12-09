/**
 * DataForSEO AI Mode SERP Test API
 * 
 * Test endpoint to call DataForSEO AI Mode Live Advanced API and return a compact summary.
 * Extracts AI Mode citations and checks if alanranger.com is cited.
 * 
 * Returns:
 * - has_ai_overview: boolean indicating if AI Mode appeared
 * - total_citations: count of unique citation URLs
 * - alanranger_citations_count: count of alanranger.com citations
 * - alanranger_citations: array of alanranger.com citations
 * - sample_citations: first 10 citations for inspection
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

  // Allow GET for easy testing
  const keyword =
    (req.query.keyword && String(req.query.keyword)) ||
    "photography courses coventry";

  // DataForSEO AI Mode Live Advanced endpoint
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
      // Live method accepts an array with one task
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

    // ---- Extract AI Mode citations from ai_overview.references ----
    const task = data.tasks && data.tasks[0];
    const result = task && task.result && task.result[0];
    const items = (result && result.items) || [];

    // Find the ai_overview item
    const aiOverview = items.find((item) => item.type === "ai_overview");

    let rawRefs = [];
    if (aiOverview && Array.isArray(aiOverview.references)) {
      rawRefs = aiOverview.references;
    }

    // Fallback: also look through ai_overview elements for links, just in case
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

    // Normalise + dedupe by URL
    const byUrl = {};
    for (const ref of rawRefs) {
      if (!ref || !ref.url) continue;
      const url = ref.url;
      const domain =
        ref.domain ||
        (() => {
          try {
            return new URL(url).hostname;
          } catch {
            return null;
          }
        })();

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

    res.status(200).json({
      query: keyword,
      has_ai_overview: !!aiOverview,
      total_citations: citations.length,
      alanranger_citations_count: alanCitations.length,
      alanranger_citations: alanCitations,
      sample_citations: citations.slice(0, 10),
    });
  } catch (err) {
    console.error("DataForSEO error", err);
    res.status(500).json({ error: "Unexpected server error" });
  }
}

