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

    // Get the latest audit for this property
    const auditUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&order=audit_date.desc&limit=1&select=id,audit_date,schema_pages_detail`;
    
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

    const record = audits[0];
    let pagesDetail = record.schema_pages_detail;

    if (!pagesDetail) {
      return res.status(200).json({
        status: 'ok',
        data: null,
        message: 'No schema pages detail in audit'
      });
    }

    // Parse if stored as string
    if (typeof pagesDetail === 'string') {
      try {
        pagesDetail = JSON.parse(pagesDetail);
      } catch (e) {
        return res.status(200).json({
          status: 'ok',
          data: null,
          message: 'Failed to parse schema_pages_detail JSON'
        });
      }
    }

    if (!Array.isArray(pagesDetail) || pagesDetail.length === 0) {
      return res.status(200).json({
        status: 'ok',
        data: null,
        message: 'Schema pages detail is not an array or is empty'
      });
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

    const normalizedSearchUrl = normalizeUrl(searchUrl);

    // Search through ALL pages (not truncated)
    const pageData = pagesDetail.find(p => {
      if (!p || !p.url) return false;
      const pNormalized = normalizeUrl(p.url);
      const exactMatch = pNormalized === normalizedSearchUrl;
      const homepageMatch = (normalizedSearchUrl === '/' || normalizedSearchUrl === '') && (pNormalized === '/' || pNormalized === '');
      return exactMatch || homepageMatch;
    });

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

