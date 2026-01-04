/**
 * Check January 2026 data and understand how partial months are calculated
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkJanuary2026() {
  try {
    console.log('🔍 Checking January 2026 data...');
    console.log('');
    
    // Get all January 2026 rows
    const { data: janRows, error } = await supabase
      .from('portfolio_segment_metrics_28d')
      .select('*')
      .eq('segment', 'all_tracked')
      .gte('date_end', '2026-01-01')
      .lte('date_end', '2026-01-31')
      .order('date_end', { ascending: false });

    if (error) {
      throw error;
    }

    console.log(`📊 Found ${janRows.length} all_tracked rows for January 2026`);
    console.log('');

    if (janRows.length === 0) {
      console.log('❌ No January 2026 data found');
      return;
    }

    // Show all rows
    console.log('All January 2026 rows:');
    janRows.forEach(m => {
      const date = new Date(m.date_end);
      const monthDay = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      console.log(`  ${m.run_id} | ${m.date_end} (${monthDay}) | scope=${m.scope} | clicks=${m.clicks_28d} | impressions=${m.impressions_28d || 0}`);
    });
    console.log('');

    // Check what date_end values exist
    const dateEnds = [...new Set(janRows.map(r => r.date_end))].sort();
    console.log(`📅 Unique date_end values: ${dateEnds.join(', ')}`);
    
    // Find the latest date_end
    const latestDateEnd = dateEnds[dateEnds.length - 1];
    const latestDate = new Date(latestDateEnd);
    const dayOfMonth = latestDate.getDate();
    const daysInMonth = new Date(2026, 0, 0).getDate(); // January has 31 days
    
    console.log(`📅 Latest date_end: ${latestDateEnd} (day ${dayOfMonth} of ${daysInMonth})`);
    console.log(`📅 Days of data available: ${dayOfMonth} out of ${daysInMonth}`);
    console.log('');

    // Get the latest row for all_pages scope (what KPI tracker likely uses)
    const allPagesRows = janRows.filter(m => m.scope === 'all_pages');
    if (allPagesRows.length > 0) {
      const latest = allPagesRows[0]; // Already sorted by date_end desc
      console.log('📊 Latest row (scope=all_pages):');
      console.log(`   date_end: ${latest.date_end}`);
      console.log(`   clicks_28d: ${latest.clicks_28d}`);
      console.log(`   impressions_28d: ${latest.impressions_28d || 0}`);
      console.log('');
      
      // Calculate what the value would be if extrapolated to full month
      // Note: This is a 28-day rolling window, so we can't simply multiply by days
      // The asterisk likely means "partial month - only X days of data available"
      const clicks = latest.clicks_28d || 0;
      console.log('💡 Understanding the calculation:');
      console.log(`   - Raw clicks value: ${clicks}`);
      console.log(`   - This is a 28-day rolling window ending on ${latest.date_end}`);
      console.log(`   - The asterisk (*) indicates partial month (only ${dayOfMonth} days available)`);
      console.log(`   - The value shown (157) is the actual 28-day metric, not extrapolated`);
      console.log(`   - It represents clicks from the last 28 days ending on ${latest.date_end}`);
      console.log('');
      console.log('   Note: Since this is a 28-day rolling metric, it includes data from:');
      const startDate = new Date(latestDateEnd);
      startDate.setDate(startDate.getDate() - 27); // 28 days = 27 days back + today
      console.log(`   - Start: ${startDate.toISOString().split('T')[0]} (27 days before ${latestDateEnd})`);
      console.log(`   - End: ${latestDateEnd}`);
      console.log(`   - This window includes ${dayOfMonth} days from January 2026`);
      console.log(`   - And ${28 - dayOfMonth} days from December 2025`);
    }

    // Compare to December 2025 for context
    console.log('');
    console.log('📊 Comparing to December 2025:');
    const { data: decRows } = await supabase
      .from('portfolio_segment_metrics_28d')
      .select('date_end, scope, clicks_28d')
      .eq('segment', 'all_tracked')
      .eq('scope', 'all_pages')
      .eq('date_end', '2025-12-31');

    if (decRows && decRows.length > 0) {
      const decClicks = decRows[0].clicks_28d || 0;
      const janClicks = allPagesRows.length > 0 ? (allPagesRows[0].clicks_28d || 0) : 0;
      console.log(`   December 2025 (full month): ${decClicks} clicks`);
      console.log(`   January 2026 (partial, ${dayOfMonth} days): ${janClicks} clicks`);
      console.log(`   Change: ${janClicks > decClicks ? '+' : ''}${(janClicks - decClicks).toFixed(1)} clicks`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkJanuary2026();
