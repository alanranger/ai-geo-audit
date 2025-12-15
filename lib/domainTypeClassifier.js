/**
 * Domain Type Classifier
 * 
 * Provides conservative auto-suggest classification for domain_type.
 * Only classifies obvious cases; everything else remains unmapped.
 */

/**
 * Normalizes a domain string: lower-case, trim, strip protocol, strip path/query, strip leading www.
 * @param {string} input
 * @returns {string|null}
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
    raw = raw.replace(/^https?:\/\//, '');
  }
  
  // Strip path, query, fragment
  raw = raw.split('/')[0].split('?')[0].split('#')[0];
  
  // Strip leading www.
  raw = raw.replace(/^www\./, '');
  
  // Basic validation
  if (!raw || raw.length === 0 || raw.includes(' ')) return null;
  
  return raw;
}

/**
 * Suggests a domain_type for a given domain using conservative deterministic rules.
 * Returns null if no confident classification can be made.
 * 
 * @param {string} domain - Normalized domain string
 * @returns {{domain_type: string, confidence: number, reason: string}|null}
 */
export function suggestDomainType(domain) {
  if (!domain || typeof domain !== 'string') return null;
  
  const normalized = normalizeDomain(domain);
  if (!normalized) return null;
  
  // Rule 1: your_site - exact match
  if (normalized === 'alanranger.com') {
    return {
      domain_type: 'your_site',
      confidence: 100,
      reason: 'Exact match'
    };
  }
  
  // Rule 2: platform - exact match allowlist
  const platformDomains = [
    'google.com',
    'youtube.com',
    'wikipedia.org',
    'facebook.com',
    'instagram.com',
    'tiktok.com',
    'x.com',
    'twitter.com',
    'linkedin.com',
    'reddit.com',
    'quora.com',
    'github.com',
    'medium.com'
  ];
  
  if (platformDomains.includes(normalized)) {
    return {
      domain_type: 'platform',
      confidence: 100,
      reason: 'Known platform'
    };
  }
  
  // Rule 3: institution - TLD patterns
  if (normalized.endsWith('.ac.uk') || normalized.endsWith('.edu') || normalized.endsWith('.gov.uk')) {
    return {
      domain_type: 'institution',
      confidence: 90,
      reason: 'Institution TLD pattern'
    };
  }
  
  // Rule 4: directory - exact match allowlist
  const directoryDomains = [
    'bark.com',
    'yelp.com',
    'tripadvisor.com',
    'trustpilot.com',
    'findtutors.co.uk',
    'yell.com'
  ];
  
  if (directoryDomains.includes(normalized)) {
    return {
      domain_type: 'directory',
      confidence: 100,
      reason: 'Known directory'
    };
  }
  
  // No confident classification
  return null;
}

/**
 * Ensures a domain has a domain_type mapping in domain_strength_domains.
 * Only writes if safe to do so (won't overwrite manual classifications).
 * 
 * @param {Object} supabaseClient - Supabase client instance
 * @param {string} rawDomain - Raw domain input (will be normalized)
 * @param {string} sourceTag - Source tag (e.g., 'history-miss', 'autofill', 'seed')
 * @returns {Promise<{action: string, domain: string, domain_type: string|null, confidence: number|null}>}
 */
export async function ensureDomainTypeMapping(supabaseClient, rawDomain, sourceTag = 'auto') {
  if (!supabaseClient) {
    throw new Error('Supabase client is required');
  }
  
  const normalized = normalizeDomain(rawDomain);
  if (!normalized) {
    return { action: 'skipped', domain: rawDomain, domain_type: null, confidence: null, reason: 'Invalid domain' };
  }
  
  // Get suggestion
  const suggestion = suggestDomainType(normalized);
  
  // Read existing row
  const { data: existing, error: readError } = await supabaseClient
    .from('domain_strength_domains')
    .select('domain, domain_type, domain_type_source')
    .eq('domain', normalized)
    .single();
  
  if (readError && readError.code !== 'PGRST116') { // PGRST116 = not found
    console.error(`[ensureDomainTypeMapping] Error reading domain ${normalized}:`, readError);
    return { action: 'error', domain: normalized, domain_type: null, confidence: null, reason: readError.message };
  }
  
  const exists = !!existing;
  const currentSource = existing?.domain_type_source;
  const currentType = existing?.domain_type;
  
  // Decision logic: only write if safe
  const shouldWrite = 
    !exists || // No row exists
    !currentType || // Row exists but domain_type is null/empty
    currentType === 'unmapped' || // Row exists but is unmapped
    (currentSource === 'auto' && suggestion); // Row exists with auto source and we have a new suggestion
  
  // NEVER overwrite manual classifications
  if (exists && currentSource === 'manual') {
    return { action: 'skipped', domain: normalized, domain_type: currentType, confidence: null, reason: 'Manual classification exists' };
  }
  
  // If no suggestion, don't write (leave unmapped)
  if (!suggestion) {
    if (!exists) {
      // Insert unmapped row (optional - you might want to skip this)
      // For now, we'll skip inserting unmapped rows
      return { action: 'skipped', domain: normalized, domain_type: null, confidence: null, reason: 'No suggestion' };
    }
    return { action: 'skipped', domain: normalized, domain_type: currentType || 'unmapped', confidence: null, reason: 'No suggestion' };
  }
  
  if (!shouldWrite) {
    return { action: 'skipped', domain: normalized, domain_type: currentType, confidence: null, reason: 'Already classified' };
  }
  
  // Prepare upsert data
  const upsertData = {
    domain: normalized,
    domain_type: suggestion.domain_type,
    domain_type_source: 'auto',
    domain_type_confidence: suggestion.confidence,
    domain_type_reason: suggestion.reason,
    segment: suggestion.domain_type, // Keep segment for backward compatibility
    updated_at: new Date().toISOString()
  };
  
  // Add label if it doesn't exist
  if (!exists || !existing.label) {
    // Use a simple label based on domain (capitalize first letter of each part)
    const labelParts = normalized.split('.');
    upsertData.label = labelParts[0].charAt(0).toUpperCase() + labelParts[0].slice(1);
  } else {
    upsertData.label = existing.label;
  }
  
  // Upsert
  const { error: upsertError } = await supabaseClient
    .from('domain_strength_domains')
    .upsert(upsertData, { onConflict: 'domain' });
  
  if (upsertError) {
    console.error(`[ensureDomainTypeMapping] Error upserting domain ${normalized}:`, upsertError);
    return { action: 'error', domain: normalized, domain_type: null, confidence: null, reason: upsertError.message };
  }
  
  return {
    action: exists ? 'updated' : 'inserted',
    domain: normalized,
    domain_type: suggestion.domain_type,
    confidence: suggestion.confidence,
    reason: suggestion.reason
  };
}

