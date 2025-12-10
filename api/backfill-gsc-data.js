/**
 * Backfill Missing GSC Data
 * 
 * One-off API endpoint to fetch missing GSC data from Google Search Console
 * and populate the gsc_timeseries table for historical audit dates.
 * 
 * This endpoint:
 * 1. Finds all audit dates missing GSC data
 * 2. Fetches GSC data from Google Search Console API
 * 3. Saves to gsc_timeseries table
 * 
 * Usage: POST /api/backfill-gsc-data
 * 
 * Optional query params:
 * - startDate: Start date for backfill (default: 16 months ago)
 * - endDate: End date for backfill (default: today)
 * - limit: Max number of dates to process (default: 100)
 */

import { getGSCAccessToken, normalizePropertyUrl } from './aigeo/utils.js';
import { createClient } from '@supabase/supabase-js';

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
      message: 'Method not allowed. Use POST.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    const { propertyUrl = 'https://www.alanranger.com', startDate, endDate, limit = 100 } = req.body || {};
    
    // Get Supabase credentials
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({
        status: 'error',
        message: 'Supabase not configured',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    const normalizedUrl = normalizePropertyUrl(propertyUrl);
    
    // Calculate date range (GSC API limit: 16 months)
    const today = new Date();
    const sixteenMonthsAgo = new Date();
    sixteenMonthsAgo.setMonth(sixteenMonthsAgo.getMonth() - 16);
    
    const queryStartDate = startDate || sixteenMonthsAgo.toISOString().split('T')[0];
    const queryEndDate = endDate || today.toISOString().split('T')[0];
    
    console.log(`[BACKFILL-GSC] Finding missing dates from ${queryStartDate} to ${queryEndDate}`);
    
    // Find audit dates missing GSC data
    const { data: missingDates, error: fetchError } = await supabase
      .from('audit_results')
      .select('audit_date')
      .eq('property_url', normalizedUrl)
      .or('visibility_score.is.null,authority_score.is.null')
      .gte('audit_date', queryStartDate)
      .lte('audit_date', queryEndDate)
      .order('audit_date', { ascending: true })
      .limit(parseInt(limit));
    
    if (fetchError) {
      console.error('[BACKFILL-GSC] Error fetching dates:', fetchError);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to fetch missing dates',
        details: fetchError.message,
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    if (!missingDates || missingDates.length === 0) {
      return res.status(200).json({
        status: 'ok',
        message: 'No missing dates found',
        fetched: 0,
        saved: 0,
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    console.log(`[BACKFILL-GSC] Found ${missingDates.length} missing dates`);
    
    // Check which dates already have GSC data
    const datesToFetch = [];
    for (const record of missingDates) {
      const { data: existing } = await supabase
        .from('gsc_timeseries')
        .select('date')
        .eq('property_url', normalizedUrl)
        .eq('date', record.audit_date)
        .maybeSingle();
      
      if (!existing) {
        datesToFetch.push(record.audit_date);
      }
    }
    
    console.log(`[BACKFILL-GSC] ${datesToFetch.length} dates need GSC data`);
    
    if (datesToFetch.length === 0) {
      return res.status(200).json({
        status: 'ok',
        message: 'All dates already have GSC data',
        fetched: 0,
        saved: 0,
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    // Get Google access token
    const accessToken = await getGSCAccessToken();
    const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(normalizedUrl)}/searchAnalytics/query`;
    
    let fetched = 0;
    let saved = 0;
    let errors = 0;
    const errorDetails = [];
    
    // Process dates in batches to avoid rate limiting
    const batchSize = 10;
    for (let i = 0; i < datesToFetch.length; i += batchSize) {
      const batch = datesToFetch.slice(i, i + batchSize);
      
      for (const date of batch) {
        try {
          // Fetch GSC data for this date
          const response = await fetch(searchConsoleUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              startDate: date,
              endDate: date,
            }),
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`GSC API error: ${errorText}`);
          }
          
          const data = await response.json();
          
          if (data.rows && data.rows.length > 0) {
            const row = data.rows[0];
            const gscData = {
              property_url: normalizedUrl,
              date: date,
              clicks: row.clicks || 0,
              impressions: row.impressions || 0,
              position: row.position || 0,
              ctr: row.ctr || 0, // API returns as decimal (0-1)
            };
            
            // Save to Supabase
            const { error: saveError } = await supabase
              .from('gsc_timeseries')
              .upsert(gscData, {
                onConflict: 'property_url,date',
              });
            
            if (saveError) {
              throw new Error(`Supabase save error: ${saveError.message}`);
            }
            
            fetched++;
            saved++;
            console.log(`[BACKFILL-GSC] ✅ ${date}: position=${gscData.position.toFixed(2)}, ctr=${(gscData.ctr * 100).toFixed(2)}%`);
          } else {
            console.log(`[BACKFILL-GSC] ⚠️  ${date}: No data available`);
          }
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 200));
          
        } catch (error) {
          console.error(`[BACKFILL-GSC] ❌ Error processing ${date}:`, error.message);
          errors++;
          errorDetails.push({ date, error: error.message });
        }
      }
      
      // Longer delay between batches
      if (i + batchSize < datesToFetch.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return res.status(200).json({
      status: 'ok',
      message: `Backfill complete: ${saved} dates fetched and saved`,
      fetched,
      saved,
      errors,
      errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
      meta: {
        totalDates: datesToFetch.length,
        generatedAt: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('[BACKFILL-GSC] Fatal error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: error.message,
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

