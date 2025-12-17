/**
 * GSC Query→Pages Breakdown API
 * 
 * Fetches all pages that received impressions for a specific query
 * (dimensions: ['page'], filtered by query)
 * Used for scorecard "Advanced" section
 */

import { getGSCAccessToken, normalizePropertyUrl, parseDateRange, getGscDateRange } from './utils.js';

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
      source: 'gsc-query-pages',
      message: 'Method not allowed. Use GET.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    // Parse parameters
    const { property, query, startDate: startDateParam, endDate: endDateParam } = req.query;
    
    if (!property) {
      return res.status(400).json({
        status: 'error',
        source: 'gsc-query-pages',
        message: 'Missing required parameter: property',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    if (!query) {
      return res.status(400).json({
        status: 'error',
        source: 'gsc-query-pages',
        message: 'Missing required parameter: query',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    // Use standardized 28-day window (matching GSC UI)
    // If explicit dates provided, use them; otherwise use 28-day window ending yesterday
    let { startDate, endDate } = startDateParam && endDateParam 
      ? parseDateRange(req) 
      : getGscDateRange({ daysBack: 28, endOffsetDays: 1 });
    
    // Normalize property URL
    const siteUrl = normalizePropertyUrl(property);
    
    // Get access token
    const accessToken = await getGSCAccessToken();
    const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    
    // Fetch query→pages breakdown
    const queryPagesResponse = await fetch(searchConsoleUrl, {
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
            dimension: 'query',
            expression: query,
            operator: 'equals'
          }]
        }],
        rowLimit: 1000, // Should be enough to include all pages for a query
      }),
    });
    
    if (!queryPagesResponse.ok) {
      const errorData = await queryPagesResponse.json();
      return res.status(queryPagesResponse.status).json({
        status: 'error',
        source: 'gsc-query-pages',
        message: errorData.error?.message || 'Failed to fetch query→pages breakdown from GSC',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    const queryPagesData = await queryPagesResponse.json();
    
    // Extract pages from response
    const pages = [];
    if (queryPagesData.rows && Array.isArray(queryPagesData.rows)) {
      queryPagesData.rows.forEach(row => {
        pages.push({
          page: row.keys[0] || '',
          clicks: row.clicks || 0,
          impressions: row.impressions || 0,
          ctr: row.ctr ? row.ctr * 100 : 0, // Convert to percentage
          position: row.position || 0
        });
      });
    }
    
    return res.status(200).json({
      status: 'ok',
      source: 'gsc-query-pages',
      params: { property, query, startDate, endDate },
      data: {
        query,
        pages: pages || []
      },
      meta: {
        generatedAt: new Date().toISOString(),
        pageCount: pages.length
      }
    });
    
  } catch (error) {
    console.error('Error in gsc-query-pages:', error);
    return res.status(500).json({
      status: 'error',
      source: 'gsc-query-pages',
      message: error.message || 'Unknown error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

