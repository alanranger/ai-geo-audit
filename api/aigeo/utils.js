/**
 * Shared utilities for AI GEO Audit API routes
 * Data-layer only - no UI dependencies
 */

/**
 * Parse date range from request query with defaults
 * @param {Object} req - Request object
 * @param {boolean} accountForGSCDelay - If true, subtract 2 days from endDate to account for GSC data delay (default: false)
 * @returns {Object} { startDate, endDate } as ISO strings (YYYY-MM-DD)
 */
export function parseDateRange(req, accountForGSCDelay = false) {
  const { startDate, endDate } = req.query;
  
  // Default to last 28 days if not provided (matches GSC UI standard)
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date();
  
  if (!startDate) {
    start.setDate(start.getDate() - 28);
  }
  
  // Google Search Console data is typically delayed by 2-3 days
  // If accountForGSCDelay is true, subtract 2 days from endDate to avoid requesting data that doesn't exist yet
  if (accountForGSCDelay && !endDate) {
    end.setDate(end.getDate() - 2);
  }
  
  // Format as YYYY-MM-DD
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  return {
    startDate: formatDate(start),
    endDate: formatDate(end)
  };
}

/**
 * Safely parse JSON with error handling
 * @param {string} text - JSON string to parse
 * @returns {Object|null} Parsed object or null on error
 */
export function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

/**
 * Aggregate search appearance data from GSC rows
 * @param {Array} rows - GSC API rows with searchAppearance dimension
 * @returns {Object} Aggregated appearance data
 */
export function aggregateSearchAppearance(rows) {
  const appearanceMap = {};
  
  if (!rows || !Array.isArray(rows)) {
    return appearanceMap;
  }
  
  rows.forEach(row => {
    const appearance = row.keys?.[0] || 'unknown';
    if (!appearanceMap[appearance]) {
      appearanceMap[appearance] = {
        appearance,
        clicks: 0,
        impressions: 0,
        ctr: 0,
        position: 0
      };
    }
    
    appearanceMap[appearance].clicks += row.clicks || 0;
    appearanceMap[appearance].impressions += row.impressions || 0;
    // Position and CTR are averages, so we'd need to recalculate properly
    // For now, just accumulate raw values
  });
  
  // Calculate CTR for each appearance
  Object.values(appearanceMap).forEach(item => {
    if (item.impressions > 0) {
      item.ctr = (item.clicks / item.impressions) * 100;
    }
  });
  
  return appearanceMap;
}

/**
 * Get OAuth2 access token using refresh token
 * Reuses existing GSC credentials from environment
 * @returns {Promise<string>} Access token
 */
export async function getGSCAccessToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('OAuth2 credentials not configured. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in Vercel environment variables.');
  }
  
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
    throw new Error(`Failed to get access token: ${errorText}`);
  }
  
  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

/**
 * Get OAuth2 access token for Business Profile API
 * Uses the same credentials as GSC (refresh token includes both scopes)
 * @returns {Promise<string>} Access token
 */
export async function getBusinessProfileAccessToken() {
  // Business Profile API uses the same OAuth credentials as GSC
  // The refresh token we got includes both webmasters and business.manage scopes
  return getGSCAccessToken();
}

/**
 * Normalize property URL for GSC API
 * @param {string} propertyUrl - Raw property URL
 * @returns {string} Normalized URL
 */
export function normalizePropertyUrl(propertyUrl) {
  let siteUrl = propertyUrl.trim();
  
  // Remove trailing slash
  siteUrl = siteUrl.replace(/\/$/, '');
  
  // If no protocol specified, try https:// first (most common)
  if (!siteUrl.match(/^https?:\/\//)) {
    siteUrl = `https://${siteUrl}`;
  }
  
  return siteUrl;
}

