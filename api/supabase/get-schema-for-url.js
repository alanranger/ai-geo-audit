// /api/supabase/get-schema-for-url.js
// Get schema data for a specific URL from the latest audit
// This queries the full schema_pages_detail JSONB field, not the truncated array

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed'
    });
  }

  try {
    const { propertyUrl, searchUrl } = req.query;

    if (!propertyUrl || !searchUrl) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required parameters: propertyUrl and searchUrl'
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        status: 'error',
        message: 'Supabase not configured'
      });
    }

    // Get a few most-recent audits that have schema_pages_detail.
    // We may have a newer audit with schema summary fields but without the full per-URL array,
    // or a truncated/partial array. We'll search across a small window of recent audits.
    const auditUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&is_partial=eq.false&schema_pages_detail=not.is.null&order=audit_date.desc,updated_at.desc&limit=5&select=id,audit_date,updated_at,schema_pages_detail`;
    
    const auditRes = await fetch(auditUrl, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!auditRes.ok) {
      throw new Error(`Supabase query failed: ${auditRes.status} ${auditRes.statusText}`);
    }

    const audits = await auditRes.json();

    if (!audits || audits.length === 0) {
      return res.status(200).json({
        status: 'ok',
        data: null,
        message: 'No audit found for this property'
      });
    }

    function parsePagesDetail(pagesDetail) {
      if (!pagesDetail) return null;
      let parsed = pagesDetail;
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch (_) {
          return null;
        }
      }
      if (!Array.isArray(parsed) || parsed.length === 0) return null;
      return parsed;
    }

    // Normalize the search URL (strip query params, hash, trailing slashes)
    function normalizeUrl(url) {
      if (!url || typeof url !== 'string') return '';
      let normalized = url.toLowerCase().trim();
      // Strip query params and hash
      normalized = normalized.split('?')[0].split('#')[0];
      try {
        let urlToParse = normalized;
        if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
          urlToParse = 'https://www.alanranger.com' + (normalized.startsWith('/') ? normalized : '/' + normalized);
        }
        const urlObj = new URL(urlToParse);
        normalized = urlObj.pathname.toLowerCase().replace(/\/$/, '').trim();
        if (!normalized || normalized === '/') {
          normalized = '/';
        }
      } catch (e) {
        normalized = normalized.replace(/\/$/, '').trim();
        if (normalized && !normalized.startsWith('/')) {
          normalized = '/' + normalized;
        }
        if (!normalized || normalized === '/') {
          normalized = '/';
        }
      }
      return normalized;
    }

    function normalizeLooseSlug(pathname) {
      const p = (pathname || '').toString().toLowerCase().trim();
      const last = p.split('/').filter(Boolean).pop() || '';
      return last.replace(/[^a-z0-9]/g, '');
    }

    const normalizedSearchUrl = normalizeUrl(searchUrl);
    const normalizedSearchLoose = normalizeLooseSlug(normalizedSearchUrl);

    let pageData = null;
    let matchedAudit = null;

    for (const record of audits) {
      const pagesDetail = parsePagesDetail(record.schema_pages_detail);
      if (!pagesDetail) continue;

      // Exact path match first
      pageData = pagesDetail.find(p => {
        if (!p || !p.url) return false;
        const pNormalized = normalizeUrl(p.url);
        const exactMatch = pNormalized === normalizedSearchUrl;
        const homepageMatch = (normalizedSearchUrl === '/' || normalizedSearchUrl === '') && (pNormalized === '/' || pNormalized === '');
        return exactMatch || homepageMatch;
      });

      // Fallback: loose slug match for variant/redirect slugs (e.g. "121" vs "1-2-1")
      if (!pageData && normalizedSearchLoose) {
        pageData = pagesDetail.find(p => {
          if (!p || !p.url) return false;
          const pNormalized = normalizeUrl(p.url);
          const pLoose = normalizeLooseSlug(pNormalized);
          return pLoose && pLoose === normalizedSearchLoose;
        });
      }

      if (pageData) {
        matchedAudit = record;
        break;
      }
    }

    if (!pageData) {
      return res.status(200).json({
        status: 'ok',
        data: null,
        message: `No page found matching URL: ${searchUrl} (normalized: ${normalizedSearchUrl})`
      });
    }

    // Return the page data with schema types
    return res.status(200).json({
      status: 'ok',
      data: {
        auditDate: matchedAudit?.audit_date || null,
        auditUpdatedAt: matchedAudit?.updated_at || null,
        url: pageData.url,
        title: pageData.title || null,
        metaDescription: pageData.metaDescription || null,
        hasSchema: pageData.hasSchema === true,
        hasInheritedSchema: pageData.hasInheritedSchema === true,
        schemaTypes: Array.isArray(pageData.schemaTypes) ? pageData.schemaTypes : (pageData.schemaTypes ? [pageData.schemaTypes] : []),
        error: pageData.error || null,
        errorType: pageData.errorType || null
      }
    });

  } catch (error) {
    console.error('[get-schema-for-url] Error:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Internal server error'
    });
  }
}

