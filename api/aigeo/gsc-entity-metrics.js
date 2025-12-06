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
    
    // 2. Get timeseries data (by date) - WITH CACHING
    let timeseries = [];
    let storedTimeseries = [];
    let missingDates = [];
    
    // Check Supabase for cached timeseries data
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (supabaseUrl && supabaseKey) {
      try {
        const cacheResponse = await fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/supabase/get-gsc-timeseries?propertyUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}`);
        if (cacheResponse.ok) {
          const cacheData = await cacheResponse.json();
          if (cacheData.status === 'ok' && cacheData.data && cacheData.data.length > 0) {
            storedTimeseries = cacheData.data;
            console.log(`[GSC Cache] Found ${storedTimeseries.length} cached timeseries records`);
            
            // Create a set of dates we have in cache
            const cachedDates = new Set(storedTimeseries.map(r => r.date));
            
            // Generate all dates in range and find missing ones
            const start = new Date(startDate);
            const end = new Date(endDate);
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
              const dateStr = d.toISOString().split('T')[0];
              if (!cachedDates.has(dateStr)) {
                missingDates.push(dateStr);
              }
            }
            
            console.log(`[GSC Cache] Missing ${missingDates.length} dates, will fetch from GSC API`);
          }
        }
      } catch (cacheError) {
        console.warn('[GSC Cache] Error checking cache, will fetch all from GSC API:', cacheError.message);
        // If cache check fails, fetch all dates
        missingDates = null; // null means fetch all
      }
    } else {
      // Supabase not configured, fetch all dates
      missingDates = null;
    }
    
    // Fetch missing dates from GSC API (or all dates if cache unavailable)
    if (missingDates === null || missingDates.length > 0) {
      const fetchStartDate = missingDates && missingDates.length > 0 
        ? missingDates[0] // Fetch from first missing date
        : startDate;
      const fetchEndDate = missingDates && missingDates.length > 0
        ? missingDates[missingDates.length - 1] // Fetch to last missing date
        : endDate;
      
      const timeseriesResponse = await fetch(searchConsoleUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate: fetchStartDate,
          endDate: fetchEndDate,
          dimensions: ['date'],
          rowLimit: 1000,
        }),
      });
      
      let newTimeseries = [];
      if (timeseriesResponse.ok) {
        const timeseriesData = await timeseriesResponse.json();
        if (timeseriesData.rows && Array.isArray(timeseriesData.rows)) {
          timeseriesData.rows.forEach(row => {
            newTimeseries.push({
              date: row.keys[0],
              clicks: row.clicks || 0,
              impressions: row.impressions || 0,
              ctr: row.ctr ? row.ctr * 100 : 0,
              position: row.position || 0
            });
          });
        }
      }
      
      // Save new timeseries data to Supabase (async, don't wait)
      if (newTimeseries.length > 0 && supabaseUrl && supabaseKey) {
        fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/api/supabase/save-gsc-timeseries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyUrl: siteUrl,
            timeseries: newTimeseries
          })
        }).catch(err => console.warn('[GSC Cache] Failed to save to cache:', err.message));
      }
      
      // Merge stored + new data
      const allDates = new Map();
      
      // Add stored data
      storedTimeseries.forEach(point => {
        allDates.set(point.date, point);
      });
      
      // Add/overwrite with new data
      newTimeseries.forEach(point => {
        allDates.set(point.date, point);
      });
      
      // Convert to sorted array
      timeseries = Array.from(allDates.values()).sort((a, b) => 
        new Date(a.date) - new Date(b.date)
      );
      
      console.log(`[GSC Cache] Merged ${storedTimeseries.length} stored + ${newTimeseries.length} new = ${timeseries.length} total records`);
    } else {
      // All dates are in cache, use stored data
      timeseries = storedTimeseries;
      console.log(`[GSC Cache] Using ${timeseries.length} cached records (no GSC API call needed)`);
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

