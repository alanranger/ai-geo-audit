/**
 * Domain Strength: Domain normalization and pending queue helpers
 * 
 * Shared utilities for:
 * - Domain normalization
 * - Snapshot existence checks
 * - Pending queue management (upsert, dequeue, clear)
 */

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Normalize a domain input to a clean domain string
 * - lower-case
 * - trim
 * - strip protocol (http(s)://)
 * - strip path/query
 * - strip leading www.
 * - reject invalid (return null) if it doesn't look like a domain
 * 
 * @param {string} input - Raw domain input (may include protocol, path, etc.)
 * @returns {string|null} - Normalized domain or null if invalid
 */
export function normalizeDomain(input) {
  if (!input || typeof input !== 'string') return null;
  
  let raw = input.trim().toLowerCase();
  if (!raw) return null;
  
  // Strip protocol
  try {
    if (raw.includes('://')) {
      const url = new URL(raw);
      raw = url.hostname;
    }
  } catch {
    // If URL parsing fails, try manual extraction
    raw = raw.replace(/^https?:\/\//, '');
  }
  
  // Strip path, query, fragment
  raw = raw.split('/')[0].split('?')[0].split('#')[0];
  
  // Strip leading www.
  raw = raw.replace(/^www\./, '');
  
  // Basic validation: should look like a domain (contains at least one dot, no spaces, no special chars except dots and hyphens)
  if (!raw || raw.length === 0) return null;
  if (raw.includes(' ')) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(raw)) return null;
  
  return raw;
}

/**
 * Check if a domain has any snapshot in domain_strength_snapshots
 * 
 * @param {string} domain - Normalized domain
 * @param {string} engine - Search engine (default: 'google')
 * @returns {Promise<boolean>} - True if snapshot exists
 */
export async function hasAnySnapshot(domain, engine = 'google') {
  if (!supabaseUrl || !supabaseKey) return false;
  if (!domain) return false;
  
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;
  
  try {
    const queryUrl =
      `${supabaseUrl}/rest/v1/domain_strength_snapshots` +
      `?domain=eq.${encodeURIComponent(normalized)}` +
      `&engine=eq.${encodeURIComponent(engine)}` +
      `&limit=1`;
    
    const resp = await fetch(queryUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });
    
    if (!resp.ok) return false;
    const rows = await resp.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Upsert domains into domain_rank_pending queue
 * If exists: update last_seen_at = now(), increment seen_count, set source if provided
 * 
 * @param {string[]} domains - Array of domain strings (will be normalized)
 * @param {Object} options - Options
 * @param {string} options.engine - Search engine (default: 'google')
 * @param {string|null} options.source - Source identifier (optional)
 * @returns {Promise<number>} - Number of domains processed
 */
export async function enqueuePending(domains, { engine = 'google', source = null } = {}) {
  if (!supabaseUrl || !supabaseKey) return 0;
  if (!Array.isArray(domains) || domains.length === 0) return 0;
  
  const normalized = domains
    .map(d => normalizeDomain(d))
    .filter(Boolean);
  
  if (normalized.length === 0) return 0;
  
  // Deduplicate
  const unique = [...new Set(normalized)];
  
  let processed = 0;
  
  // Process in chunks to avoid URL length issues
  const chunkSize = 50;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    
    try {
      // First, check which ones already exist (fetch full rows to get seen_count)
      const inList = `(${chunk.map(d => `"${d}"`).join(',')})`;
      const checkUrl =
        `${supabaseUrl}/rest/v1/domain_rank_pending` +
        `?domain=in.${encodeURIComponent(inList)}` +
        `&engine=eq.${encodeURIComponent(engine)}` +
        `&select=domain,seen_count`;
      
      const checkResp = await fetch(checkUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      });
      
      const existing = checkResp.ok ? await checkResp.json() : [];
      const existingDomains = new Set(
        Array.isArray(existing) ? existing.map(r => r.domain) : []
      );
      
      // Map existing rows to get current seen_count
      const existingMap = new Map(
        Array.isArray(existing) ? existing.map(r => [r.domain, r]) : []
      );
      
      // Update existing
      for (const domain of chunk) {
        if (existingDomains.has(domain)) {
          const existing = existingMap.get(domain);
          const currentCount = existing?.seen_count || 1;
          
          const updateUrl =
            `${supabaseUrl}/rest/v1/domain_rank_pending` +
            `?domain=eq.${encodeURIComponent(domain)}` +
            `&engine=eq.${encodeURIComponent(engine)}`;
          
          const updateBody = {
            last_seen_at: new Date().toISOString(),
            seen_count: currentCount + 1,
          };
          if (source) {
            updateBody.source = source;
          }
          
          // Use PATCH for update
          const updateResp = await fetch(updateUrl, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              Prefer: 'return=minimal',
            },
            body: JSON.stringify(updateBody),
          });
          
          if (updateResp.ok) processed++;
        } else {
          // Insert new
          const insertUrl = `${supabaseUrl}/rest/v1/domain_rank_pending`;
          const insertBody = {
            domain,
            search_engine: engine,
            first_seen_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
            seen_count: 1,
            source: source || null,
          };
          
          const insertResp = await fetch(insertUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              Prefer: 'return=minimal',
            },
            body: JSON.stringify(insertBody),
          });
          
          if (insertResp.ok) processed++;
        }
      }
    } catch (e) {
      // Log error but continue with next chunk
      console.error('[enqueuePending] Error processing chunk:', e);
    }
  }
  
  return processed;
}

/**
 * Dequeue pending domains (oldest first by last_seen_at)
 * 
 * @param {Object} options - Options
 * @param {string} options.engine - Search engine (default: 'google')
 * @param {number} options.limit - Max domains to return (default: 100)
 * @returns {Promise<string[]>} - Array of normalized domain strings
 */
export async function dequeuePending({ engine = 'google', limit = 100 } = {}) {
  if (!supabaseUrl || !supabaseKey) return [];
  
  try {
    const queryUrl =
      `${supabaseUrl}/rest/v1/domain_rank_pending` +
      `?engine=eq.${encodeURIComponent(engine)}` +
      `&order=last_seen_at.asc` +
      `&limit=${Math.max(1, Math.min(1000, limit))}` +
      `&select=domain`;
    
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
    return Array.isArray(rows) ? rows.map(r => r.domain).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Remove processed domains from pending queue
 * 
 * @param {string[]} domains - Array of domain strings (will be normalized)
 * @param {string} engine - Search engine (default: 'google')
 * @returns {Promise<number>} - Number of domains removed
 */
export async function clearPending(domains, engine = 'google') {
  if (!supabaseUrl || !supabaseKey) return 0;
  if (!Array.isArray(domains) || domains.length === 0) return 0;
  
  const normalized = domains
    .map(d => normalizeDomain(d))
    .filter(Boolean);
  
  if (normalized.length === 0) return 0;
  
  // Deduplicate
  const unique = [...new Set(normalized)];
  
  let removed = 0;
  
  // Delete per-domain to keep URL length small
  for (const domain of unique) {
    try {
      const deleteUrl =
        `${supabaseUrl}/rest/v1/domain_rank_pending` +
        `?domain=eq.${encodeURIComponent(domain)}` +
        `&engine=eq.${encodeURIComponent(engine)}`;
      
      const resp = await fetch(deleteUrl, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Prefer: 'return=minimal',
        },
      });
      
      if (resp.ok) removed++;
    } catch {
      // Continue with next domain
    }
  }
  
  return removed;
}

