/**
 * Get Historical Audit Results from Supabase
 * 
 * Fetches historical schema audit data for trend visualization.
 * Returns data for Content/Schema pillar historical tracking.
 */

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed. Use GET.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    const { propertyUrl, startDate, endDate } = req.query;

    if (!propertyUrl) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required parameter: propertyUrl',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    // Get Supabase credentials from environment
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        status: 'error',
        message: 'Supabase not configured. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    // Build query URL
    let queryUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&order=audit_date.asc`;
    
    if (startDate) {
      queryUrl += `&audit_date=gte.${startDate}`;
    }
    if (endDate) {
      queryUrl += `&audit_date=lte.${endDate}`;
    }

    // Fetch from Supabase
    const response = await fetch(queryUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Supabase error:', errorText);
      return res.status(response.status).json({
        status: 'error',
        message: 'Failed to fetch audit history from Supabase',
        details: errorText,
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const results = await response.json();

    // Transform results to match expected format
    const history = results.map(record => ({
      date: record.audit_date,
      contentSchemaScore: record.content_schema_score,
      schemaCoverage: record.schema_coverage,
      schemaTotalPages: record.schema_total_pages,
      schemaPagesWithSchema: record.schema_pages_with_schema,
      schemaTypes: record.schema_types || [],
      foundationSchemas: record.schema_foundation || {},
      richEligible: record.schema_rich_eligible || {}
    }));

    return res.status(200).json({
      status: 'ok',
      data: history,
      count: history.length,
      meta: { generatedAt: new Date().toISOString() }
    });

  } catch (error) {
    console.error('Error fetching audit history:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: error.message,
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

