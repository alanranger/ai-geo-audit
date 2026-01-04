/**
 * Check for all_tracked rows with zero clicks in Dec 2025 and Jan 2026
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkZeros() {
  try {
    // Get all_tracked rows for Dec 2025 and Jan 2026
    const { data: metrics, error } = await supabase
      .from('portfolio_segment_metrics_28d')
      .select('*')
      .eq('segment', 'all_tracked')
      .gte('date_end', '2025-12-01')
      .lte('date_end', '2026-01-31')
      .order('date_end', { ascending: false });

    if (error) {
      throw error;
    }

    console.log(`📊 Found ${metrics.length} all_tracked rows for Dec 2025 - Jan 2026`);
    console.log('');

    const zeroRows = metrics.filter(m => (m.clicks_28d || 0) === 0);
    const nonZeroRows = metrics.filter(m => (m.clicks_28d || 0) > 0);

    console.log(`❌ Zero clicks: ${zeroRows.length} row(s)`);
    console.log(`✅ Non-zero clicks: ${nonZeroRows.length} row(s)`);
    console.log('');

    if (zeroRows.length > 0) {
      console.log('Rows with zero clicks:');
      zeroRows.forEach(r => {
        const date = new Date(r.date_end);
        const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        console.log(`  - ${r.run_id} (${r.date_end}, ${month}): scope=${r.scope}, clicks=${r.clicks_28d}`);
      });
      console.log('');
    }

    // Group by month
    const byMonth = {};
    metrics.forEach(m => {
      const date = new Date(m.date_end);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth[monthKey]) {
        byMonth[monthKey] = { zero: 0, nonZero: 0, total: 0 };
      }
      byMonth[monthKey].total++;
      if ((m.clicks_28d || 0) === 0) {
        byMonth[monthKey].zero++;
      } else {
        byMonth[monthKey].nonZero++;
      }
    });

    console.log('Summary by month:');
    Object.keys(byMonth).sort().reverse().forEach(month => {
      const data = byMonth[month];
      console.log(`  ${month}: ${data.total} total, ${data.zero} zero, ${data.nonZero} non-zero`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkZeros();
