/**
 * DataForSEO Labs "domain rank overview" test endpoint
 *
 * GET /api/aigeo/domain-rank-test?domain=alanranger.com&debug=1
 *
 * Uses: /v3/dataforseo_labs/google/domain_rank_overview/live
 * NOTE: This route must not depend on any Backlinks API endpoints.
 */

function getDataForSeoAuth() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return Buffer.from(`${login}:${password}`).toString("base64");
}

async function fetchDomainRankOverview(domain) {
  const d = String(domain || "").trim();
  if (!d) {
    return { ok: false, error: "Missing domain", raw: null };
  }

  const auth = getDataForSeoAuth();
  if (!auth) {
    return {
      ok: false,
      error: "DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD env vars are missing",
      raw: null,
    };
  }

  const requestBody = {
    data: [
      {
        target: d,
        se_type: "google",
        location_code: 2826, // UK
        limit: 1,
        ignore_synonyms: false,
      },
    ],
  };

  try {
    const response = await fetch(
      "https://api.dataforseo.com/v3/dataforseo_labs/google/domain_rank_overview/live",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify(requestBody),
      }
    );

    const json = await response.json();

    // Normalise error shape
    if (!response.ok || json?.status_code !== 20000) {
      return {
        ok: false,
        error: json?.status_message || `Domain rank overview failed (HTTP ${response.status})`,
        raw: json,
      };
    }

    // DataForSEO commonly uses tasks[0].result[0].items[0]
    const result = json?.tasks?.[0]?.result?.[0] ?? json?.result?.[0] ?? null;
    const item = result?.items?.[0] ?? null;
    const organic = item?.metrics?.organic ?? null;

    if (!item || !organic) {
      return { ok: false, error: "No organic metrics returned", raw: json };
    }

    return {
      ok: true,
      data: {
        se_type: item?.se_type || "google",
        location_code: item?.location_code ?? result?.location_code ?? 2826,
        language_code: item?.language_code ?? result?.language_code ?? "en",
        organic: {
          keywords_total: organic?.count ?? 0,
          etv: organic?.etv ?? 0,
          estimated_paid_traffic_cost: organic?.estimated_paid_traffic_cost ?? 0,
          pos_1: organic?.pos_1 ?? 0,
          pos_2_3: organic?.pos_2_3 ?? 0,
          pos_4_10: organic?.pos_4_10 ?? 0,
          pos_11_20: organic?.pos_11_20 ?? 0,
          pos_21_30: organic?.pos_21_30 ?? 0,
        },
        raw: item,
      },
      raw: json,
    };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), raw: null };
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      status: "error",
      message: "Method not allowed. Use GET.",
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  const domain = (req.query.domain && String(req.query.domain)) || "alanranger.com";
  const debugMode = String(req.query.debug || "").trim() === "1";
  const result = await fetchDomainRankOverview(domain);

  if (!result.ok) {
    return res.status(200).json({
      status: "error",
      domain,
      data: null,
      ...(debugMode
        ? {
            debug: {
              source: "dataforseo_labs.domain_rank_overview",
              error: result.error,
              raw: result.raw,
            },
          }
        : {}),
      meta: {
        generatedAt: new Date().toISOString(),
        source: "dataforseo_labs.domain_rank_overview",
      },
    });
  }

  const metrics = result.data;
  const organic = metrics.organic || {};
  const top3Keywords = (organic.pos_1 || 0) + (organic.pos_2_3 || 0);
  const top10Keywords = top3Keywords + (organic.pos_4_10 || 0);

  return res.status(200).json({
    status: "ok",
    domain,
    data: {
      se_type: metrics.se_type,
      location_code: metrics.location_code,
      language_code: metrics.language_code,
      organic_keywords_total: organic.keywords_total,
      organic_etv: organic.etv,
      top3_keywords: top3Keywords,
      top10_keywords: top10Keywords,
      // Placeholder for later: domain_strength_score
    },
    meta: {
      generatedAt: new Date().toISOString(),
      source: "dataforseo_labs.domain_rank_overview",
    },
  });
}

