/**
 * Check all_tracked rows for December 2025 in detail
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDecember() {
  try {
    // Get all all_tracked rows for December 2025
    const { data: metrics, error } = await supabase
      .from('portfolio_segment_metrics_28d')
      .select('*')
      .eq('segment', 'all_tracked')
      .gte('date_end', '2025-12-01')
      .lte('date_end', '2025-12-31')
      .order('date_end', { ascending: false });

    if (error) {
      throw error;
    }

    console.log(`📊 Found ${metrics.length} all_tracked rows for December 2025`);
    console.log('');

    if (metrics.length === 0) {
      console.log('❌ No rows found for December 2025');
      console.log('   This explains why it shows zero/dash in the KPI tracker');
      return;
    }

    // Group by scope
    const byScope = {};
    metrics.forEach(m => {
      const scope = m.scope || 'unknown';
      if (!byScope[scope]) {
        byScope[scope] = [];
      }
      byScope[scope].push(m);
    });

    console.log('Rows by scope:');
    Object.keys(byScope).forEach(scope => {
      const rows = byScope[scope];
      const totalClicks = rows.reduce((sum, r) => sum + (r.clicks_28d || 0), 0);
      const zeroCount = rows.filter(r => (r.clicks_28d || 0) === 0).length;
      console.log(`  ${scope}: ${rows.length} rows, total clicks: ${totalClicks}, zero rows: ${zeroCount}`);
    });
    console.log('');

    // Show all rows
    console.log('All December 2025 rows:');
    metrics.forEach(m => {
      const date = new Date(m.date_end);
      const monthDay = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      console.log(`  ${m.run_id} | ${m.date_end} (${monthDay}) | scope=${m.scope} | clicks=${m.clicks_28d} | impressions=${m.impressions_28d || 0}`);
    });

    // Check what the KPI tracker might be using
    console.log('');
    console.log('🔍 KPI Tracker likely uses:');
    console.log('   - Monthly aggregation (one value per month)');
    console.log('   - Probably scope="all_pages" (not active_cycles_only)');
    console.log('   - May aggregate by taking the latest value or average');
    
    const allPagesRows = metrics.filter(m => m.scope === 'all_pages');
    if (allPagesRows.length > 0) {
      const latestAllPages = allPagesRows[0]; // Most recent
      const avgClicks = allPagesRows.reduce((sum, r) => sum + (r.clicks_28d || 0), 0) / allPagesRows.length;
      const totalClicks = allPagesRows.reduce((sum, r) => sum + (r.clicks_28d || 0), 0);
      
      console.log('');
      console.log('For scope="all_pages":');
      console.log(`  - Latest row clicks: ${latestAllPages.clicks_28d}`);
      console.log(`  - Average clicks: ${Math.round(avgClicks)}`);
      console.log(`  - Total clicks (sum): ${totalClicks}`);
      console.log(`  - Rows with zero: ${allPagesRows.filter(r => (r.clicks_28d || 0) === 0).length}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkDecember();
