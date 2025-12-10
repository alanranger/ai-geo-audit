/**
 * Alternative: Fetch missing GSC data via existing API endpoints
 * 
 * This script uses the existing /api/fetch-search-console endpoint
 * and /api/supabase/save-gsc-timeseries endpoint to fetch and save data.
 * 
 * This avoids needing local environment variables - uses deployed API.
 * 
 * Usage: node scripts/fetch-missing-gsc-data-via-api.js
 * 
 * Note: Requires the dashboard to be deployed and accessible.
 */

import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const API_BASE_URL = process.env.VERCEL_URL 
  ? `https://${process.env.VERCEL_URL}` 
  : 'http://localhost:3000'; // Fallback for local dev

const propertyUrl = 'https://www.alanranger.com';

// Get missing dates from Supabase (via API or direct query)
async function getMissingDates() {
  // For now, we'll need to query Supabase directly or use MCP
  // This is a placeholder - you'll need to run the SQL query to get dates
  console.log('📋 To get missing dates, run this SQL query:');
  console.log(`
    SELECT DISTINCT ar.audit_date
    FROM audit_results ar
    LEFT JOIN gsc_timeseries gsc ON gsc.property_url = ar.property_url AND gsc.date = ar.audit_date
    WHERE ar.property_url = 'https://www.alanranger.com'
      AND (ar.visibility_score IS NULL OR ar.authority_score IS NULL)
      AND ar.gsc_avg_position IS NULL
      AND ar.gsc_ctr IS NULL
      AND gsc.date IS NULL
    ORDER BY ar.audit_date ASC;
  `);
  
  // Return empty array - user needs to provide dates or we query via MCP
  return [];
}

// Fetch GSC data for a date range via API
async function fetchGscDataViaApi(startDate, endDate) {
  const response = await fetch(`${API_BASE_URL}/api/fetch-search-console`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      propertyUrl,
      startDate,
      endDate,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${error}`);
  }

  return await response.json();
}

// Save timeseries data via API
async function saveTimeseriesViaApi(timeseries) {
  const response = await fetch(`${API_BASE_URL}/api/supabase/save-gsc-timeseries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      propertyUrl,
      timeseries,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Save error: ${error}`);
  }

  return await response.json();
}

async function main() {
  console.log('📥 Fetch Missing GSC Data via API\n');
  console.log('⚠️  This script requires:');
  console.log('   1. Dashboard deployed and accessible');
  console.log('   2. Google OAuth credentials configured in Vercel');
  console.log('   3. Supabase credentials configured in Vercel\n');
  
  // Get missing dates (user needs to provide or we query)
  const missingDates = await getMissingDates();
  
  if (missingDates.length === 0) {
    console.log('❌ No missing dates found or dates not provided.');
    console.log('   Please run the SQL query above to get missing dates, then update this script.\n');
    return;
  }

  console.log(`📊 Found ${missingDates.length} missing dates\n`);

  // Group dates into batches (GSC API can handle date ranges)
  // Process in 30-day batches to avoid API limits
  const batchSize = 30;
  const batches = [];
  
  for (let i = 0; i < missingDates.length; i += batchSize) {
    const batch = missingDates.slice(i, i + batchSize);
    batches.push({
      startDate: batch[0],
      endDate: batch[batch.length - 1],
      dates: batch,
    });
  }

  console.log(`📦 Processing ${batches.length} batches...\n`);

  let totalSaved = 0;

  for (const batch of batches) {
    try {
      console.log(`📥 Fetching GSC data for ${batch.startDate} to ${batch.endDate}...`);
      
      // Fetch aggregate data for the date range
      const gscData = await fetchGscDataViaApi(batch.startDate, batch.endDate);
      
      // Note: The API returns aggregate data, not daily breakdown
      // We need to fetch daily data separately or use a different approach
      console.log(`   ⚠️  API returns aggregate data, not daily breakdown`);
      console.log(`   📊 Total: clicks=${gscData.totalClicks}, impressions=${gscData.totalImpressions}, position=${gscData.averagePosition?.toFixed(2)}, ctr=${gscData.ctr?.toFixed(2)}%`);
      
      // For daily data, we'd need to call the API for each date individually
      // This is inefficient, so better to use the direct script with env vars
      
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
    }
  }

  console.log('\n✅ Script complete!');
  console.log('\n💡 Recommendation: Use the direct script (fetch-missing-gsc-data.js) with environment variables');
  console.log('   for better performance and daily data granularity.');
}

main().catch(console.error);

