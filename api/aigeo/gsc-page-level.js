/**
 * GSC Page-Level Data API
 * 
 * Fetches ALL pages from GSC (dimensions: ['page'], no filters)
 * Returns unfiltered page-level totals matching GSC "Pages" tab exactly
 * Used for Money Pages to get accurate page-level metrics (all positions, all queries)
 */

import { getGSCAccessToken, normalizePropertyUrl, parseDateRange, getGscDateRange } from './utils.js';

// Normalise GSC page rows to our compact shape (position null when not a valid rank).
function mapGscPageRows(pageData) {
  return (pageData?.rows || []).map((row) => {
    const posNum = Number.parseFloat(row.position);
    const position = (row.position != null && !Number.isNaN(posNum) && posNum > 0) ? posNum : null;
    return {
      keys: row.keys || [],
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr || 0,
      position
    };
  });
}

// Fetch one date window's page-level rows. Returns a result object (never throws) so a
// single bad window can't fail the whole batch.
async function fetchGscPageWindow(searchConsoleUrl, accessToken, startDate, endDate, dimensions, rowLimit) {
  try {
    const pageResponse = await fetch(searchConsoleUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate, endDate, dimensions, rowLimit })
    });
    if (!pageResponse.ok) {
      return { startDate, endDate, rows: [], totalRows: 0, ok: false };
    }
    const rows = mapGscPageRows(await pageResponse.json());
    return { startDate, endDate, rows, totalRows: rows.length, ok: true };
  } catch (e) {
    console.error(`[gsc-page-level] window ${startDate}..${endDate} failed:`, e?.message || e);
    return { startDate, endDate, rows: [], totalRows: 0, ok: false };
  }
}

// Batch path: one token exchange, every requested window fetched in parallel server-side.
// Collapses the dashboard's per-window POSTs (each doing its own token exchange) into one
// round trip. Results align 1:1 with `windows`.
async function handleGscPageBatch(req, res) {
  const { propertyUrl, windows, dimensions = ['page'], rowLimit = 25000 } = req.body;
  if (!propertyUrl || !Array.isArray(windows) || windows.length === 0) {
    return res.status(400).json({
      status: 'error', source: 'gsc-page-level',
      message: 'Missing required parameters: propertyUrl, windows[]',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
  const siteUrl = normalizePropertyUrl(propertyUrl);
  const accessToken = await getGSCAccessToken();
  const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const results = await Promise.all(windows.map((w) => {
    if (!w?.startDate || !w?.endDate) {
      return Promise.resolve({ startDate: w?.startDate || null, endDate: w?.endDate || null, rows: [], totalRows: 0, ok: false });
    }
    return fetchGscPageWindow(searchConsoleUrl, accessToken, w.startDate, w.endDate, dimensions, rowLimit);
  }));
  return res.status(200).json({
    status: 'ok', source: 'gsc-page-level', results,
    meta: { generatedAt: new Date().toISOString(), propertyUrl: siteUrl }
  });
}

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

  // Batch mode: { propertyUrl, windows: [{startDate, endDate}, ...] }
  if (Array.isArray(req.body?.windows)) {
    try {
      return await handleGscPageBatch(req, res);
    } catch (error) {
      console.error('[gsc-page-level] Batch error:', error);
      return res.status(500).json({
        status: 'error', source: 'gsc-page-level',
        message: error.message || 'Unknown error',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
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
    
    // Use provided dates or default to rolling 28-day window
    // Rolling 28d: endDate = yesterday, startDate = endDate - 27 days (inclusive = 28 days total)
    // This matches GSC UI "Last 28 days" behavior
    let { startDate, endDate } = startDateParam && endDateParam 
      ? { startDate: startDateParam, endDate: endDateParam }
      : (() => {
          const end = new Date();
          end.setDate(end.getDate() - 1); // Yesterday
          end.setHours(0, 0, 0, 0);
          const start = new Date(end);
          start.setDate(start.getDate() - 27); // 27 days back = 28 days total (inclusive)
          start.setHours(0, 0, 0, 0);
          return {
            startDate: start.toISOString().split('T')[0],
            endDate: end.toISOString().split('T')[0]
          };
        })();
    
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
    // Note: Position is the average position across all queries for this page
    // GSC API may return position as null/undefined for pages with no position data
    // Positions start at 1, so 0 is not a valid position - use null instead
    const rows = (pageData.rows || []).map(row => {
      const position = (row.position != null && row.position !== undefined && !isNaN(parseFloat(row.position)) && parseFloat(row.position) > 0)
        ? parseFloat(row.position)
        : null;
      return {
        keys: row.keys || [],
        clicks: row.clicks || 0,
        impressions: row.impressions || 0,
        ctr: row.ctr || 0, // GSC returns CTR as ratio (0-1)
        position: position
      };
    });
    
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

