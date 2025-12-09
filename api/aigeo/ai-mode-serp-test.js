/**
 * DataForSEO AI Mode SERP Test API
 * 
 * Test endpoint to call DataForSEO AI Mode Live Advanced API once and return raw result.
 * Useful for testing DataForSEO integration and inspecting response structure.
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
    "photography workshops Coventry";

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
        raw: data,
      });
      return;
    }

    // For now just return the full response so we can inspect it
    res.status(200).json(data);
  } catch (err) {
    console.error("DataForSEO error", err);
    res.status(500).json({ error: "Unexpected server error", details: err.message });
  }
}

