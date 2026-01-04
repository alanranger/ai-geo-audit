/**
 * Check portfolio_segment_metrics_28d to see what months have data
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkPortfolioMetrics() {
  try {
    // Get all portfolio segment metrics, grouped by month
    const { data: metrics, error } = await supabase
      .from('portfolio_segment_metrics_28d')
      .select('date_end, segment, scope, clicks_28d, run_id')
      .order('date_end', { ascending: false })
      .limit(500);

    if (error) {
      throw error;
    }

    // Group by month and segment
    const byMonth = {};
    metrics.forEach(m => {
      if (m.date_end) {
        const date = new Date(m.date_end);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!byMonth[monthKey]) {
          byMonth[monthKey] = {};
        }
        const segKey = `${m.segment}_${m.scope}`;
        if (!byMonth[monthKey][segKey]) {
          byMonth[monthKey][segKey] = {
            count: 0,
            totalClicks: 0,
            runs: new Set()
          };
        }
        byMonth[monthKey][segKey].count++;
        byMonth[monthKey][segKey].totalClicks += (m.clicks_28d || 0);
        byMonth[monthKey][segKey].runs.add(m.run_id);
      }
    });

    console.log('📊 Portfolio segment metrics by month:');
    console.log('');
    
    const months = Object.keys(byMonth).sort().reverse();
    months.forEach(month => {
      console.log(`${month}:`);
      const segments = Object.keys(byMonth[month]).sort();
      segments.forEach(seg => {
        const data = byMonth[month][seg];
        const [segment, scope] = seg.split('_');
        const avgClicks = data.count > 0 ? Math.round(data.totalClicks / data.count) : 0;
        console.log(`  ${segment} (${scope}): ${data.count} rows, avg clicks: ${avgClicks}, runs: ${data.runs.size}`);
      });
      console.log('');
    });

    // Check specifically for all_tracked in Dec 2025 and Jan 2026
    console.log('🔍 Checking "all_tracked" segment for Dec 2025 and Jan 2026:');
    ['2025-12', '2026-01'].forEach(month => {
      if (byMonth[month]) {
        const allTracked = byMonth[month]['all_tracked_all_pages'] || byMonth[month]['all_tracked_active_cycles_only'];
        if (allTracked) {
          const avgClicks = allTracked.count > 0 ? Math.round(allTracked.totalClicks / allTracked.count) : 0;
          console.log(`  ${month}: ${allTracked.count} row(s), avg clicks: ${avgClicks}`);
        } else {
          console.log(`  ${month}: No all_tracked data found`);
        }
      } else {
        console.log(`  ${month}: No data for this month`);
      }
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkPortfolioMetrics();
