/**
 * Domain Strength monthly snapshot (manual)
 *
 * POST /api/domain-strength/snapshot
 * Body: { mode?: "test"|"run", domains: string[] }
 *
 * - mode=test: uses first 1-3 domains, NO DB writes
 * - mode=run: runs all provided domains and writes rows to domain_strength_snapshots
 */

import { computeDomainStrengthScore } from "./score.js";
import { fetchLabsDomainRankOverviewBatch } from "./labs.js";

function isoDateUTC() {
  return new Date().toISOString().slice(0, 10);
}

function isoDateDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function normalizeDomain(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  try {
    if (raw.includes("://")) {
      return new URL(raw).hostname.replace(/^www\./, "");
    }
  } catch {
    // ignore
  }
  return raw.replace(/^www\./, "").split("/")[0];
}

function normalizeDomainArray(domains) {
  const out = [];
  const seen = new Set();
  for (const d of Array.isArray(domains) ? domains : []) {
    const n = normalizeDomain(d);
    if (!n) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
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

async function deleteExistingRows(snapshotDate, engine, domains) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return;

  // Delete per-domain to keep URL length small and logic simple
  for (const domain of domains) {
    const deleteUrl =
      `${supabaseUrl}/rest/v1/domain_strength_snapshots` +
      `?snapshot_date=eq.${encodeURIComponent(snapshotDate)}` +
      `&engine=eq.${encodeURIComponent(engine)}` +
      `&domain=eq.${encodeURIComponent(domain)}`;

    await fetch(deleteUrl, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });
  }
}

async function insertRows(rows) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase not configured. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const resp = await fetch(`${supabaseUrl}/rest/v1/domain_strength_snapshots`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(errorText || `Insert failed (HTTP ${resp.status})`);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({
      status: "error",
      message: "Method not allowed. Use POST.",
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  const body = req.body && typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  const mode = (body.mode || "run") === "test" ? "test" : "run";
  const domains = normalizeDomainArray(body.domains);

  if (domains.length === 0) {
    return res.status(400).json({
      status: "error",
      message: "Missing required field: domains (array)",
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  const snapshot_date = isoDateUTC();
  const engine = "google";
  const runDomains = mode === "test" ? domains.slice(0, 3) : domains;

  const caps = (await fetchCapsFromSupabase()) || { etvCap: 1_000_000, kwCap: 100_000 };

  const labs = await fetchLabsDomainRankOverviewBatch(runDomains, { includeRaw: mode === "test" });
  if (!labs.ok) {
    return res.status(200).json({
      status: "error",
      message: labs.error || "Labs request failed",
      snapshot_date,
      engine,
      domains_processed: runDomains.length,
      mode,
      meta: { generatedAt: new Date().toISOString(), source: "dataforseo_labs.domain_rank_overview" },
    });
  }

  const byDomain = new Map(labs.data.map((r) => [r.domain, r]));
  const results = [];
  const insertPayload = [];

  function isNoDataError(msg) {
    const m = String(msg || "").toLowerCase();
    return (
      m === "no data" ||
      m.includes("no organic metrics") ||
      m.includes("no organic metric") ||
      m.includes("no results")
    );
  }

  for (const domain of runDomains) {
    const r = byDomain.get(domain);
    if (!r || !r.ok || !r.data) {
      const errMsg = r?.error || "No data";

      // Only treat true "no data" as a 0 score. If the API call failed (plan limits, auth, etc),
      // don't write misleading "Very weak" rows.
      if (!isNoDataError(errMsg)) {
        results.push({
          domain,
          score: null,
          band: null,
          V: null,
          B: null,
          Q: null,
          raw: null,
          error: errMsg,
        });
        continue;
      }

      const score = 0;
      const band = "Very weak";
      results.push({ domain, score, band, V: 0, B: 0, Q: 0, raw: null, error: errMsg });

      if (mode === "run") {
        insertPayload.push({
          domain,
          engine,
          snapshot_date,
          score,
          band,
          vis_component: 0,
          breadth_component: 0,
          quality_component: 0,
          organic_etv_raw: 0,
          organic_keywords_total_raw: 0,
          top3_keywords_raw: null,
          top10_keywords_raw: null,
        });
      }
      continue;
    }

    const raw = {
      etv: Number(r.data.etv) || 0,
      keywordsTotal: Number(r.data.keywordsTotal) || 0,
      top3: Number(r.data.top3) || 0,
      top10: Number(r.data.top10) || 0,
    };

    const scored = computeDomainStrengthScore(
      { etv: raw.etv, keywordsTotal: raw.keywordsTotal, top3: raw.top3, top10: raw.top10 },
      { etvCap: caps.etvCap, kwCap: caps.kwCap }
    );

    results.push({ domain, score: scored.score, band: scored.band, V: scored.V, B: scored.B, Q: scored.Q, raw });

    if (mode === "run") {
      insertPayload.push({
        domain,
        engine,
        snapshot_date,
        score: scored.score,
        band: scored.band,
        vis_component: scored.V,
        breadth_component: scored.B,
        quality_component: scored.Q,
        organic_etv_raw: Math.round(raw.etv),
        organic_keywords_total_raw: Math.round(raw.keywordsTotal),
        top3_keywords_raw: raw.top3 || null,
        top10_keywords_raw: raw.top10 || null,
      });
    }
  }

  if (mode === "run") {
    try {
      await deleteExistingRows(snapshot_date, engine, runDomains);
      await insertRows(insertPayload);
    } catch (e) {
      return res.status(500).json({
        status: "error",
        message: "Failed to write snapshots to Supabase",
        details: e?.message || String(e),
        snapshot_date,
        engine,
        domains_processed: runDomains.length,
        mode,
        meta: { generatedAt: new Date().toISOString() },
      });
    }
  }

  return res.status(200).json({
    status: "ok",
    snapshot_date,
    engine,
    mode,
    caps,
    domains_processed: runDomains.length,
    inserted: mode === "run" ? insertPayload.length : 0,
    results,
    meta: { generatedAt: new Date().toISOString(), source: "domain-strength.snapshot" },
  });
}

