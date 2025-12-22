// Test script for backfill-historical-gsc.js
// Run with: node scripts/test-backfill-historical.js

import { createClient } from '@supabase/supabase-js';
import { getGSCAccessToken, normalizePropertyUrl } from '../api/aigeo/utils.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

// Helper functions from the backfill script
function getLastDayOfMonth(year, month) {
  return new Date(year, month + 1, 0);
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function getRolling28dWindow(endDate) {
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 27);
  start.setHours(0, 0, 0, 0);
  return {
    startDate: formatDate(start),
    endDate: formatDate(end)
  };
}

async function fetchGscPageData(siteUrl, startDate, endDate) {
  const accessToken = await getGSCAccessToken();
  const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  
  const requestBody = {
    startDate,
    endDate,
    dimensions: ['page'],
    rowLimit: 25000,
  };
  
  console.log(`[Test] Fetching GSC data for ${startDate} to ${endDate}...`);
  
  const response = await fetch(searchConsoleUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`GSC API error: ${errorData.error?.message || 'Unknown error'}`);
  }
  
  const data = await response.json();
  return data.rows || [];
}

async function testBackfill() {
  try {
    const propertyUrl = 'https://www.alanranger.com';
    const months = 1; // Test with just 1 month
    
    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );
    
    const siteUrl = normalizePropertyUrl(propertyUrl);
    console.log(`[Test] Testing backfill for ${siteUrl}, ${months} month(s)...`);
    
    // Generate list of months to process
    const monthsToProcess = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < months; i++) {
      const monthDate = new Date(today);
      monthDate.setMonth(monthDate.getMonth() - i);
      
      const lastDay = getLastDayOfMonth(monthDate.getFullYear(), monthDate.getMonth());
      
      if (lastDay <= today) {
        monthsToProcess.push({
          year: lastDay.getFullYear(),
          month: lastDay.getMonth(),
          lastDay: lastDay
        });
      }
    }
    
    console.log(`[Test] Processing ${monthsToProcess.length} month(s)...`);
    
    for (const monthInfo of monthsToProcess) {
      const { year, month, lastDay } = monthInfo;
      const { startDate, endDate } = getRolling28dWindow(lastDay);
      const runId = `${year}-${String(month + 1).padStart(2, '0')}`;
      
      console.log(`[Test] Month: ${runId}, Date range: ${startDate} to ${endDate}`);
      
      // Check if already exists
      const { data: existing } = await supabase
        .from('gsc_page_metrics_28d')
        .select('id')
        .eq('run_id', runId)
        .eq('site_url', siteUrl)
        .limit(1);
      
      if (existing && existing.length > 0) {
        console.log(`[Test] ✓ Run ${runId} already exists, skipping...`);
        continue;
      }
      
      // Fetch GSC data
      const gscRows = await fetchGscPageData(siteUrl, startDate, endDate);
      console.log(`[Test] ✓ Fetched ${gscRows.length} pages from GSC`);
      
      if (gscRows.length === 0) {
        console.log(`[Test] ⚠ No data for ${runId}, skipping...`);
        continue;
      }
      
      // Show sample data
      console.log(`[Test] Sample page data:`, {
        url: gscRows[0]?.keys[0],
        clicks: gscRows[0]?.clicks,
        impressions: gscRows[0]?.impressions,
        ctr: gscRows[0]?.ctr,
        position: gscRows[0]?.position
      });
      
      console.log(`[Test] ✓ Test completed successfully!`);
      console.log(`[Test] Would save ${gscRows.length} pages to gsc_page_metrics_28d with run_id: ${runId}`);
    }
    
  } catch (error) {
    console.error('[Test] Error:', error);
    process.exit(1);
  }
}

testBackfill();

