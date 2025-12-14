/**
 * Domain Strength test route (no DB writes)
 *
 * GET /api/domain-strength/test?domain=www.alanranger.com
 *
 * - Calls DataForSEO Labs domain_rank_overview once
 * - Optionally reads last 12 months from Supabase for caps
 * - Returns score components + band
 */

import { computeDomainStrengthScore } from "./score.js";
import { fetchLabsDomainRankOverview } from "./labs.js";

function isoDateDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function fetchCapsFromSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  const startDate = isoDateDaysAgo(365);
  const queryUrl =
    `${supabaseUrl}/rest/v1/domain_strength_snapshots` +
    `?snapshot_date=gte.${startDate}` +
    `&select=organic_etv_raw,organic_keywords_total_raw` +
    `&limit=5000`;

  const resp = await fetch(queryUrl, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
  });

  if (!resp.ok) return null;
  const rows = await resp.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;

  let maxEtv = 0;
  let maxKw = 0;
  for (const r of rows) {
    const etv = Number(r?.organic_etv_raw) || 0;
    const kw = Number(r?.organic_keywords_total_raw) || 0;
    if (etv > maxEtv) maxEtv = etv;
    if (kw > maxKw) maxKw = kw;
  }

  const etvCap = Math.max(10000, Math.round(maxEtv * 1.2));
  const kwCap = Math.max(1000, Math.round(maxKw * 1.2));
  return { etvCap, kwCap };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({
      status: "error",
      message: "Method not allowed. Use GET.",
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  const domain = (req.query.domain && String(req.query.domain)) || "www.alanranger.com";
  const includeRaw = String(req.query.debug || "").trim() === "1";

  const labs = await fetchLabsDomainRankOverview(domain, { includeRaw });
  if (!labs.ok) {
    return res.status(200).json({
      status: "error",
      domain,
      data: null,
      debug: includeRaw ? { source: "dataforseo_labs.domain_rank_overview", error: labs.error, raw: labs.raw } : undefined,
      meta: { generatedAt: new Date().toISOString(), source: "domain-strength.test" },
    });
  }

  const historyCaps = await fetchCapsFromSupabase();
  const caps = historyCaps || { etvCap: 1_000_000, kwCap: 100_000 };

  const raw = {
    etv: labs.data.etv,
    keywordsTotal: labs.data.keywordsTotal,
    top3: labs.data.top3,
    top10: labs.data.top10,
  };

  const scored = computeDomainStrengthScore(
    { etv: raw.etv, keywordsTotal: raw.keywordsTotal, top3: raw.top3, top10: raw.top10 },
    { etvCap: caps.etvCap, kwCap: caps.kwCap }
  );

  return res.status(200).json({
    domain: labs.data.domain,
    raw,
    caps,
    components: { V: scored.V, B: scored.B, Q: scored.Q },
    score: scored.score,
    band: scored.band,
    meta: { generatedAt: new Date().toISOString(), source: "domain-strength.test" },
  });
}

