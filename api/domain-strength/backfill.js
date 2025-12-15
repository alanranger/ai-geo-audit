/**
 * Domain Strength backfill endpoint
 * 
 * POST /api/domain-strength/backfill
 * Body: {
 *   mode: "auto" | "list",
 *   domains?: string[],  // only for mode=list
 *   searchEngine?: "google",
 *   maxNewDomains?: number,
 *   dryRun?: boolean,
 *   source?: string
 * }
 * 
 * One-off backfill for domains that don't have snapshots yet.
 * Enforces maxNewDomains strictly to bound costs.
 */

import { normalizeDomain, hasAnySnapshot, enqueuePending } from "../../lib/domainStrength/domains.js";
import { computeDomainStrengthScore } from "./score.js";
import { fetchLabsDomainRankOverviewBatch } from "./labs.js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
  if (!supabaseUrl || !supabaseKey) return null;
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - 365);
  const queryUrl =
    `${supabaseUrl}/rest/v1/domain_strength_snapshots` +
    `?snapshot_date=gte.${startDate.toISOString().slice(0, 10)}` +
    `&select=organic_etv_raw,organic_keywords_total_raw` +
    `&limit=10000`;

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

async function extractDomainsFromAuditResults() {
  if (!supabaseUrl || !supabaseKey) return [];
  
  try {
    // Query audit_results for ranking_ai_data.combinedRows[].competitor_counts
    const queryUrl =
      `${supabaseUrl}/rest/v1/audit_results` +
      `?select=ranking_ai_data` +
      `&ranking_ai_data=not.is.null` +
      `&limit=100`;
    
    const resp = await fetch(queryUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });
    
    if (!resp.ok) return [];
    const rows = await resp.json();
    if (!Array.isArray(rows)) return [];
    
    const domains = new Set();
    
    for (const row of rows) {
      const data = row.ranking_ai_data;
      if (!data || !data.combinedRows) continue;
      
      for (const combinedRow of data.combinedRows) {
        if (!combinedRow.competitor_counts) continue;
        
        // Extract domains from competitor_counts object
        Object.keys(combinedRow.competitor_counts).forEach(domain => {
          const normalized = normalizeDomain(domain);
          if (normalized) domains.add(normalized);
        });
        
        // Also extract from sample_citations
        if (Array.isArray(combinedRow.sample_citations)) {
          combinedRow.sample_citations.forEach(citation => {
            if (citation.domain) {
              const normalized = normalizeDomain(citation.domain);
              if (normalized && !normalized.includes('alanranger.com')) {
                domains.add(normalized);
              }
            }
          });
        }
      }
    }
    
    return Array.from(domains);
  } catch {
    return [];
  }
}

async function insertRows(rows) {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase not configured");
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

  // Admin guard
  const adminToken = req.headers['x-admin-token'];
  const expectedToken = process.env.ADMIN_TOKEN;
  if (!expectedToken || adminToken !== expectedToken) {
    return res.status(403).json({
      status: "error",
      message: "Unauthorized. Missing or invalid x-admin-token header.",
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      status: "error",
      message: "Supabase not configured",
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  const body = req.body && typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  const mode = body.mode === "list" ? "list" : "auto";
  const searchEngine = body.searchEngine || "google";
  const maxNewDomains = Math.max(1, Math.min(1000, Number(body.maxNewDomains) || 100));
  const dryRun = body.dryRun === true;
  const source = body.source || "backfill";

  let candidateDomains = [];

  if (mode === "list") {
    candidateDomains = normalizeDomainArray(body.domains || []);
  } else {
    // mode=auto: extract from audit_results
    candidateDomains = await extractDomainsFromAuditResults();
  }

  if (candidateDomains.length === 0) {
    return res.status(200).json({
      status: "ok",
      mode,
      dryRun,
      considered: 0,
      processed: 0,
      skipped_existing: 0,
      invalid: 0,
      errors: [],
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  // Check which domains already have snapshots
  const toProcess = [];
  const skippedExisting = [];
  const invalid = [];

  for (const domain of candidateDomains) {
    const normalized = normalizeDomain(domain);
    if (!normalized) {
      invalid.push(domain);
      continue;
    }

    const hasSnapshot = await hasAnySnapshot(normalized, searchEngine);
    if (hasSnapshot) {
      skippedExisting.push(normalized);
    } else {
      toProcess.push(normalized);
    }
  }

  // Enforce maxNewDomains
  const domainsToFetch = toProcess.slice(0, maxNewDomains);
  const capped = toProcess.length > maxNewDomains;

  if (domainsToFetch.length === 0) {
    return res.status(200).json({
      status: "ok",
      mode,
      dryRun,
      considered: candidateDomains.length,
      processed: 0,
      skipped_existing: skippedExisting.length,
      invalid: invalid.length,
      capped: false,
      errors: [],
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  const caps = (await fetchCapsFromSupabase()) || { etvCap: 1_000_000, kwCap: 100_000 };
  const snapshot_date = new Date().toISOString().slice(0, 10);
  const insertPayload = [];
  const errors = [];

  if (!dryRun) {
    const labs = await fetchLabsDomainRankOverviewBatch(domainsToFetch, { includeRaw: false });
    
    if (!labs.ok) {
      return res.status(200).json({
        status: "error",
        message: labs.error || "Labs request failed",
        mode,
        dryRun,
        considered: candidateDomains.length,
        processed: 0,
        skipped_existing: skippedExisting.length,
        invalid: invalid.length,
        capped,
        errors: [labs.error || "Labs request failed"],
        meta: { generatedAt: new Date().toISOString() },
      });
    }

    const byDomain = new Map(labs.data.map((r) => [r.domain, r]));

    for (const domain of domainsToFetch) {
      const r = byDomain.get(domain);
      if (!r || !r.ok || !r.data) {
        const errMsg = r?.error || "No data";
        errors.push({ domain, error: errMsg });
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

      insertPayload.push({
        domain,
        engine: searchEngine,
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

    if (insertPayload.length > 0) {
      try {
        await insertRows(insertPayload);
      } catch (e) {
        errors.push({ error: `Insert failed: ${e?.message || String(e)}` });
      }
    }
  }

  return res.status(200).json({
    status: "ok",
    mode,
    dryRun,
    considered: candidateDomains.length,
    processed: dryRun ? domainsToFetch.length : insertPayload.length,
    skipped_existing: skippedExisting.length,
    invalid: invalid.length,
    capped,
    errors: errors.length > 0 ? errors : [],
    meta: { generatedAt: new Date().toISOString(), source: "domain-strength.backfill" },
  });
}

