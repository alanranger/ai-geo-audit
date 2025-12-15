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
  const snapshotData = Array.isArray(rows) ? rows : [];
  
  // Step 4: Enqueue missing domains (domains requested but with no snapshots)
  if (domains.length > 0) {
    try {
      const domainsWithSnapshots = new Set(snapshotData.map(r => r.domain).filter(Boolean));
      const missingDomains = domains.filter(d => !domainsWithSnapshots.has(d));
      
      if (missingDomains.length > 0) {
        // Import enqueuePending helper
        const { enqueuePending } = await import('../../lib/domainStrength/domains.js');
        await enqueuePending(missingDomains, { engine: 'google', source: 'history-miss' });
        
        // Auto-classify missing domains (non-blocking)
        try {
          const { createClient } = await import('@supabase/supabase-js');
          const { ensureDomainTypeMapping } = await import('../../lib/domainTypeClassifier.js');
          const supabaseClient = createClient(supabaseUrl, supabaseKey, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
          });
          
          // Classify in parallel (non-blocking, don't await)
          Promise.all(missingDomains.map(d => 
            ensureDomainTypeMapping(supabaseClient, d, 'history-miss')
              .catch(err => console.error(`[history] Error classifying ${d}:`, err))
          )).catch(() => {}); // Swallow errors
        } catch (classifyError) {
          // Graceful: if classification fails, continue without it
          console.error('Error auto-classifying missing domains:', classifyError);
        }
      }
    } catch (enqueueError) {
      // Graceful: if enqueue fails, continue without it
      console.error('Error enqueuing missing domains:', enqueueError);
    }
  }
  
  // Fetch domain metadata (label, segment) from domain_strength_domains
  const domainMeta = new Map();
  if (snapshotData.length > 0) {
    try {
      const uniqueDomains = [...new Set(snapshotData.map(r => r.domain).filter(Boolean))];
      if (uniqueDomains.length > 0) {
        // Query in chunks to avoid URL length limits
        const chunkSize = 100;
        for (let i = 0; i < uniqueDomains.length; i += chunkSize) {
          const chunk = uniqueDomains.slice(i, i + chunkSize);
          const inList = `(${chunk.map(d => `"${d}"`).join(',')})`;
          const metaUrl =
            `${supabaseUrl}/rest/v1/domain_strength_domains` +
            `?domain=in.${encodeURIComponent(inList)}` +
            `&select=domain,label,domain_type,segment`;
          
          const metaResp = await fetch(metaUrl, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
            },
          });
          
          if (metaResp.ok) {
            const metaRows = await metaResp.json();
            if (Array.isArray(metaRows)) {
              metaRows.forEach(r => {
                if (r.domain) {
                  const domainType = r.domain_type || r.segment || 'unmapped';
                  domainMeta.set(r.domain, {
                    label: r.label || null,
                    domain_type: domainType,
                    segment: domainType, // Backward compatibility
                  });
                }
              });
            }
          }
        }
      }
    } catch {
      // Graceful: if metadata fetch fails, continue without it
    }
  }
  
      // Enrich snapshot data with metadata
      const enrichedData = snapshotData.map(row => {
        const meta = domainMeta.get(row.domain) || { label: null, domain_type: 'unmapped', segment: 'unmapped' };
        return {
          ...row,
          label: meta.label,
          domain_type: meta.domain_type || 'unmapped',
          segment: meta.segment || meta.domain_type || 'unmapped', // Use 'unmapped' as fallback, not 'other'
        };
      });
  
  return res.status(200).json({
    status: "ok",
    data: enrichedData,
    count: enrichedData.length,
    meta: { generatedAt: new Date().toISOString(), source: "domain_strength_snapshots" },
  });
}

