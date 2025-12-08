/**
 * Get Shared Audit Results from Supabase
 * 
 * Fetches audit data by shareable ID for public sharing/demo purposes.
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
    const { shareId } = req.query;

    if (!shareId) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required parameter: shareId',
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

    // Query Supabase for shared audit
    const queryUrl = `${supabaseUrl}/rest/v1/shared_audits?share_id=eq.${encodeURIComponent(shareId)}&select=*`;

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
      console.error('[Get Shared Audit] Supabase error:', errorText);
      return res.status(response.status).json({
        status: 'error',
        message: 'Failed to fetch shared audit from Supabase',
        details: errorText,
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const results = await response.json();

    if (!results || results.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Shared audit not found',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const sharedAudit = results[0];

    // Return the full audit data
    return res.status(200).json({
      status: 'ok',
      data: sharedAudit.audit_data, // Full audit JSON object
      shareId: sharedAudit.share_id,
      createdAt: sharedAudit.created_at,
      expiresAt: sharedAudit.expires_at,
      meta: { generatedAt: new Date().toISOString() }
    });

  } catch (error) {
    console.error('Error fetching shared audit:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: error.message,
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

