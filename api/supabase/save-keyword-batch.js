/**
 * Save a batch of keyword rankings incrementally to Supabase
 * This allows partial results to be saved even if later batches fail
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
    const { keywordRows, auditDate, propertyUrl } = req.body;

    if (!keywordRows || !Array.isArray(keywordRows) || keywordRows.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'keywordRows must be a non-empty array',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    if (!auditDate || !propertyUrl) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: auditDate, propertyUrl',
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

    // Insert/update rows using upsert (merge duplicates based on unique constraint)
    const insertResponse = await fetch(`${supabaseUrl}/rest/v1/keyword_rankings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=representation,resolution=merge-duplicates'
      },
      body: JSON.stringify(keywordRows)
    });

    if (insertResponse.ok) {
      const insertedText = await insertResponse.text();
      const insertedResult = insertedText ? JSON.parse(insertedText) : [];
      console.log(`[Save Keyword Batch] ✓ Successfully saved ${insertedResult.length} keyword rows to keyword_rankings table`);
      
      return res.status(200).json({
        status: 'ok',
        message: 'Keyword batch saved successfully',
        data: {
          saved: insertedResult.length,
          attempted: keywordRows.length
        },
        meta: { generatedAt: new Date().toISOString() }
      });
    } else {
      const errorText = await insertResponse.text();
      console.error(`[Save Keyword Batch] ⚠ Failed to save keyword rows: ${insertResponse.status} - ${errorText}`);
      
      return res.status(insertResponse.status).json({
        status: 'error',
        message: 'Failed to save keyword batch to Supabase',
        details: errorText,
        statusCode: insertResponse.status,
        meta: { generatedAt: new Date().toISOString() }
      });
    }
  } catch (error) {
    console.error('[Save Keyword Batch] Exception:', error.message);
    console.error('[Save Keyword Batch] Stack:', error.stack);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: error.message,
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

