/**
 * Test endpoint to verify Google Business Profile API access
 * This will test if the existing OAuth credentials work with Business Profile API
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
  
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed. Use GET.'
    });
  }

  try {
    // Get OAuth credentials
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    
    if (!clientId || !clientSecret || !refreshToken) {
      return res.status(500).json({
        status: 'error',
        message: 'OAuth credentials not configured in environment variables'
      });
    }
    
    // Get access token
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
      return res.status(500).json({
        status: 'error',
        message: 'Failed to get access token',
        error: errorText
      });
    }
    
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    
    // Test Business Profile API - List accounts
    // This is a simple endpoint that requires business.manage scope
    const businessProfileUrl = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts';
    
    const bpResponse = await fetch(businessProfileUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    
    const bpData = await bpResponse.text();
    let bpJson;
    try {
      bpJson = JSON.parse(bpData);
    } catch (e) {
      bpJson = { raw: bpData };
    }
    
    return res.status(200).json({
      status: bpResponse.ok ? 'success' : 'error',
      message: bpResponse.ok 
        ? 'Business Profile API access works! Your refresh token has the required scopes.'
        : 'Business Profile API access failed. You may need to add scopes and re-authorize.',
      httpStatus: bpResponse.status,
      response: bpJson,
      tokenInfo: {
        hasAccessToken: !!accessToken,
        tokenType: tokenData.token_type || 'Bearer'
      }
    });
    
  } catch (error) {
    console.error('Error testing Business Profile API:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unknown error',
      stack: error.stack
    });
  }
}

