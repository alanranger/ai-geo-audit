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

    // Extract site URL - Search Console API requires exact format as registered
    // Try different formats: with https://, with http://, or domain only
    let siteUrl = propertyUrl.trim();
    
    // Remove trailing slash
    siteUrl = siteUrl.replace(/\/$/, '');
    
    // If no protocol specified, try https:// first (most common)
    if (!siteUrl.match(/^https?:\/\//)) {
      siteUrl = `https://${siteUrl}`;
    }
    
    const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    
    // First, get overall aggregate data (no dimensions = site-wide totals)
    const aggregateResponse = await fetch(searchConsoleUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate: startDate,
        endDate: endDate,
        // No dimensions = get aggregate totals for entire site
      }),
    });

    if (!aggregateResponse.ok) {
      const errorText = await aggregateResponse.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        errorData = { error: { message: errorText } };
      }
      
      // If permission error, provide helpful message
      if (aggregateResponse.status === 403) {
        return res.status(403).json({ 
          error: 'Permission denied',
          message: errorData.error?.message || 'User does not have access to this Search Console property',
          suggestion: 'Make sure: 1) The property URL matches exactly how it appears in Search Console (check if it uses https:// or http://), 2) The Google account used for the refresh token has access to this property, 3) The property is verified in Search Console',
          attemptedUrl: siteUrl
        });
      }
      
      return res.status(aggregateResponse.status).json({ 
        error: 'Failed to fetch Search Console data',
        details: errorData,
        status: aggregateResponse.status,
        attemptedUrl: siteUrl
      });
    }

    const aggregateData = await aggregateResponse.json();
    
    // Extract overall totals from aggregate response
    let totalClicks = 0;
    let totalImpressions = 0;
    let totalPosition = 0;
    let totalCtr = 0;
    
    if (aggregateData.rows && aggregateData.rows.length > 0) {
      // Aggregate response should have one row with totals
      const row = aggregateData.rows[0];
      totalClicks = row.clicks || 0;
      totalImpressions = row.impressions || 0;
      totalPosition = row.position || 0;
      totalCtr = row.ctr || 0;
    }

    // Now fetch top queries separately
    const queriesResponse = await fetch(searchConsoleUrl, {
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

    const topQueries = [];
    if (queriesResponse.ok) {
      const queriesData = await queriesResponse.json();
      if (queriesData.rows && queriesData.rows.length > 0) {
        queriesData.rows.forEach(row => {
          topQueries.push({
            query: row.keys[0],
            clicks: row.clicks || 0,
            impressions: row.impressions || 0,
            position: row.position || 0,
            ctr: row.ctr || 0
          });
        });
      }
    }

    // Use CTR from API if available, otherwise calculate
    const ctr = totalCtr > 0 ? totalCtr * 100 : (totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0);

    return res.status(200).json({
      totalClicks,
      totalImpressions,
      averagePosition: totalPosition, // This is already the average from the API
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

