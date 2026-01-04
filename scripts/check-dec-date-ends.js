/**
 * Check what date_end values exist for December 2025 all_tracked rows
 * and how they might be aggregated by month
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDecemberDateEnds() {
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
      return;
    }

    // Group by date_end and scope
    const byDateEnd = {};
    metrics.forEach(m => {
      const dateEnd = m.date_end;
      if (!byDateEnd[dateEnd]) {
        byDateEnd[dateEnd] = {};
      }
      const scope = m.scope || 'unknown';
      if (!byDateEnd[dateEnd][scope]) {
        byDateEnd[dateEnd][scope] = [];
      }
      byDateEnd[dateEnd][scope].push(m);
    });

    console.log('Rows by date_end and scope:');
    Object.keys(byDateEnd).sort().reverse().forEach(dateEnd => {
      console.log(`\n  ${dateEnd}:`);
      Object.keys(byDateEnd[dateEnd]).forEach(scope => {
        const rows = byDateEnd[dateEnd][scope];
        const totalClicks = rows.reduce((sum, r) => sum + (r.clicks_28d || 0), 0);
        console.log(`    ${scope}: ${rows.length} row(s), clicks: ${totalClicks}`);
        rows.forEach(r => {
          console.log(`      - run_id: ${r.run_id}, clicks: ${r.clicks_28d}, impressions: ${r.impressions_28d || 0}`);
        });
      });
    });

    // Check what the KPI tracker might be looking for
    console.log('');
    console.log('🔍 KPI Tracker likely aggregates by month:');
    console.log('   - Groups rows by YYYY-MM (year-month)');
    console.log('   - May take the latest date_end in each month');
    console.log('   - Or may take the average/sum of all rows in the month');
    
    // Check if there's a row with date_end = 2025-12-31 (end of month)
    const endOfMonth = metrics.find(m => m.date_end === '2025-12-31');
    if (endOfMonth) {
      console.log('');
      console.log('✅ Found row with date_end = 2025-12-31 (end of month):');
      console.log(`   scope: ${endOfMonth.scope}, clicks: ${endOfMonth.clicks_28d}`);
    } else {
      console.log('');
      console.log('❌ No row found with date_end = 2025-12-31');
      console.log('   The KPI tracker might be looking for end-of-month dates');
      console.log('   Available date_end values:');
      Object.keys(byDateEnd).sort().forEach(dateEnd => {
        console.log(`     - ${dateEnd}`);
      });
    }

    // Check what November 2025 looks like for comparison
    console.log('');
    console.log('📊 Checking November 2025 for comparison:');
    const { data: novMetrics } = await supabase
      .from('portfolio_segment_metrics_28d')
      .select('date_end, scope, clicks_28d')
      .eq('segment', 'all_tracked')
      .gte('date_end', '2025-11-01')
      .lte('date_end', '2025-11-30')
      .order('date_end', { ascending: false });

    if (novMetrics && novMetrics.length > 0) {
      const novByDateEnd = {};
      novMetrics.forEach(m => {
        if (!novByDateEnd[m.date_end]) {
          novByDateEnd[m.date_end] = [];
        }
        novByDateEnd[m.date_end].push(m);
      });
      
      console.log(`   Found ${novMetrics.length} rows for November 2025`);
      console.log('   date_end values:');
      Object.keys(novByDateEnd).sort().reverse().forEach(dateEnd => {
        const rows = novByDateEnd[dateEnd];
        const totalClicks = rows.reduce((sum, r) => sum + (r.clicks_28d || 0), 0);
        console.log(`     - ${dateEnd}: ${rows.length} row(s), total clicks: ${totalClicks}`);
      });
      
      // Check if November has end-of-month
      const novEndOfMonth = novMetrics.find(m => m.date_end === '2025-11-30');
      if (novEndOfMonth) {
        console.log(`   ✅ November has end-of-month row: clicks=${novEndOfMonth.clicks_28d}`);
      } else {
        console.log('   ❌ November does NOT have end-of-month row');
      }
    } else {
      console.log('   No November 2025 data found');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkDecemberDateEnds();
