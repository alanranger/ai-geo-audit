/**
 * Direct GSC Data Fetch Script
 * 
 * Uses existing API utilities to fetch GSC data directly
 * and save to Supabase using provided credentials.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const propertyUrl = 'https://www.alanranger.com';

// Get Google access token (reuse from existing API)
async function getGSCAccessToken() {
  // Import the utility function from the API
  // For now, we'll need to call the API endpoint that has access to env vars
  const response = await fetch('https://ai-geo-audit.vercel.app/api/aigeo/gsc-entity-metrics?property=https://www.alanranger.com&startDate=2024-08-01&endDate=2024-08-02');
  
  if (!response.ok) {
    throw new Error(`Failed to get access token via API: ${response.statusText}`);
  }
  
  // The API will handle the token internally
  return null; // We'll use the API endpoint directly
}

// Fetch GSC data via existing API endpoint
async function fetchGscDataViaApi(startDate, endDate) {
  const response = await fetch(`https://ai-geo-audit.vercel.app/api/fetch-search-console`, {
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

// Save to Supabase
async function saveGscData(date, gscData) {
  const { error } = await supabase
    .from('gsc_timeseries')
    .upsert({
      property_url: propertyUrl,
      date: date,
      clicks: gscData.totalClicks || 0,
      impressions: gscData.totalImpressions || 0,
      position: gscData.averagePosition || 0,
      ctr: (gscData.ctr || 0) / 100, // Convert percentage to decimal
    }, {
      onConflict: 'property_url,date',
    });

  if (error) {
    throw new Error(`Supabase error: ${error.message}`);
  }
}

async function main() {
  console.log('🔍 Finding missing dates...\n');
  
  // Get missing dates
  const { data: missingDates, error } = await supabase
    .from('audit_results')
    .select('audit_date')
    .eq('property_url', propertyUrl)
    .or('visibility_score.is.null,authority_score.is.null')
    .gte('audit_date', '2024-08-01') // GSC API limit: 16 months
    .order('audit_date', { ascending: true })
    .limit(500); // Fetch all available dates
  
  if (error) {
    console.error('❌ Error:', error);
    return;
  }
  
  if (!missingDates || missingDates.length === 0) {
    console.log('✅ No missing dates found');
    return;
  }
  
  console.log(`📊 Found ${missingDates.length} missing dates\n`);
  
  // Check which ones don't have GSC data
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
  
  console.log(`📅 ${datesToFetch.length} dates need GSC data\n`);
  
  if (datesToFetch.length === 0) {
    console.log('✅ All dates already have GSC data');
    return;
  }
  
  console.log('📥 Fetching GSC data via API...\n');
  
  let saved = 0;
  let errors = 0;
  
  // Process in small batches with progress reporting
  const total = datesToFetch.length;
  console.log(`\n📥 Fetching GSC data for ${total} dates...\n`);
  
  for (let i = 0; i < datesToFetch.length; i++) {
    const date = datesToFetch[i];
    const progress = `[${i + 1}/${total}]`;
    
    try {
      // Fetch for single date
      const gscData = await fetchGscDataViaApi(date, date);
      
      // Save to Supabase
      await saveGscData(date, gscData);
      
      console.log(`${progress} ✅ ${date}: position=${gscData.averagePosition?.toFixed(2)}, ctr=${gscData.ctr?.toFixed(2)}%`);
      saved++;
      
      // Delay to avoid rate limiting (reduced since we're using API endpoint)
      await new Promise(resolve => setTimeout(resolve, 300));
      
    } catch (error) {
      console.error(`${progress} ❌ ${date}: ${error.message}`);
      errors++;
      
      // Longer delay on error
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Progress update every 10 dates
    if ((i + 1) % 10 === 0) {
      console.log(`   Progress: ${i + 1}/${total} (${saved} saved, ${errors} errors)\n`);
    }
  }
  
  console.log(`\n📊 Final Summary:`);
  console.log(`   ✅ Saved: ${saved} dates`);
  console.log(`   ❌ Errors: ${errors} dates`);
  console.log(`   📅 Total processed: ${total} dates`);
  
  if (saved > 0) {
    console.log(`\n✅ GSC data fetched! Next step: Re-run the backfill migration to calculate scores.`);
  }
}

main().catch(console.error);

