/**
 * GSC Page-Only Totals API
 * 
 * Fetches true page-only totals from GSC (dimensions: ['page'], filtered to specific page URL)
 * Used for scorecard "Target page totals" tile
 */

import { getGSCAccessToken, normalizePropertyUrl, parseDateRange } from './utils.js';

/**
 * Normalize page URL path for client-side matching - strips query params, fragments, returns pathname
 * Used for comparing URLs in frontend (e.g., matching DataForSEO best_url to GSC pages)
 */
function normalizeGscPagePath(url) {
  if (!url || typeof url !== 'string') return '';
  
  let cleanUrl = url.trim();
  
  // Strip query parameters (srsltid, utm_*, gclid, fbclid, etc.) and fragments
  cleanUrl = cleanUrl.split('?')[0].split('#')[0];
  
  try {
    // Handle relative URLs by adding base URL
    let urlToParse = cleanUrl;
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      // Try to infer domain from common patterns, but this is a fallback
      // In practice, pageUrl should be absolute
      urlToParse = 'https://www.alanranger.com' + (cleanUrl.startsWith('/') ? cleanUrl : '/' + cleanUrl);
    }
    const urlObj = new URL(urlToParse);
    // Use pathname (automatically excludes query params and hash)
    let normalized = urlObj.pathname.toLowerCase().replace(/\/$/, '').trim();
    // If pathname is empty or just '/', treat as homepage
    if (!normalized || normalized === '/') {
      normalized = '/';
    }
    return normalized;
  } catch (e) {
    // If URL parsing fails, use manually cleaned URL
    return cleanUrl.toLowerCase().replace(/\/$/, '').trim() || '/';
  }
}

/**
 * Build canonical full URL for GSC API page filter
 * GSC API requires full canonical URL (https://www.alanranger.com/...), not just pathname
 * @param {string} url - Input URL (can be absolute or relative)
 * @param {string} propertyUrl - Property URL from request (e.g., https://www.alanranger.com)
 * @returns {string} Full canonical URL for GSC API filter
 */
function canonicalGscPageUrl(url, propertyUrl) {
  if (!url || typeof url !== 'string') return '';
  
  let cleanUrl = url.trim();
  
  // Strip query parameters (srsltid, utm_*, gclid, fbclid, etc.) and fragments
  cleanUrl = cleanUrl.split('?')[0].split('#')[0];
  
  try {
    // If already absolute URL, parse and return canonical form
    if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) {
      const urlObj = new URL(cleanUrl);
      // Return full URL with normalized pathname (no trailing slash, lowercase)
      const pathname = urlObj.pathname.toLowerCase().replace(/\/$/, '') || '/';
      return `${urlObj.protocol}//${urlObj.host}${pathname}`;
    }
    
    // If relative URL, use propertyUrl as base
    const baseUrl = normalizePropertyUrl(propertyUrl);
    const baseUrlObj = new URL(baseUrl);
    // Normalize pathname (no trailing slash, lowercase)
    const pathname = cleanUrl.startsWith('/') 
      ? cleanUrl.toLowerCase().replace(/\/$/, '') || '/'
      : '/' + cleanUrl.toLowerCase().replace(/\/$/, '');
    
    return `${baseUrlObj.protocol}//${baseUrlObj.host}${pathname}`;
  } catch (e) {
    // Fallback: try to construct from propertyUrl + cleanUrl
    try {
      const baseUrl = normalizePropertyUrl(propertyUrl);
      const pathname = cleanUrl.startsWith('/') ? cleanUrl : '/' + cleanUrl;
      return `${baseUrl}${pathname}`.toLowerCase().replace(/\/$/, '') || `${baseUrl}/`;
    } catch (e2) {
      console.error('[canonicalGscPageUrl] Error constructing URL:', e2);
      return '';
    }
  }
}

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
      source: 'gsc-page-totals',
      message: 'Method not allowed. Use GET.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    // Parse parameters
    const { property, pageUrl, startDate: startDateParam, endDate: endDateParam } = req.query;
    
    if (!property) {
      return res.status(400).json({
        status: 'error',
        source: 'gsc-page-totals',
        message: 'Missing required parameter: property',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    if (!pageUrl) {
      return res.status(400).json({
        status: 'error',
        source: 'gsc-page-totals',
        message: 'Missing required parameter: pageUrl',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    // Parse date range with defaults
    const { startDate, endDate } = parseDateRange(req);
    
    // Normalize property URL
    const siteUrl = normalizePropertyUrl(property);
    
    // Build canonical full URL for GSC API filter (GSC requires full URL, not pathname)
    const canonicalPageUrl = canonicalGscPageUrl(pageUrl, property);
    
    if (!canonicalPageUrl) {
      return res.status(400).json({
        status: 'error',
        source: 'gsc-page-totals',
        message: 'Invalid pageUrl: could not construct canonical URL',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    // Get access token
    const accessToken = await getGSCAccessToken();
    const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    
    // Fetch page-only totals using full canonical URL
    const pageResponse = await fetch(searchConsoleUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ['page'],
        dimensionFilterGroups: [{
          filters: [{
            dimension: 'page',
            expression: canonicalPageUrl, // Full canonical URL (e.g., https://www.alanranger.com/free-online-photography-course)
            operator: 'equals'
          }]
        }],
        rowLimit: 1, // Should only return one row for exact page match
      }),
    });
    
    if (!pageResponse.ok) {
      const errorData = await pageResponse.json();
      return res.status(pageResponse.status).json({
        status: 'error',
        source: 'gsc-page-totals',
        message: errorData.error?.message || 'Failed to fetch page totals from GSC',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    const pageData = await pageResponse.json();
    
    // Extract metrics from response
    // Note: GSC returns the page URL in row.keys[0], which may differ slightly from our canonical URL
    // Use normalizeGscPagePath for client-side matching, but return the actual GSC URL in response
    let result = {
      page: canonicalPageUrl, // Return canonical URL we used for filtering
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: 0
    };
    
    if (pageData.rows && Array.isArray(pageData.rows) && pageData.rows.length > 0) {
      const row = pageData.rows[0];
      result = {
        page: row.keys[0] || canonicalPageUrl, // GSC may return slightly different URL format
        clicks: row.clicks || 0,
        impressions: row.impressions || 0,
        ctr: row.ctr ? row.ctr * 100 : 0, // Convert to percentage
        position: row.position || 0
      };
    }
    
    return res.status(200).json({
      status: 'ok',
      source: 'gsc-page-totals',
      params: { property, pageUrl: canonicalPageUrl, startDate, endDate },
      data: result,
      meta: {
        generatedAt: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Error in gsc-page-totals:', error);
    return res.status(500).json({
      status: 'error',
      source: 'gsc-page-totals',
      message: error.message || 'Unknown error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

