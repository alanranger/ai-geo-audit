/**
 * Ranking & AI summary helpers (read-only).
 *
 * GET /api/ranking-ai/summary
 *
 * Returns domainStrength + authorityPriority for the primary domain.
 * No DataForSEO calls.
 */

import { getAuthorityPriority } from "../../lib/domainStrengthAuthority.js";

function normalizeDomain(value) {
  const raw = String(value || "").trim();
  if (!raw) return "alanranger.com";
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
    return res.status(200).json({
      status: "ok",
      domainStrength: { score: null, band: null, snapshotDate: null },
      authorityPriority: null,
      meta: { generatedAt: new Date().toISOString(), missingSupabase: true },
    });
  }

  const primaryDomain = normalizeDomain(process.env.AI_GEO_DOMAIN || process.env.SITE_DOMAIN || "alanranger.com");

  try {
    const queryUrl =
      `${supabaseUrl}/rest/v1/domain_strength_snapshots` +
      `?domain=eq.${encodeURIComponent(primaryDomain)}` +
      `&engine=eq.google` +
      `&select=snapshot_date,score,band` +
      `&order=snapshot_date.desc` +
      `&limit=1`;

    const resp = await fetch(queryUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });

    if (!resp.ok) {
      return res.status(200).json({
        status: "ok",
        domainStrength: { score: null, band: null, snapshotDate: null },
        authorityPriority: null,
        meta: { generatedAt: new Date().toISOString(), httpStatus: resp.status },
      });
    }

    const rows = await resp.json();
    const r = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;

    const score = num(r?.score);
    const band = typeof r?.band === "string" ? r.band : null;
    const snapshotDate = r?.snapshot_date ? String(r.snapshot_date) : null;

    const domainStrength = { score, band, snapshotDate };
    const authorityPriority = getAuthorityPriority(score);

    return res.status(200).json({
      status: "ok",
      domain: primaryDomain,
      domainStrength,
      authorityPriority,
      meta: { generatedAt: new Date().toISOString(), source: "domain_strength_snapshots" },
    });
  } catch {
    return res.status(200).json({
      status: "ok",
      domain: primaryDomain,
      domainStrength: { score: null, band: null, snapshotDate: null },
      authorityPriority: null,
      meta: { generatedAt: new Date().toISOString(), error: true },
    });
  }
}
