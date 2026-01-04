/**
 * Delete all_tracked rows with zero clicks in Dec 2025 and Jan 2026
 * These were created with the old logic that only looked at currently active tasks
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const supabase = createClient(supabaseUrl, supabaseKey);

async function deleteZeroRows() {
  try {
    console.log('🗑️  Deleting all_tracked rows with zero clicks from Dec 2025 - Jan 2026...');
    console.log('');

    // Delete rows with zero clicks
    const { data: deleted, error } = await supabase
      .from('portfolio_segment_metrics_28d')
      .delete()
      .eq('segment', 'all_tracked')
      .eq('clicks_28d', 0)
      .gte('date_end', '2025-12-01')
      .lte('date_end', '2026-01-31')
      .select();

    if (error) {
      throw error;
    }

    console.log(`✅ Deleted ${deleted?.length || 0} rows with zero clicks`);
    console.log('');
    console.log('Deleted rows:');
    deleted?.forEach(r => {
      const date = new Date(r.date_end);
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      console.log(`  - ${r.run_id} (${r.date_end}, ${month}): scope=${r.scope}`);
    });

    console.log('');
    console.log('✨ Zero rows removed. The KPI tracker will no longer show zeros for these dates.');
    console.log('   Note: These rows cannot be reprocessed because the source runs are not in gsc_page_metrics_28d.');
    console.log('   They will be recreated automatically when new runs are processed with the fixed logic.');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

deleteZeroRows();
