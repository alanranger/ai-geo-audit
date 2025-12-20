/**
 * GSC Page-Level Data API
 * 
 * Fetches ALL pages from GSC (dimensions: ['page'], no filters)
 * Returns unfiltered page-level totals matching GSC "Pages" tab exactly
 * Used for Money Pages to get accurate page-level metrics (all positions, all queries)
 */

import { getGSCAccessToken, normalizePropertyUrl, parseDateRange, getGscDateRange } from './utils.js';

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
      source: 'gsc-page-level',
      message: 'Method not allowed. Use POST.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    // Parse request body
    const { propertyUrl, startDate: startDateParam, endDate: endDateParam, dimensions = ['page'], rowLimit = 25000 } = req.body;
    
    if (!propertyUrl) {
      return res.status(400).json({
        status: 'error',
        source: 'gsc-page-level',
        message: 'Missing required parameter: propertyUrl',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    // Use provided dates or default to 28-day window
    // CRITICAL: Use endOffsetDays=2 to account for GSC being 2-3 days behind
    let { startDate, endDate } = startDateParam && endDateParam 
      ? { startDate: startDateParam, endDate: endDateParam }
      : getGscDateRange({ daysBack: 28, endOffsetDays: 2 });
    
    // Normalize property URL
    const siteUrl = normalizePropertyUrl(propertyUrl);
    
    // Get access token
    const accessToken = await getGSCAccessToken();
    const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    
    // Fetch ALL pages without filter (unfiltered, all positions, all queries)
    const requestBody = {
      startDate,
      endDate,
      dimensions: dimensions, // ['page'] for page-level data
      rowLimit: rowLimit, // Fetch up to rowLimit pages
    };
    
    console.log(`[gsc-page-level] Request to GSC API:`, {
      url: searchConsoleUrl,
      body: requestBody,
      propertyUrl: siteUrl
    });
    
    const pageResponse = await fetch(searchConsoleUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    if (!pageResponse.ok) {
      const errorData = await pageResponse.json();
      console.error('[gsc-page-level] GSC API error:', errorData);
      return res.status(pageResponse.status).json({
        status: 'error',
        source: 'gsc-page-level',
        message: errorData.error?.message || 'Failed to fetch page-level data from GSC',
        details: errorData,
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    const pageData = await pageResponse.json();
    
    // Transform rows to match expected format
    const rows = (pageData.rows || []).map(row => ({
      keys: row.keys || [],
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr || 0, // GSC returns CTR as ratio (0-1)
      position: row.position || 0
    }));
    
    console.log(`[gsc-page-level] Fetched ${rows.length} pages from GSC for ${siteUrl} (${startDate} to ${endDate})`);
    
    // Debug: Log specific page if it matches landscape-photography-workshops
    const landscapePage = rows.find(row => 
      row.keys?.[0]?.includes('landscape-photography-workshops')
    );
    if (landscapePage) {
      console.log(`[gsc-page-level] 🔍 Landscape page found in GSC response:`, {
        url: landscapePage.keys[0],
        clicks: landscapePage.clicks,
        impressions: landscapePage.impressions,
        ctr: landscapePage.ctr,
        position: landscapePage.position
      });
    } else {
      console.log(`[gsc-page-level] ⚠ Landscape page NOT found in GSC response. Total pages: ${rows.length}`);
      // Log first 10 URLs for debugging
      const sampleUrls = rows.slice(0, 10).map(r => r.keys?.[0] || 'N/A');
      console.log(`[gsc-page-level] Sample URLs from GSC:`, sampleUrls);
    }
    
    return res.status(200).json({
      status: 'ok',
      source: 'gsc-page-level',
      data: {
        rows: rows,
        startDate,
        endDate,
        totalRows: rows.length
      },
      meta: {
        generatedAt: new Date().toISOString(),
        propertyUrl: siteUrl
      }
    });
    
  } catch (error) {
    console.error('[gsc-page-level] Error:', error);
    return res.status(500).json({
      status: 'error',
      source: 'gsc-page-level',
      message: error.message || 'Unknown error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

