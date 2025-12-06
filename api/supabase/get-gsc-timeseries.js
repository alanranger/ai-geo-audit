/**
 * Get GSC Timeseries Data from Supabase
 * 
 * Fetches stored GSC timeseries data for a property and date range.
 * Used to avoid repeated API calls for historical data.
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

    if (!propertyUrl || !startDate || !endDate) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing required parameters: propertyUrl, startDate, endDate',
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
        data: []
      });
    }

    // Query Supabase for timeseries data in date range
    const queryUrl = `${supabaseUrl}/rest/v1/gsc_timeseries?property_url=eq.${encodeURIComponent(propertyUrl)}&date=gte.${startDate}&date=lte.${endDate}&order=date.asc`;
    
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
      console.error('Supabase query error:', errorText);
      return res.status(response.status).json({
        status: 'error',
        message: 'Failed to fetch GSC timeseries from Supabase',
        details: errorText,
        data: []
      });
    }

    const data = await response.json();
    
    // Format data to match GSC API response format
    const timeseries = data.map(record => ({
      date: record.date,
      clicks: record.clicks || 0,
      impressions: record.impressions || 0,
      ctr: parseFloat(record.ctr) || 0,
      position: parseFloat(record.position) || 0
    }));

    return res.status(200).json({
      status: 'ok',
      message: `Fetched ${timeseries.length} stored GSC timeseries records`,
      data: timeseries,
      meta: {
        propertyUrl,
        startDate,
        endDate,
        count: timeseries.length,
        generatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error fetching GSC timeseries from Supabase:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: error.message,
      data: []
    });
  }
}


