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
    
    // Get Supabase credentials (needed early for cache checks)
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    // Get access token
    const accessToken = await getGSCAccessToken();
    const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    
    // 1. Get overview (aggregate totals, no dimensions)
    // First, check if we can calculate overview from cached timeseries data
    let totalClicks = 0;
    let totalImpressions = 0;
    let avgPosition = 0;
    let ctr = 0;
    let overviewFromCache = false;
    
    // Check if we have complete timeseries data in cache
    if (supabaseUrl && supabaseKey) {
      try {
        const baseUrl = req.headers.host 
          ? `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`
          : 'http://localhost:3000';
        const cacheResponse = await fetch(`${baseUrl}/api/supabase/get-gsc-timeseries?propertyUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}`);
        
        if (cacheResponse.ok) {
          const cacheData = await cacheResponse.json();
          if (cacheData.status === 'ok' && cacheData.data && cacheData.data.length > 0) {
            // Check if we have data for all dates in range
            const start = new Date(startDate);
            const end = new Date(endDate);
            const expectedDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
            const cachedDates = new Set(cacheData.data.map(r => r.date));
            
            // Count how many dates we have
            let actualDays = 0;
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
              const dateStr = d.toISOString().split('T')[0];
              if (cachedDates.has(dateStr)) {
                actualDays++;
              }
            }
            
            // If we have data for most dates (>= 90%), calculate overview from cache
            if (actualDays >= expectedDays * 0.9) {
              console.log(`[GSC Cache] Calculating overview from ${cacheData.data.length} cached timeseries records`);
              
              // Calculate aggregate metrics from timeseries
              let totalWeightedPosition = 0;
              cacheData.data.forEach(point => {
                totalClicks += point.clicks || 0;
                totalImpressions += point.impressions || 0;
                // Position is weighted by impressions
                totalWeightedPosition += (point.position || 0) * (point.impressions || 0);
              });
              
              // Calculate average position (weighted by impressions)
              avgPosition = totalImpressions > 0 ? totalWeightedPosition / totalImpressions : 0;
              
              // Calculate CTR
              ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
              
              overviewFromCache = true;
              console.log(`[GSC Cache] ✓ Overview calculated from cache: ${totalClicks} clicks, ${totalImpressions} impressions, position ${avgPosition.toFixed(2)}, CTR ${ctr.toFixed(2)}%`);
            }
          }
        }
      } catch (cacheError) {
        console.warn('[GSC Cache] Error checking cache for overview, will fetch from GSC API:', cacheError.message);
      }
    }
    
    // If we couldn't calculate from cache, fetch from GSC API
    if (!overviewFromCache) {
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
      totalClicks = overviewRow.clicks || 0;
      totalImpressions = overviewRow.impressions || 0;
      avgPosition = overviewRow.position || 0;
      ctr = overviewRow.ctr ? overviewRow.ctr * 100 : (totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0);
    }
    
    // 2. Get timeseries data (by date) - WITH CACHING
    let timeseries = [];
    let storedTimeseries = [];
    let missingDates = null; // null means fetch all dates
    
    // Check Supabase for cached timeseries data (supabaseUrl and supabaseKey already declared above)
    console.log(`[GSC Cache] Checking cache for property: ${siteUrl}, date range: ${startDate} to ${endDate}`);
    console.log(`[GSC Cache] Supabase configured: ${!!supabaseUrl && !!supabaseKey}`);
    
    if (supabaseUrl && supabaseKey) {
      try {
        // Use relative path for internal API calls (works in Vercel)
        const baseUrl = req.headers.host 
          ? `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`
          : 'http://localhost:3000';
        const cacheUrl = `${baseUrl}/api/supabase/get-gsc-timeseries?propertyUrl=${encodeURIComponent(siteUrl)}&startDate=${startDate}&endDate=${endDate}`;
        console.log(`[GSC Cache] Fetching from cache: ${cacheUrl}`);
        
        const cacheResponse = await fetch(cacheUrl);
        console.log(`[GSC Cache] Cache response status: ${cacheResponse.status}`);
        
        if (cacheResponse.ok) {
          const cacheData = await cacheResponse.json();
          console.log(`[GSC Cache] Cache response data status: ${cacheData.status}, data length: ${cacheData.data?.length || 0}`);
          
          if (cacheData.status === 'ok' && cacheData.data && cacheData.data.length > 0) {
            storedTimeseries = cacheData.data;
            console.log(`[GSC Cache] Found ${storedTimeseries.length} cached timeseries records`);
            
            // Create a set of dates we have in cache
            const cachedDates = new Set(storedTimeseries.map(r => r.date));
            
            // Generate all dates in range and find missing ones
            missingDates = [];
            const start = new Date(startDate);
            const end = new Date(endDate);
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
              const dateStr = d.toISOString().split('T')[0];
              if (!cachedDates.has(dateStr)) {
                missingDates.push(dateStr);
              }
            }
            
            console.log(`[GSC Cache] Missing ${missingDates.length} dates out of ${Math.ceil((end - start) / (1000 * 60 * 60 * 24))} total dates, will fetch from GSC API`);
          } else {
            console.log(`[GSC Cache] No cached data found, will fetch all dates from GSC API`);
            missingDates = null; // Fetch all dates
          }
        } else {
          const errorText = await cacheResponse.text();
          console.warn(`[GSC Cache] Cache fetch failed (${cacheResponse.status}): ${errorText.substring(0, 200)}`);
          missingDates = null; // Fetch all dates if cache check fails
        }
      } catch (cacheError) {
        console.warn('[GSC Cache] Error checking cache, will fetch all from GSC API:', cacheError.message);
        console.warn('[GSC Cache] Cache error stack:', cacheError.stack);
        // If cache check fails, fetch all dates
        missingDates = null; // null means fetch all
      }
    } else {
      // Supabase not configured, fetch all dates
      console.log(`[GSC Cache] Supabase not configured, will fetch all dates from GSC API`);
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
          console.log(`[GSC Cache] Fetched ${newTimeseries.length} timeseries records from GSC API for date range ${fetchStartDate} to ${fetchEndDate}`);
        } else {
          console.warn(`[GSC Cache] GSC API returned no rows for timeseries. Response:`, JSON.stringify(timeseriesData).substring(0, 200));
        }
      } else {
        const errorText = await timeseriesResponse.text();
        console.error(`[GSC Cache] GSC API timeseries request failed: ${timeseriesResponse.status} - ${errorText}`);
      }
      
      // Save new timeseries data to Supabase directly (don't wait, but log errors)
      if (newTimeseries.length > 0 && supabaseUrl && supabaseKey) {
        // Save directly to Supabase REST API (more reliable than calling another serverless function)
        const records = newTimeseries.map(point => ({
          property_url: siteUrl,
          date: point.date,
          clicks: point.clicks || 0,
          impressions: point.impressions || 0,
          ctr: parseFloat(point.ctr) || 0,
          position: parseFloat(point.position) || 0,
          updated_at: new Date().toISOString()
        }));
        
        fetch(`${supabaseUrl}/rest/v1/gsc_timeseries`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify(records)
        })
        .then(async (response) => {
          if (response.ok) {
            try {
              const contentType = response.headers.get('content-type');
              if (contentType && contentType.includes('application/json')) {
                const result = await response.json();
                const savedCount = Array.isArray(result) ? result.length : records.length;
                console.log(`[GSC Cache] ✓ Saved ${savedCount} timeseries records to Supabase`);
              } else {
                // Empty response is OK for upserts
                console.log(`[GSC Cache] ✓ Saved ${records.length} timeseries records to Supabase (upsert, no response body)`);
              }
            } catch (jsonError) {
              // Empty response is OK for upserts
              console.log(`[GSC Cache] ✓ Saved ${records.length} timeseries records to Supabase (upsert, empty response)`);
            }
          } else {
            let errorText = '';
            try {
              errorText = await response.text();
            } catch (e) {
              errorText = `Status ${response.status} - Could not read error message`;
            }
            console.error(`[GSC Cache] ✗ Failed to save: ${response.status} - ${errorText.substring(0, 200)}`);
          }
        })
        .catch(err => {
          console.error('[GSC Cache] ✗ Save error:', err.message);
        });
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
    
    // Final logging before response
    console.log(`[GSC Cache] Final timeseries count: ${timeseries.length}`);
    console.log(`[GSC Cache] Timeseries sample (first 3):`, timeseries.slice(0, 3).map(t => ({ date: t.date, clicks: t.clicks })));
    
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
        timeseries: timeseries || [], // Ensure it's always an array
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

