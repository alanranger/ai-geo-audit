/**
 * One-off script to fetch missing GSC data from Google Search Console API
 * 
 * This script:
 * 1. Finds all audit dates that are missing GSC data (no gsc_timeseries entry)
 * 2. Fetches GSC data from Google Search Console API for those dates
 * 3. Saves the data to gsc_timeseries table
 * 4. Then you can re-run the backfill migration to calculate scores
 * 
 * Usage: 
 *   node scripts/fetch-missing-gsc-data.js
 * 
 * Requires environment variables:
 * - GOOGLE_CLIENT_ID
 * - GOOGLE_CLIENT_SECRET
 * - GOOGLE_REFRESH_TOKEN
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 * 
 * Note: Google Search Console API only provides data for the last 16 months.
 * For older dates, you'll need to import historical data manually.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleRefreshToken = process.env.GOOGLE_REFRESH_TOKEN;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!googleClientId || !googleClientSecret || !googleRefreshToken) {
  console.error('❌ Missing Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN)');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const propertyUrl = 'https://www.alanranger.com';

// Get access token from Google
async function getGoogleAccessToken() {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: googleClientId,
      client_secret: googleClientSecret,
      refresh_token: googleRefreshToken,
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

// Fetch GSC data for a single date
async function fetchGscDataForDate(accessToken, date) {
  const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(propertyUrl)}/searchAnalytics/query`;
  
  const response = await fetch(searchConsoleUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      startDate: date,
      endDate: date,
      // No dimensions = get aggregate totals for entire site
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GSC API error: ${errorText}`);
  }

  const data = await response.json();
  
  if (data.rows && data.rows.length > 0) {
    const row = data.rows[0];
    return {
      date,
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      position: row.position || 0,
      ctr: row.ctr || 0, // API returns CTR as decimal (0-1)
    };
  }
  
  return null; // No data for this date
}

// Save GSC data to Supabase
async function saveGscDataToSupabase(gscData) {
  const { error } = await supabase
    .from('gsc_timeseries')
    .upsert({
      property_url: propertyUrl,
      date: gscData.date,
      clicks: gscData.clicks,
      impressions: gscData.impressions,
      position: gscData.position,
      ctr: gscData.ctr,
    }, {
      onConflict: 'property_url,date',
    });

  if (error) {
    throw new Error(`Failed to save to Supabase: ${error.message}`);
  }
}

async function fetchMissingGscData() {
  console.log('🔍 Finding audit dates missing GSC data...\n');
  
  // Find all audit dates that are missing GSC data
  const { data: missingDates, error: fetchError } = await supabase
    .from('audit_results')
    .select('audit_date')
    .eq('property_url', propertyUrl)
    .or('visibility_score.is.null,authority_score.is.null')
    .order('audit_date', { ascending: true });

  if (fetchError) {
    console.error('❌ Error fetching audit dates:', fetchError);
    return;
  }

  if (!missingDates || missingDates.length === 0) {
    console.log('✅ No missing dates found. All records have scores.');
    return;
  }

  console.log(`📊 Found ${missingDates.length} audit dates missing scores\n`);

  // Check which dates already have GSC data
  const datesToFetch = [];
  for (const record of missingDates) {
    const { data: existing } = await supabase
      .from('gsc_timeseries')
      .select('date')
      .eq('property_url', propertyUrl)
      .eq('date', record.audit_date)
      .maybeSingle();

    if (!existing) {
      datesToFetch.push(record.audit_date);
    }
  }

  console.log(`📅 ${datesToFetch.length} dates need GSC data fetched\n`);

  if (datesToFetch.length === 0) {
    console.log('✅ All dates already have GSC data. You can re-run the backfill migration now.');
    return;
  }

  // Get access token
  console.log('🔐 Getting Google access token...');
  const accessToken = await getGoogleAccessToken();
  console.log('✅ Access token obtained\n');

  // Calculate date range limits (GSC API only provides last 16 months)
  const today = new Date();
  const sixteenMonthsAgo = new Date();
  sixteenMonthsAgo.setMonth(sixteenMonthsAgo.getMonth() - 16);
  const minDate = sixteenMonthsAgo.toISOString().split('T')[0];

  // Filter dates to only those within API range
  const fetchableDates = datesToFetch.filter(date => date >= minDate);
  const tooOldDates = datesToFetch.filter(date => date < minDate);

  if (tooOldDates.length > 0) {
    console.log(`⚠️  ${tooOldDates.length} dates are older than 16 months (GSC API limit):`);
    console.log(`   Earliest: ${tooOldDates[0]}, Latest: ${tooOldDates[tooOldDates.length - 1]}`);
    console.log(`   These dates need manual import or historical data file.\n`);
  }

  if (fetchableDates.length === 0) {
    console.log('❌ No dates are within GSC API range (last 16 months)');
    console.log('   You need to import historical GSC data manually for older dates.\n');
    return;
  }

  console.log(`📥 Fetching GSC data for ${fetchableDates.length} dates (within API range)...\n`);

  let fetched = 0;
  let saved = 0;
  let errors = 0;
  let skipped = 0;

  // Process dates in batches to avoid rate limiting
  const batchSize = 10;
  for (let i = 0; i < fetchableDates.length; i += batchSize) {
    const batch = fetchableDates.slice(i, i + batchSize);
    console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1} (${batch.length} dates)...`);

    for (const date of batch) {
      try {
        // Check if data already exists (double-check)
        const { data: existing } = await supabase
          .from('gsc_timeseries')
          .select('date')
          .eq('property_url', propertyUrl)
          .eq('date', date)
          .maybeSingle();

        if (existing) {
          console.log(`   ⏭️  Skipping ${date} (already exists)`);
          skipped++;
          continue;
        }

        // Fetch from GSC API
        const gscData = await fetchGscDataForDate(accessToken, date);
        
        if (gscData) {
          // Save to Supabase
          await saveGscDataToSupabase(gscData);
          console.log(`   ✅ ${date}: position=${gscData.position.toFixed(2)}, ctr=${(gscData.ctr * 100).toFixed(2)}%, clicks=${gscData.clicks}, impressions=${gscData.impressions}`);
          fetched++;
          saved++;
        } else {
          console.log(`   ⚠️  ${date}: No data available in GSC`);
          skipped++;
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        console.error(`   ❌ Error processing ${date}:`, error.message);
        errors++;
      }
    }

    // Longer delay between batches
    if (i + batchSize < fetchableDates.length) {
      console.log(`   ⏸️  Waiting 2 seconds before next batch...\n`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('\n📊 Summary:');
  console.log(`   ✅ Fetched & saved: ${saved} dates`);
  console.log(`   ⏭️  Skipped: ${skipped} dates (already exists or no data)`);
  console.log(`   ❌ Errors: ${errors} dates`);
  console.log(`   📅 Total processed: ${fetchableDates.length} dates`);

  if (tooOldDates.length > 0) {
    console.log(`\n⚠️  ${tooOldDates.length} dates are too old for GSC API (need manual import)`);
  }

  if (saved > 0) {
    console.log('\n✅ GSC data fetched! You can now re-run the backfill migration to calculate scores.');
    console.log('   Run: Apply migration "backfill_authority_visibility_scores" again');
  }
}

// Run the script
fetchMissingGscData()
  .then(() => {
    console.log('\n✅ Script complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });

