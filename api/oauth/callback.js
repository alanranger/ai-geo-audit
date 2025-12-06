/**
 * OAuth Callback Handler
 * Handles the OAuth redirect from Google and exchanges the code for tokens
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
    const { code, error } = req.query;
    
    // Check for errors from Google
    if (error) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>OAuth Error</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
            .error { background: #fee; border: 2px solid #fcc; padding: 20px; border-radius: 8px; }
            .code { background: #f5f5f5; padding: 10px; border-radius: 4px; font-family: monospace; word-break: break-all; }
          </style>
        </head>
        <body>
          <h1>OAuth Authorization Error</h1>
          <div class="error">
            <p><strong>Error:</strong> ${error}</p>
            <p>Please try again or contact support if this persists.</p>
          </div>
          <p><a href="/oauth-helper.html">← Back to OAuth Helper</a></p>
        </body>
        </html>
      `);
    }
    
    // Check if we have an authorization code
    if (!code) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>OAuth Callback</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
            .info { background: #e3f2fd; border: 2px solid #2196f3; padding: 20px; border-radius: 8px; }
            .code { background: #f5f5f5; padding: 15px; border-radius: 4px; font-family: monospace; word-break: break-all; margin: 10px 0; }
            button { background: #2196f3; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }
          </style>
        </head>
        <body>
          <h1>OAuth Callback</h1>
          <div class="info">
            <p>No authorization code received. Please try the authorization process again.</p>
          </div>
          <p><a href="/oauth-helper.html">← Back to OAuth Helper</a></p>
        </body>
        </html>
      `);
    }
    
    // Get OAuth credentials from environment
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    
    // Construct redirect URI - must match EXACTLY what was used in authorization request
    // Use the request URL to ensure exact match
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host || req.headers['x-forwarded-host'];
    const redirectUri = `${protocol}://${host}/api/oauth/callback`;
    
    console.log('[OAuth Callback] Redirect URI:', redirectUri);
    console.log('[OAuth Callback] Client ID:', clientId ? `${clientId.substring(0, 20)}...` : 'NOT SET');
    
    if (!clientId || !clientSecret) {
      return res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Configuration Error</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
            .error { background: #fee; border: 2px solid #fcc; padding: 20px; border-radius: 8px; }
          </style>
        </head>
        <body>
          <h1>Configuration Error</h1>
          <div class="error">
            <p>OAuth credentials not configured in environment variables.</p>
            <p>Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel.</p>
          </div>
        </body>
        </html>
      `);
    }
    
    // Exchange code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    
    const tokenData = await tokenResponse.json();
    
    console.log('[OAuth Callback] Token exchange response status:', tokenResponse.status);
    console.log('[OAuth Callback] Token exchange error:', tokenData.error || 'none');
    
    if (!tokenResponse.ok || !tokenData.refresh_token) {
      const errorDetails = tokenData.error_description || tokenData.error || 'Unknown error';
      console.error('[OAuth Callback] Token exchange failed:', errorDetails);
      
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Token Exchange Error</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
            .error { background: #fee; border: 2px solid #fcc; padding: 20px; border-radius: 8px; }
            .code { background: #f5f5f5; padding: 10px; border-radius: 4px; font-family: monospace; word-break: break-all; }
          </style>
        </head>
        <body>
          <h1>Token Exchange Error</h1>
          <div class="error">
            <p><strong>Error:</strong> ${tokenData.error || 'Unknown error'}</p>
            <p><strong>Description:</strong> ${tokenData.error_description || 'Failed to exchange authorization code for tokens'}</p>
            <p>This might happen if:</p>
            <ul>
              <li>The authorization code has expired (codes expire after 10 minutes)</li>
              <li>The code was already used</li>
              <li>There's a mismatch in redirect URIs</li>
            </ul>
          </div>
          <p><a href="/oauth-helper.html">← Back to OAuth Helper</a></p>
        </body>
        </html>
      `);
    }
    
    // Success! Display the refresh token
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>OAuth Success</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 700px; margin: 50px auto; padding: 20px; }
          .success { background: #d4edda; border: 2px solid #28a745; padding: 20px; border-radius: 8px; }
          .code { background: #f5f5f5; padding: 15px; border-radius: 4px; font-family: monospace; word-break: break-all; margin: 10px 0; font-size: 14px; }
          button { background: #28a745; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; margin: 5px; }
          button:hover { background: #218838; }
          .instructions { background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 4px; margin: 20px 0; }
          .instructions ol { margin: 10px 0; padding-left: 20px; }
          .instructions code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
        </style>
      </head>
      <body>
        <h1>✓ OAuth Authorization Successful!</h1>
        <div class="success">
          <p><strong>Your new refresh token (with Business Profile scope):</strong></p>
          <div class="code" id="refreshToken">${tokenData.refresh_token}</div>
          <button onclick="copyToken()">Copy Token</button>
          <span id="copied" style="display: none; color: #28a745; margin-left: 10px;">✓ Copied!</span>
        </div>
        
        <div class="instructions">
          <p><strong>Next steps:</strong></p>
          <ol>
            <li>Copy the refresh token above</li>
            <li>Go to <a href="https://vercel.com" target="_blank">Vercel</a> → Your Project → Settings → Environment Variables</li>
            <li>Update the <code>GOOGLE_REFRESH_TOKEN</code> variable with the new token</li>
            <li>Redeploy your application</li>
            <li>Test the Business Profile API access again</li>
          </ol>
          <p style="margin-top: 15px; color: #666; font-size: 14px;">
            <strong>Note:</strong> This token includes both GSC and Business Profile scopes, so it will work for both APIs.
          </p>
        </div>
        
        <p><a href="/oauth-helper.html">← Back to OAuth Helper</a></p>
        
        <script>
          function copyToken() {
            const token = document.getElementById('refreshToken').textContent;
            navigator.clipboard.writeText(token).then(() => {
              document.getElementById('copied').style.display = 'inline';
              setTimeout(() => {
                document.getElementById('copied').style.display = 'none';
              }, 2000);
            });
          }
        </script>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    return res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Server Error</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
          .error { background: #fee; border: 2px solid #fcc; padding: 20px; border-radius: 8px; }
        </style>
      </head>
      <body>
        <h1>Server Error</h1>
        <div class="error">
          <p><strong>Error:</strong> ${error.message}</p>
          <p>Please try again or contact support if this persists.</p>
        </div>
        <p><a href="/oauth-helper.html">← Back to OAuth Helper</a></p>
      </body>
      </html>
    `);
  }
}

