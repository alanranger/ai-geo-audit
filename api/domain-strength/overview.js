/**
 * Domain Strength overview (read-only)
 *
 * GET /api/domain-strength/overview
 *
 * - Uses only existing rows in domain_strength_snapshots (no DataForSEO calls)
 * - Returns latest + trend points + deltaLatest per (domain, engine)
 * - Adds lightweight metadata (label/segment/isCompetitor) with graceful fallback
 */

function isoDateDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function normalizeDomain(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  try {
    if (raw.includes("://")) return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    // ignore
  }
  return raw.replace(/^www\./, "").split("/")[0];
}

function num(x) {
  const n = typeof x === "number" ? x : Number.parseFloat(String(x));
  return Number.isFinite(n) ? n : null;
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

  const startDate = isoDateDaysAgo(548); // ~18 months

  const snapshotQueryUrl =
    `${supabaseUrl}/rest/v1/domain_strength_snapshots` +
    `?snapshot_date=gte.${startDate}` +
    `&select=domain,engine,snapshot_date,score,band,organic_etv_raw,organic_keywords_total_raw,top3_keywords_raw,top10_keywords_raw` +
    `&order=domain.asc&order=engine.asc&order=snapshot_date.asc` +
    `&limit=10000`;

  const snapResp = await fetch(snapshotQueryUrl, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
    },
  });

  if (!snapResp.ok) {
    const errorText = await snapResp.text();
    return res.status(snapResp.status).json({
      status: "error",
      message: "Failed to fetch domain strength snapshots",
      details: errorText,
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  const snapshotRows = await snapResp.json();
  const rows = Array.isArray(snapshotRows) ? snapshotRows : [];

  // Optional metadata (graceful): competitor_domains table may not exist in all projects.
  let competitorMeta = new Map();
  try {
    const competitorUrl =
      `${supabaseUrl}/rest/v1/competitor_domains` +
      `?select=domain,label,segment,is_active&limit=2000`;
    const compResp = await fetch(competitorUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });
    if (compResp.ok) {
      const compRows = await compResp.json();
      const active = Array.isArray(compRows) ? compRows.filter((c) => c && c.is_active) : [];
      competitorMeta = new Map(
        active
          .map((c) => {
            const d = normalizeDomain(c.domain);
            if (!d) return null;
            return [d, { label: c.label || d, segment: c.segment || null, isCompetitor: true }];
          })
          .filter(Boolean)
      );
    }
  } catch {
    // ignore (table may not exist)
  }

  const primaryDomain = normalizeDomain(
    process.env.NEXT_PUBLIC_SITE_DOMAIN || process.env.SITE_DOMAIN || "alanranger.com"
  );

  // Group by (domain, engine)
  const grouped = new Map();
  for (const r of rows) {
    const domain = normalizeDomain(r?.domain);
    const engine = String(r?.engine || "google");
    if (!domain) continue;
    const key = `${domain}||${engine}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(r);
  }

  const items = [];
  for (const [key, list] of grouped.entries()) {
    const [domain, engine] = key.split("||");
    const sorted = list
      .slice()
      .sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date)));

    const points = sorted
      .map((r) => {
        const s = num(r?.score);
        const d = String(r?.snapshot_date || "");
        if (!d || s === null) return null;
        return { date: d, score: s };
      })
      .filter(Boolean);

    const last = sorted[sorted.length - 1] || null;
    const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null;
    const lastScore = num(last?.score);
    const prevScore = num(prev?.score);
    const deltaLatest =
      lastScore !== null && prevScore !== null ? lastScore - prevScore : null;

    const latest =
      last && lastScore !== null
        ? {
            snapshotDate: String(last.snapshot_date || ""),
            score: lastScore,
            band: String(last.band || ""),
            organicEtv: Number(last.organic_etv_raw || 0),
            organicKeywordsTotal: Number(last.organic_keywords_total_raw || 0),
            top3Keywords: last.top3_keywords_raw == null ? 0 : Number(last.top3_keywords_raw || 0),
            top10Keywords: last.top10_keywords_raw == null ? 0 : Number(last.top10_keywords_raw || 0),
          }
        : null;

    const meta =
      competitorMeta.get(domain) ??
      (domain === primaryDomain
        ? { label: "Alan Ranger Photography", segment: "Your site", isCompetitor: false }
        : { label: domain, segment: null, isCompetitor: true });

    items.push({
      domain,
      searchEngine: engine,
      label: meta.label,
      segment: meta.segment,
      isCompetitor: meta.isCompetitor,
      latest,
      trend: { points, deltaLatest },
    });
  }

  return res.status(200).json({
    status: "ok",
    items,
    meta: { generatedAt: new Date().toISOString(), source: "domain_strength_snapshots" },
  });
}

