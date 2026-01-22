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
    `&select=domain,engine,snapshot_date,score,band,organic_etv_raw,organic_keywords_total_raw,top3_keywords_raw,top10_keywords_raw,created_at` +
    `&order=domain.asc&order=engine.asc&order=snapshot_date.asc&order=created_at.desc` +
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
  
  // Also fetch from domain_strength_domains (new mapping table)
  try {
    const uniqueDomainsInSnapshots = [...new Set(rows.map(r => normalizeDomain(r.domain)).filter(Boolean))];
    if (uniqueDomainsInSnapshots.length > 0) {
      const chunkSize = 100;
      for (let i = 0; i < uniqueDomainsInSnapshots.length; i += chunkSize) {
        const chunk = uniqueDomainsInSnapshots.slice(i, i + chunkSize);
        const inList = `(${chunk.map(d => `"${d}"`).join(',')})`;
        const domainStrengthUrl =
          `${supabaseUrl}/rest/v1/domain_strength_domains` +
          `?domain=in.${encodeURIComponent(inList)}` +
          `&select=domain,label,domain_type,segment,is_competitor`;
        const dsResp = await fetch(domainStrengthUrl, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        });
        if (dsResp.ok) {
          const dsRows = await dsResp.json();
          if (Array.isArray(dsRows)) {
            dsRows.forEach((c) => {
              const d = normalizeDomain(c.domain);
              if (!d) return;
              // Only add if not already in competitorMeta (competitor_domains takes precedence)
              if (!competitorMeta.has(d)) {
                const domainType = c.domain_type || c.segment || 'unmapped';
                competitorMeta.set(d, {
                  label: c.label || d,
                  domain_type: domainType,
                  segment: domainType, // Backward compatibility
                  isCompetitor: c.is_competitor === true,
                });
              }
            });
          }
        }
      }
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
    // Sort by snapshot_date first, then by created_at DESC to get latest entry for each date
    const sorted = list
      .slice()
      .sort((a, b) => {
        const dateCompare = String(a.snapshot_date).localeCompare(String(b.snapshot_date));
        if (dateCompare !== 0) return dateCompare;
        // If same snapshot_date, sort by created_at DESC (newest first)
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
      });

    // Keep only the latest entry per snapshot date (newest created_at wins).
    const byDate = new Map();
    for (const r of sorted) {
      const d = String(r?.snapshot_date || "");
      if (!d) continue;
      if (!byDate.has(d)) {
        byDate.set(d, r);
      }
    }
    const points = Array.from(byDate.entries())
      .map(([date, row]) => {
        const s = num(row?.score);
        if (!date || s === null) return null;
        return { date, score: s };
      })
      .filter(Boolean);

    const dates = Array.from(byDate.keys());
    const lastDate = dates[dates.length - 1] || null;
    const prevDate = dates.length > 1 ? dates[dates.length - 2] : null;
    const lastRow = lastDate ? byDate.get(lastDate) : null;
    const prevRow = prevDate ? byDate.get(prevDate) : null;
    const lastScore = num(lastRow?.score);
    const prevScore = num(prevRow?.score);

    const deltaLatest =
      lastScore !== null && prevScore !== null ? lastScore - prevScore : null;

    const latest =
      lastRow && lastScore !== null
        ? {
            snapshotDate: String(lastRow.snapshot_date || ""),
            createdAt: String(lastRow.created_at || ""),
            score: lastScore,
            band: String(lastRow.band || ""),
            organicEtv: Number(lastRow.organic_etv_raw || 0),
            organicKeywordsTotal: Number(lastRow.organic_keywords_total_raw || 0),
            top3Keywords: lastRow.top3_keywords_raw == null ? 0 : Number(lastRow.top3_keywords_raw || 0),
            top10Keywords: lastRow.top10_keywords_raw == null ? 0 : Number(lastRow.top10_keywords_raw || 0),
          }
        : null;

    const meta =
      competitorMeta.get(domain) ??
      (domain === primaryDomain
        ? { label: "Alan Ranger Photography", domain_type: "your_site", segment: "your_site", isCompetitor: false }
        : { label: domain, domain_type: "unmapped", segment: "unmapped", isCompetitor: false }); // Default to false, only true if explicitly marked

    items.push({
      domain,
      searchEngine: engine,
      label: meta.label,
      domain_type: meta.domain_type || meta.segment || 'unmapped',
      segment: meta.segment || meta.domain_type || 'unmapped',
      isCompetitor: meta.isCompetitor || false,
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

