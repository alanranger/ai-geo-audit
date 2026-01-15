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
import { dequeuePending, clearPending } from "../../lib/domainStrength/domains.js";

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

async function fetchExistingSnapshotRows(snapshotDate, engine, domains) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return new Map();
  const list = Array.isArray(domains) ? domains : [];
  if (list.length === 0) return new Map();

  const out = new Map(); // domain -> { score, band, snapshotDate }

  // Chunk to avoid long URLs
  const chunkSize = 100;
  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize);
    const inList = `(${chunk.join(",")})`;
    const url =
      `${supabaseUrl}/rest/v1/domain_strength_snapshots` +
      `?snapshot_date=eq.${encodeURIComponent(snapshotDate)}` +
      `&engine=eq.${encodeURIComponent(engine)}` +
      `&select=domain,score,band,snapshot_date` +
      `&domain=in.${encodeURIComponent(inList)}` +
      `&limit=5000`;

    // eslint-disable-next-line no-await-in-loop
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });

    if (!resp.ok) continue;
    // eslint-disable-next-line no-await-in-loop
    const rows = await resp.json();
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      const d = normalizeDomain(r?.domain);
      if (!d) continue;
      const score = typeof r?.score === "number" ? r.score : Number(r?.score);
      const band = typeof r?.band === "string" ? r.band : null;
      const snap = String(r?.snapshot_date || snapshotDate);
      out.set(d, { score: Number.isFinite(score) ? score : null, band: band || null, snapshotDate: snap });
    }
  }

  return out;
}

async function fetchExistingSnapshotRowsForMonth(monthStart, monthEnd, engine, domains) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.log('[fetchExistingSnapshotRowsForMonth] Supabase not configured');
    return new Set();
  }
  const list = Array.isArray(domains) ? domains : [];
  if (list.length === 0) {
    console.log('[fetchExistingSnapshotRowsForMonth] No domains to check');
    return new Set();
  }

  const out = new Set(); // Just track which domains have snapshots this month

  // Chunk to avoid long URLs
  const chunkSize = 100;
  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize);
    // Format domain list for Supabase: domain1,domain2,domain3 (no quotes, no parentheses in the in.() part)
    const domainList = chunk.join(",");
    const url =
      `${supabaseUrl}/rest/v1/domain_strength_snapshots` +
      `?snapshot_date=gte.${encodeURIComponent(monthStart)}` +
      `&snapshot_date=lte.${encodeURIComponent(monthEnd)}` +
      `&engine=eq.${encodeURIComponent(engine)}` +
      `&domain=in.(${encodeURIComponent(domainList)})` +
      `&select=domain` +
      `&limit=5000`;

    console.log(`[fetchExistingSnapshotRowsForMonth] Checking ${chunk.length} domains for snapshots in ${monthStart} to ${monthEnd}`);

    // eslint-disable-next-line no-await-in-loop
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error(`[fetchExistingSnapshotRowsForMonth] Query failed: ${resp.status} - ${errorText}`);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const rows = await resp.json();
    if (!Array.isArray(rows)) {
      console.error(`[fetchExistingSnapshotRowsForMonth] Invalid response format: ${typeof rows}`);
      continue;
    }
    console.log(`[fetchExistingSnapshotRowsForMonth] Found ${rows.length} domains with snapshots this month`);
    for (const r of rows) {
      const d = normalizeDomain(r?.domain);
      if (d) out.add(d);
    }
  }

  console.log(`[fetchExistingSnapshotRowsForMonth] Total domains with snapshots this month: ${out.size}`);
  return out;
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

  try {
  // Get Supabase credentials
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const body = req.body && typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  const mode = (body.mode || "run") === "test" ? "test" : "run";
  const force = body.force === true;
  const includePending = body.includePending !== false; // default true
  const pendingLimit = Math.max(1, Math.min(1000, Number(body.pendingLimit) || 100));
  const domains = normalizeDomainArray(body.domains || []);

  const snapshot_date = isoDateUTC();
  const engine = "google";
  
  // Get primary domain (alanranger.com) - always fetch this
  const primaryDomain = normalizeDomain(process.env.AI_GEO_DOMAIN || process.env.SITE_DOMAIN || "alanranger.com");
  
  // Build domain list: primary domain + pending queue (if enabled)
  let runDomains = [];
  
  if (mode === "test") {
    // Test mode: use provided domains or just primary domain
    runDomains = domains.length > 0 ? domains.slice(0, 3) : (primaryDomain ? [primaryDomain] : []);
  } else {
    // Run mode: always include primary domain, then add pending domains
    if (primaryDomain) {
      runDomains.push(primaryDomain);
    }
    
    if (includePending) {
      // Fetch pending domains
      const pendingDomains = await dequeuePending({ engine, limit: pendingLimit * 2 });
      
      if (pendingDomains.length > 0) {
        // Check which pending domains already have snapshots for the current MONTH (not just today)
        // This ensures cost control: each domain is only fetched once per calendar month
        const monthStart = snapshot_date.slice(0, 7) + '-01'; // e.g., '2025-12-01'
        const monthEnd = snapshot_date.slice(0, 7) + '-31'; // e.g., '2025-12-31'
        
        const pendingWithSnapshots = await fetchExistingSnapshotRowsForMonth(monthStart, monthEnd, engine, pendingDomains);
        
        // Clean up: Remove domains from pending queue that already have snapshots this month
        // (They may have been processed in a previous run but not cleared)
        if (pendingWithSnapshots.size > 0) {
          const domainsToClean = Array.from(pendingWithSnapshots);
          await clearPending(domainsToClean, engine);
        }
        
        // Filter out pending domains that already have a snapshot this month (cost control)
        // Primary domain is always included regardless
        const uniquePendingDomains = [];
        for (const d of pendingDomains) {
          const n = normalizeDomain(d);
          if (!n || n === primaryDomain) continue; // Skip if invalid or same as primary domain
          if (pendingWithSnapshots.has(n)) continue; // Skip if already has snapshot this month
          uniquePendingDomains.push(n);
          if (uniquePendingDomains.length >= pendingLimit) break; // Stop once we have enough
        }
        
        // Merge: primary domain + unique pending domains
        runDomains = [...runDomains, ...uniquePendingDomains];
      }
    } else if (domains.length > 0) {
      // If includePending is false but domains are provided, use those
      runDomains = [...runDomains, ...normalizeDomainArray(domains)];
    }
  }
  
  // Final deduplication
  const seen = new Set();
  const finalDomains = [];
  for (const d of runDomains) {
    const n = normalizeDomain(d);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    finalDomains.push(n);
  }
  runDomains = finalDomains;

  if (runDomains.length === 0) {
    return res.status(400).json({
      status: "error",
      message: "No domains to process. Provide domains array or enable includePending.",
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  const caps = (await fetchCapsFromSupabase()) || { etvCap: 1_000_000, kwCap: 100_000 };

  // Check for existing snapshots - we'll use this to reuse data if API fails
  const existingByDomain =
    mode === "run" && !force ? await fetchExistingSnapshotRows(snapshot_date, engine, runDomains) : new Map();
  // Always fetch all domains to ensure created_at timestamp is updated on each run
  const domainsToFetch = runDomains;
  
  // Track which domains we successfully fetched vs need to reuse existing data
  const domainsToReuse = new Set();

  const computedByDomain = new Map();
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

  if (domainsToFetch.length > 0) {
    const labs = await fetchLabsDomainRankOverviewBatch(domainsToFetch, { includeRaw: mode === "test" });
    if (!labs.ok) {
      // If API fails but we have existing data, reuse it to update timestamp
      if (existingByDomain.size > 0 && mode === "run") {
        for (const [domain, v] of existingByDomain.entries()) {
          insertPayload.push({
            domain,
            engine,
            snapshot_date,
            score: v?.score ?? 0,
            band: v?.band ?? "Very weak",
            vis_component: 0,
            breadth_component: 0,
            quality_component: 0,
            organic_etv_raw: 0,
            organic_keywords_total_raw: 0,
            top3_keywords_raw: null,
            top10_keywords_raw: null,
          });
          computedByDomain.set(domain, {
            domain,
            score: v?.score ?? null,
            band: v?.band ?? null,
            V: null,
            B: null,
            Q: null,
            raw: null,
            error: labs.error || "Labs request failed",
            reused: true,
          });
        }
      } else {
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
    } else {
      const byDomain = new Map(labs.data.map((r) => [r.domain, r]));

      for (const domain of domainsToFetch) {
      const r = byDomain.get(domain);
      if (!r || !r.ok || !r.data) {
        const errMsg = r?.error || "No data";

        // Only treat true "no data" as a 0 score. If the API call failed (plan limits, auth, etc),
        // reuse existing data if available, otherwise mark as error
        if (!isNoDataError(errMsg)) {
          // If we have existing data, reuse it to update timestamp
          if (existingByDomain.has(domain)) {
            const v = existingByDomain.get(domain);
            domainsToReuse.add(domain);
            if (mode === "run") {
              insertPayload.push({
                domain,
                engine,
                snapshot_date,
                score: v?.score ?? 0,
                band: v?.band ?? "Very weak",
                vis_component: 0,
                breadth_component: 0,
                quality_component: 0,
                organic_etv_raw: 0,
                organic_keywords_total_raw: 0,
                top3_keywords_raw: null,
                top10_keywords_raw: null,
              });
            }
            computedByDomain.set(domain, {
              domain,
              score: v?.score ?? null,
              band: v?.band ?? null,
              V: null,
              B: null,
              Q: null,
              raw: null,
              error: errMsg,
              reused: true,
            });
          } else {
            computedByDomain.set(domain, {
              domain,
              score: null,
              band: null,
              V: null,
              B: null,
              Q: null,
              raw: null,
              error: errMsg,
            });
          }
          continue;
        }

        const score = 0;
        const band = "Very weak";
        computedByDomain.set(domain, { domain, score, band, V: 0, B: 0, Q: 0, raw: null, error: errMsg });

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

      computedByDomain.set(domain, {
        domain,
        score: scored.score,
        band: scored.band,
        V: scored.V,
        B: scored.B,
        Q: scored.Q,
        raw,
      });

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
    }
  }

  // Build response results in the same order as the input domains list
  // Note: We now always re-fetch and re-insert to update created_at timestamp
  const results = runDomains.map((domain) => {
      const c = computedByDomain.get(domain);
      if (c && !c.error) {
        return { ...c, reused: false };
      }
      // If domain wasn't computed (e.g., API error), reuse existing data but still update timestamp
      if (existingByDomain.has(domain)) {
        const v = existingByDomain.get(domain);
        domainsToReuse.add(domain);
        // Add to insert payload so timestamp gets updated
        if (mode === "run") {
          insertPayload.push({
            domain,
            engine,
            snapshot_date,
            score: v?.score ?? 0,
            band: v?.band ?? "Very weak",
            vis_component: 0,
            breadth_component: 0,
            quality_component: 0,
            organic_etv_raw: 0,
            organic_keywords_total_raw: 0,
            top3_keywords_raw: null,
            top10_keywords_raw: null,
          });
        }
        return {
          domain,
          score: v?.score ?? null,
          band: v?.band ?? null,
          snapshotDate: v?.snapshotDate ?? snapshot_date,
          reused: true,
        };
      }
      return { domain, score: null, band: null, reused: false, error: "Not processed" };
  });

  if (mode === "run") {
    try {
      // Delete existing rows for all domains we're processing (to update created_at timestamp)
      // This ensures the "Last Fetched" time reflects when the snapshot was actually run
      await deleteExistingRows(snapshot_date, engine, runDomains);
      await insertRows(insertPayload);
      
      // Clear pending queue for successfully processed domains
      if (includePending && insertPayload.length > 0) {
        const processedDomains = insertPayload.map(r => r.domain).filter(Boolean);
        await clearPending(processedDomains, engine);
      }
      
      // CRITICAL: Update latest audit record's domain_strength field for primary domain
      // This ensures domain strength is stored in audit_results for delta calculations
      if (primaryDomain && insertPayload.length > 0) {
        const primaryDomainSnapshot = insertPayload.find(r => r.domain === primaryDomain);
        if (primaryDomainSnapshot) {
          try {
            // Get property URL variants from environment (with/without www)
            const baseDomain = String(process.env.AI_GEO_DOMAIN || process.env.SITE_DOMAIN || "alanranger.com")
              .replace(/^https?:\/\//, "")
              .replace(/^www\./, "")
              .split("/")[0];
            const propertyUrlVariants = [`https://${baseDomain}`, `https://www.${baseDomain}`];

            // Fetch latest audit date for this property (match either variant)
            const propertyUrlFilters = propertyUrlVariants
              .map((url) => `property_url.eq.${encodeURIComponent(url)}`)
              .join(",");
            const latestAuditUrl =
              `${supabaseUrl}/rest/v1/audit_results?or=(${propertyUrlFilters})&order=audit_date.desc&limit=1&select=audit_date,property_url`;
            const latestAuditResp = await fetch(latestAuditUrl, {
              headers: {
                'Content-Type': 'application/json',
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`
              }
            });
            
            if (latestAuditResp.ok) {
              const latestAuditData = await latestAuditResp.json();
              if (Array.isArray(latestAuditData) && latestAuditData.length > 0) {
                const latestAuditDate = latestAuditData[0].audit_date;
                const latestPropertyUrl = latestAuditData[0].property_url || propertyUrlVariants[0];
                
                // Build domain strength object
                const domainStrengthData = {
                  selfScore: primaryDomainSnapshot.score,
                  topCompetitorScore: null, // Will be populated by overview API
                  strongerCount: null, // Will be populated by overview API
                  competitorsCount: null, // Will be populated by overview API
                  snapshotDate: snapshot_date
                };
                
                // Update latest audit record's domain_strength field
                const updateUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(latestPropertyUrl)}&audit_date=eq.${encodeURIComponent(latestAuditDate)}`;
                const updateResp = await fetch(updateUrl, {
                  method: 'PATCH',
                  headers: {
                    'Content-Type': 'application/json',
                    apikey: supabaseKey,
                    Authorization: `Bearer ${supabaseKey}`,
                    Prefer: 'return=minimal'
                  },
                  body: JSON.stringify({
                    domain_strength: domainStrengthData
                  })
                });
                
                if (updateResp.ok) {
                  console.log(`[Domain Strength Snapshot] ✓ Updated audit_results.domain_strength for ${latestAuditDate}`);
                } else {
                  const errorText = await updateResp.text();
                  console.warn(`[Domain Strength Snapshot] ⚠ Failed to update audit_results.domain_strength: ${updateResp.status} - ${errorText}`);
                }
              }
            }
          } catch (updateErr) {
            console.warn(`[Domain Strength Snapshot] ⚠ Error updating audit_results.domain_strength: ${updateErr.message}`);
            // Don't fail the snapshot if this update fails
          }
        }
      }
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
      force,
      includePending,
      caps,
      domains_processed: runDomains.length,
      fetched: domainsToFetch.length,
      reused: runDomains.length - domainsToFetch.length,
      inserted: mode === "run" ? insertPayload.length : 0,
      results,
      debug: {
        primaryDomain,
        includePending,
        pendingLimit,
        pendingDomainsFetched: includePending ? (await dequeuePending({ engine, limit: 1 })).length : 0, // Quick count check
        runDomainsCount: runDomains.length,
        runDomainsSample: runDomains.slice(0, 10), // First 10 for debugging
      },
      meta: { generatedAt: new Date().toISOString(), source: "domain-strength.snapshot" },
    });
  } catch (e) {
    // Ensure we always return JSON, even on unexpected errors
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
      details: e?.message || String(e),
      meta: { generatedAt: new Date().toISOString() },
    });
  }
}

