/**
 * Domain Strength history (read-only)
 *
 * GET /api/domain-strength/history?domains=a.com,b.com
 * - Returns last 12 months (365d) for requested domains (or all if omitted)
 */

function isoDateDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function normalizeDomainList(raw) {
  const parts = String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const d = p.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    if (!d) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
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

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      status: "error",
      message: "Supabase not configured. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  const startDate = isoDateDaysAgo(365);
  const domains = normalizeDomainList(req.query.domains || "");

  let queryUrl =
    `${supabaseUrl}/rest/v1/domain_strength_snapshots` +
    `?snapshot_date=gte.${startDate}` +
    `&select=domain,engine,snapshot_date,score,band,vis_component,breadth_component,quality_component,organic_etv_raw,organic_keywords_total_raw,top3_keywords_raw,top10_keywords_raw` +
    `&order=snapshot_date.asc` +
    `&limit=5000`;

  if (domains.length > 0) {
    // domain=in.(a.com,b.com)
    const inList = `(${domains.join(",")})`;
    queryUrl += `&domain=in.${encodeURIComponent(inList)}`;
  }

  const resp = await fetch(queryUrl, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    return res.status(resp.status).json({
      status: "error",
      message: "Failed to fetch domain strength history",
      details: errorText,
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  const rows = await resp.json();
  return res.status(200).json({
    status: "ok",
    data: Array.isArray(rows) ? rows : [],
    count: Array.isArray(rows) ? rows.length : 0,
    meta: { generatedAt: new Date().toISOString(), source: "domain_strength_snapshots" },
  });
}

