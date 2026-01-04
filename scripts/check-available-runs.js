/**
 * Check available runs in gsc_page_metrics_28d to see what months we have data for
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRuns() {
  try {
    // Get unique run_ids with their date_end, specifically looking for Dec 2025
    const { data: allRuns, error } = await supabase
      .from('gsc_page_metrics_28d')
      .select('run_id, date_end, site_url')
      .order('date_end', { ascending: false });
    
    // Also check for December 2025 specifically
    const dec2025Start = '2025-12-01';
    const dec2025End = '2025-12-31';
    const { data: decRuns } = await supabase
      .from('gsc_page_metrics_28d')
      .select('run_id, date_end, site_url')
      .gte('date_end', dec2025Start)
      .lte('date_end', dec2025End)
      .order('date_end', { ascending: false });
    
    const runs = allRuns || [];
    
    // Get unique runs only
    const uniqueRuns = [];
    const seen = new Set();
    runs.forEach(r => {
      const key = `${r.run_id}_${r.date_end}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueRuns.push(r);
      }
    });

    if (error) {
      throw error;
    }

    // Group by month
    const byMonth = {};
    uniqueRuns.forEach(r => {
      if (r.date_end) {
        const date = new Date(r.date_end);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!byMonth[monthKey]) {
          byMonth[monthKey] = [];
        }
        byMonth[monthKey].push({
          runId: r.run_id,
          dateEnd: r.date_end,
          siteUrl: r.site_url
        });
      }
    });

    console.log('📊 Available runs by month:');
    console.log('');
    
    const months = Object.keys(byMonth).sort().reverse();
    months.forEach(month => {
      const runsInMonth = byMonth[month];
      console.log(`${month}: ${runsInMonth.length} run(s)`);
      runsInMonth.slice(0, 5).forEach(r => {
        console.log(`  - ${r.runId} (${r.dateEnd})`);
      });
      if (runsInMonth.length > 5) {
        console.log(`  ... and ${runsInMonth.length - 5} more`);
      }
    });

    console.log('');
    console.log(`Total unique months: ${months.length}`);
    console.log(`Total unique runs: ${uniqueRuns.length}`);
    
    // Check specifically for December 2025, November 2025, and February 2026
    console.log('');
    console.log('🔍 Checking specific months mentioned in issue:');
    ['2025-12', '2025-11', '2026-02'].forEach(month => {
      if (byMonth[month]) {
        console.log(`  ✅ ${month}: ${byMonth[month].length} run(s)`);
      } else {
        console.log(`  ❌ ${month}: No runs found`);
      }
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkRuns();
