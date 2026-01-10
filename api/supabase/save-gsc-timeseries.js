/**
 * Save GSC Timeseries Data to Supabase
 * 
 * Stores GSC timeseries data (daily clicks, impressions, CTR, position) for caching.
 * This avoids repeated API calls for historical data that never changes.
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
    const { propertyUrl, timeseries } = req.body;

    if (!propertyUrl || !timeseries || !Array.isArray(timeseries)) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: propertyUrl, timeseries (array)',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    // Get Supabase credentials from environment
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(200).json({
        status: 'skipped',
        message: 'Supabase not configured. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.',
        saved: 0
      });
    }

    // Prepare data for Supabase (upsert format)
    const records = timeseries.map(point => ({
      property_url: propertyUrl,
      date: point.date, // Format: YYYY-MM-DD
      clicks: point.clicks || 0,
      impressions: point.impressions || 0,
      ctr: parseFloat(point.ctr) || 0,
      position: parseFloat(point.position) || 0,
      updated_at: new Date().toISOString()
    }));

    // Insert or update (upsert) using Supabase REST API
    // For bulk upserts, we need to handle duplicates gracefully
    // Try POST first, and if we get duplicate errors, handle them individually
    let response = await fetch(`${supabaseUrl}/rest/v1/gsc_timeseries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'resolution=merge-duplicates' // Upsert behavior
      },
      body: JSON.stringify(records)
    });

    // If we get a conflict error, try individual upserts
    if (response.status === 409 || !response.ok) {
      const errorText = await response.text();
      console.warn('Bulk insert failed, trying individual upserts:', errorText);
      
      // Try individual records with upsert
      let successCount = 0;
      let errorCount = 0;
      
      for (const record of records) {
        try {
          const individualResponse = await fetch(`${supabaseUrl}/rest/v1/gsc_timeseries`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify(record)
          });
          
          if (individualResponse.ok || individualResponse.status === 409) {
            // 409 means duplicate, which is fine - record already exists
            successCount++;
          } else {
            const errorText = await individualResponse.text();
            console.warn(`Failed to save record for ${record.date}:`, errorText);
            errorCount++;
          }
        } catch (err) {
          console.warn(`Error saving individual record for ${record.date}:`, err.message);
          errorCount++;
        }
      }
      
      return res.status(200).json({
        status: 'ok',
        message: `Saved ${successCount} GSC timeseries records (${errorCount} errors, duplicates ignored)`,
        saved: successCount,
        errors: errorCount,
        meta: {
          propertyUrl,
          recordsCount: records.length,
          generatedAt: new Date().toISOString()
        }
      });
    }

    const result = await response.json();
    const savedCount = Array.isArray(result) ? result.length : records.length;

    return res.status(200).json({
      status: 'ok',
      message: `Saved ${savedCount} GSC timeseries records to Supabase`,
      saved: savedCount,
      meta: {
        propertyUrl,
        recordsCount: records.length,
        generatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error saving GSC timeseries to Supabase:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: error.message,
      saved: 0
    });
  }
}



