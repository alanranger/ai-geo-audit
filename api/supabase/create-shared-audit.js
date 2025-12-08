/**
 * Create Shared Audit Link
 * 
 * Stores audit data with a shareable ID for public sharing/demo purposes.
 */

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed. Use POST.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    const { auditData } = req.body;

    if (!auditData) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required field: auditData',
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

    // Generate a unique share ID (short, URL-friendly)
    const generateShareId = () => {
      const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let result = '';
      for (let i = 0; i < 12; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };

    const shareId = generateShareId();
    
    // Set expiration date (30 days from now)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    // Prepare data for Supabase
    const sharedAuditRecord = {
      share_id: shareId,
      audit_data: auditData, // Store full audit JSON
      expires_at: expiresAt.toISOString(),
      created_at: new Date().toISOString()
    };

    // Insert into Supabase
    const insertUrl = `${supabaseUrl}/rest/v1/shared_audits`;
    
    const response = await fetch(insertUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(sharedAuditRecord)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Create Shared Audit] Supabase error:', errorText);
      return res.status(response.status).json({
        status: 'error',
        message: 'Failed to create shared audit in Supabase',
        details: errorText,
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const result = await response.json();
    const created = Array.isArray(result) ? result[0] : result;

    // Return shareable URL
    const shareUrl = `${req.headers.origin || 'https://ai-geo-audit.vercel.app'}/audit-dashboard.html?share=${shareId}`;

    return res.status(200).json({
      status: 'ok',
      shareId: created.share_id,
      shareUrl: shareUrl,
      expiresAt: created.expires_at,
      meta: { generatedAt: new Date().toISOString() }
    });

  } catch (error) {
    console.error('Error creating shared audit:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: error.message,
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

