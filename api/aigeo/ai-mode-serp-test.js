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

import { extractAiModeCitationsFromTask } from '../../lib/keyword-ranking/fetch-ai-mode-local.js';

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

    const task = data.tasks && data.tasks[0];
    res.status(200).json({ query: keyword, ...extractAiModeCitationsFromTask(task) });
  } catch (err) {
    console.error("DataForSEO error", err);
    res.status(500).json({ error: "Unexpected server error" });
  }
}

