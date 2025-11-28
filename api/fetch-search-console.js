// Vercel Serverless Function to fetch real Google Search Console data
// This function handles OAuth2 authentication and fetches performance data

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
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { propertyUrl, startDate, endDate } = req.body;
    
    if (!propertyUrl || !startDate || !endDate) {
      return res.status(400).json({ error: 'Missing required parameters: propertyUrl, startDate, endDate' });
    }

    // Get OAuth2 credentials from environment variables
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    
    if (!clientId || !clientSecret || !refreshToken) {
      return res.status(500).json({ 
        error: 'OAuth2 credentials not configured. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in Vercel environment variables.' 
      });
    }

    // Get access token using refresh token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      return res.status(401).json({ 
        error: 'Failed to get access token',
        details: errorText 
      });
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Extract site URL (remove https:// and trailing slash)
    const siteUrl = propertyUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    
    // Fetch Search Console performance data
    const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    
    const gscResponse = await fetch(searchConsoleUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate: startDate,
        endDate: endDate,
        dimensions: ['query'],
        rowLimit: 10,
      }),
    });

    if (!gscResponse.ok) {
      const errorText = await gscResponse.text();
      return res.status(gscResponse.status).json({ 
        error: 'Failed to fetch Search Console data',
        details: errorText,
        status: gscResponse.status
      });
    }

    const gscData = await gscResponse.json();
    
    // Calculate aggregated metrics
    let totalClicks = 0;
    let totalImpressions = 0;
    let totalPosition = 0;
    let count = 0;
    const topQueries = [];

    if (gscData.rows && gscData.rows.length > 0) {
      gscData.rows.forEach(row => {
        totalClicks += row.clicks || 0;
        totalImpressions += row.impressions || 0;
        totalPosition += row.position || 0;
        count++;
        
        topQueries.push({
          query: row.keys[0],
          clicks: row.clicks || 0,
          impressions: row.impressions || 0,
          position: row.position || 0,
          ctr: row.ctr || 0
        });
      });
    }

    // Calculate average position
    const averagePosition = count > 0 ? totalPosition / count : 0;
    
    // Calculate overall CTR
    const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

    return res.status(200).json({
      totalClicks,
      totalImpressions,
      averagePosition,
      ctr,
      topQueries,
      dateRange: {
        startDate,
        endDate
      }
    });

  } catch (error) {
    console.error('Error fetching Search Console data:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

