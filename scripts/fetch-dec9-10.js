/**
 * Fetch GSC data for Dec 9 and Dec 10 specifically
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const propertyUrl = 'https://www.alanranger.com';

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
  console.log('📥 Fetching GSC data for Dec 9 and Dec 10...\n');
  
  const dates = ['2025-12-09', '2025-12-10'];
  
  for (const date of dates) {
    try {
      console.log(`📥 Fetching ${date}...`);
      
      // Fetch for single date
      const gscData = await fetchGscDataViaApi(date, date);
      
      // Check if data is valid (not all zeros)
      if (gscData.totalClicks === 0 && gscData.totalImpressions === 0) {
        console.log(`   ⚠️  Warning: ${date} has zero clicks/impressions - may be invalid`);
      }
      
      // Save to Supabase
      await saveGscData(date, gscData);
      
      console.log(`   ✅ Saved: clicks=${gscData.totalClicks}, impressions=${gscData.totalImpressions}, position=${gscData.averagePosition?.toFixed(2)}, ctr=${gscData.ctr?.toFixed(2)}%`);
      
      // Delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
    }
  }
  
  console.log('\n✅ Done! Now re-run the backfill migration to calculate scores.');
}

main().catch(console.error);

