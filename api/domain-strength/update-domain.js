/**
 * Update domain metadata (domain_type, is_competitor, competitor_notes)
 * 
 * POST /api/domain-strength/update-domain
 * Body: { domain, domain_type?, is_competitor?, competitor_notes? }
 */

function normalizeDomain(input) {
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
  if (!raw || raw.includes(' ') || !raw.includes('.')) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(raw)) return null;
  
  return raw;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed. Use POST.',
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      status: 'error',
      message: 'Supabase not configured. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.',
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { domain: rawDomain, domain_type, is_competitor, competitor_notes } = body || {};

    const domain = normalizeDomain(rawDomain);
    if (!domain) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid domain. Must be a valid domain name.',
        meta: { generatedAt: new Date().toISOString() },
      });
    }

    // Build update payload (only include fields that are provided)
    const updatePayload = {
      updated_at: new Date().toISOString(),
    };

    // Update domain_type if provided
    if (domain_type !== undefined && domain_type !== null) {
      const validTypes = ['your_site', 'platform', 'directory', 'publisher', 'vendor', 'institution', 'government', 'site', 'unmapped'];
      if (validTypes.includes(domain_type)) {
        updatePayload.domain_type = domain_type;
        updatePayload.domain_type_source = 'manual';
        updatePayload.domain_type_confidence = 100;
        updatePayload.domain_type_reason = 'manual override via UI';
        // Also update segment for backward compatibility
        updatePayload.segment = domain_type;
      } else {
        return res.status(400).json({
          status: 'error',
          message: `Invalid domain_type. Must be one of: ${validTypes.join(', ')}`,
          meta: { generatedAt: new Date().toISOString() },
        });
      }
    }

    // Update is_competitor if provided
    if (is_competitor !== undefined && is_competitor !== null) {
      updatePayload.is_competitor = Boolean(is_competitor);
    }

    // Update competitor_notes if provided
    if (competitor_notes !== undefined) {
      updatePayload.competitor_notes = competitor_notes || null;
    }

    // Always include domain in payload for upsert
    updatePayload.domain = domain;
    
    // If domain_type is not being updated, ensure we have defaults for new records
    if (updatePayload.domain_type === undefined) {
      // Check if domain exists to see if we should preserve existing values
      const checkUrl = `${supabaseUrl}/rest/v1/domain_strength_domains?domain=eq.${encodeURIComponent(domain)}&select=domain,domain_type,is_competitor&limit=1`;
      const checkResp = await fetch(checkUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      });

      const existing = checkResp.ok ? await checkResp.json() : [];
      const existingRecord = Array.isArray(existing) && existing.length > 0 ? existing[0] : null;

      if (!existingRecord) {
        // New record - set defaults
        updatePayload.label = domain;
        updatePayload.domain_type = 'unmapped';
        updatePayload.domain_type_source = 'manual';
        updatePayload.segment = 'unmapped';
        if (updatePayload.is_competitor === undefined) {
          updatePayload.is_competitor = false;
        }
      } else {
        // Existing record - preserve existing values if not being updated
        if (updatePayload.domain_type === undefined) {
          updatePayload.domain_type = existingRecord.domain_type || 'unmapped';
        }
        if (updatePayload.is_competitor === undefined) {
          updatePayload.is_competitor = existingRecord.is_competitor === true;
        }
      }
    } else {
      // domain_type is being updated, ensure label exists for new records
      if (!updatePayload.label) {
        updatePayload.label = domain;
      }
      if (updatePayload.is_competitor === undefined) {
        updatePayload.is_competitor = false;
      }
    }

    // Use POST with upsert (merge on conflict with domain as primary key)
    const upsertUrl = `${supabaseUrl}/rest/v1/domain_strength_domains`;
    const upsertResp = await fetch(upsertUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(updatePayload),
    });

    if (!upsertResp.ok) {
      const errorText = await upsertResp.text();
      return res.status(upsertResp.status).json({
        status: 'error',
        message: 'Failed to update domain metadata',
        details: errorText,
        meta: { generatedAt: new Date().toISOString() },
      });
    }

    const updated = await upsertResp.json();
    const result = Array.isArray(updated) ? updated[0] : updated;

    return res.status(200).json({
      status: 'ok',
      domain: result.domain,
      domain_type: result.domain_type || 'unmapped',
      is_competitor: result.is_competitor === true,
      competitor_notes: result.competitor_notes || null,
      meta: { generatedAt: new Date().toISOString(), source: 'domain_strength_domains' },
    });

  } catch (e) {
    console.error('[update-domain] Error:', e);
    return res.status(500).json({
      status: 'error',
      message: e.message || 'Internal server error',
      meta: { generatedAt: new Date().toISOString() },
    });
  }
}

