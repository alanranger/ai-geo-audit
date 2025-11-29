/**
 * GSC Entity Metrics API
 * 
 * Single canonical entry point for all Google Search Console-based entity metrics.
 * Returns comprehensive GSC data including timeseries, queries, pages, and SERP features.
 * 
 * This is a pure data endpoint - no scoring or pillar calculations.
 */

import { getGSCAccessToken, normalizePropertyUrl, parseDateRange } from './utils.js';

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
      source: 'gsc-entity-metrics',
      message: 'Method not allowed. Use GET.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    // Parse parameters
    const { property, startDate: startDateParam, endDate: endDateParam } = req.query;
    
    if (!property) {
      return res.status(400).json({
        status: 'error',
        source: 'gsc-entity-metrics',
        message: 'Missing required parameter: property',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    // Parse date range with defaults
    const { startDate, endDate } = parseDateRange(req);
    
    // Normalize property URL
    const siteUrl = normalizePropertyUrl(property);
    
    // Get access token
    const accessToken = await getGSCAccessToken();
    const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    
    // 1. Get overview (aggregate totals, no dimensions)
    const overviewResponse = await fetch(searchConsoleUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate,
        endDate,
        // No dimensions = aggregate totals
      }),
    });
    
    if (!overviewResponse.ok) {
      const errorText = await overviewResponse.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        errorData = { error: { message: errorText } };
      }
      
      if (overviewResponse.status === 403) {
        return res.status(403).json({
          status: 'error',
          source: 'gsc-entity-metrics',
          message: 'Permission denied',
          details: errorData.error?.message || 'User does not have access to this Search Console property',
          meta: { generatedAt: new Date().toISOString() }
        });
      }
      
      return res.status(overviewResponse.status).json({
        status: 'error',
        source: 'gsc-entity-metrics',
        message: 'Failed to fetch Search Console data',
        details: errorData,
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    const overviewData = await overviewResponse.json();
    const overviewRow = overviewData.rows?.[0] || {};
    const totalClicks = overviewRow.clicks || 0;
    const totalImpressions = overviewRow.impressions || 0;
    const avgPosition = overviewRow.position || 0;
    const ctr = overviewRow.ctr ? overviewRow.ctr * 100 : (totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0);
    
    // 2. Get timeseries data (by date)
    const timeseriesResponse = await fetch(searchConsoleUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ['date'],
        rowLimit: 1000,
      }),
    });
    
    const timeseries = [];
    if (timeseriesResponse.ok) {
      const timeseriesData = await timeseriesResponse.json();
      if (timeseriesData.rows && Array.isArray(timeseriesData.rows)) {
        timeseriesData.rows.forEach(row => {
          timeseries.push({
            date: row.keys[0],
            clicks: row.clicks || 0,
            impressions: row.impressions || 0,
            ctr: row.ctr ? row.ctr * 100 : 0,
            position: row.position || 0
          });
        });
      }
    }
    
    // 3. Get top queries
    const queriesResponse = await fetch(searchConsoleUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ['query'],
        rowLimit: 100,
      }),
    });
    
    const topQueries = [];
    if (queriesResponse.ok) {
      const queriesData = await queriesResponse.json();
      if (queriesData.rows && Array.isArray(queriesData.rows)) {
        queriesData.rows.forEach(row => {
          topQueries.push({
            query: row.keys[0],
            clicks: row.clicks || 0,
            impressions: row.impressions || 0,
            ctr: row.ctr ? row.ctr * 100 : 0,
            position: row.position || 0
          });
        });
      }
    }
    
    // 4. Get top pages
    const pagesResponse = await fetch(searchConsoleUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ['page'],
        rowLimit: 100,
      }),
    });
    
    const topPages = [];
    if (pagesResponse.ok) {
      const pagesData = await pagesResponse.json();
      if (pagesData.rows && Array.isArray(pagesData.rows)) {
        pagesData.rows.forEach(row => {
          topPages.push({
            url: row.keys[0],
            clicks: row.clicks || 0,
            impressions: row.impressions || 0,
            ctr: row.ctr ? row.ctr * 100 : 0,
            position: row.position || 0
          });
        });
      }
    }
    
    // 5. Get search appearance (SERP features)
    const appearanceResponse = await fetch(searchConsoleUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ['searchAppearance'],
        rowLimit: 100,
      }),
    });
    
    const searchAppearance = [];
    if (appearanceResponse.ok) {
      const appearanceData = await appearanceResponse.json();
      if (appearanceData.rows && Array.isArray(appearanceData.rows)) {
        appearanceData.rows.forEach(row => {
          searchAppearance.push({
            appearance: row.keys[0],
            clicks: row.clicks || 0,
            impressions: row.impressions || 0,
            ctr: row.ctr ? row.ctr * 100 : 0,
            position: row.position || 0
          });
        });
      }
    }
    
    return res.status(200).json({
      status: 'ok',
      source: 'gsc-entity-metrics',
      params: { property, startDate, endDate },
      data: {
        overview: {
          totalClicks,
          totalImpressions,
          avgPosition,
          ctr
        },
        timeseries,
        topQueries,
        topPages,
        searchAppearance
      },
      meta: {
        generatedAt: new Date().toISOString(),
        rowCounts: {
          timeseries: timeseries.length,
          topQueries: topQueries.length,
          topPages: topPages.length,
          searchAppearance: searchAppearance.length
        }
      }
    });
    
  } catch (error) {
    console.error('Error in gsc-entity-metrics:', error);
    return res.status(500).json({
      status: 'error',
      source: 'gsc-entity-metrics',
      message: error.message || 'Unknown error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

