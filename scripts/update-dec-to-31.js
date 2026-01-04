/**
 * Update December 2025 all_tracked rows to have date_end = 2025-12-31
 * This makes them visible to the KPI tracker which expects end-of-month dates
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const supabase = createClient(supabaseUrl, supabaseKey);

async function updateDecemberTo31() {
  try {
    console.log('🔍 Finding December 2025 all_tracked rows...');
    
    // Get all December rows
    const { data: decRows, error: fetchError } = await supabase
      .from('portfolio_segment_metrics_28d')
      .select('*')
      .eq('segment', 'all_tracked')
      .gte('date_end', '2025-12-01')
      .lte('date_end', '2025-12-30')
      .order('date_end', { ascending: false });

    if (fetchError) {
      throw fetchError;
    }

    if (!decRows || decRows.length === 0) {
      console.log('❌ No December rows found to update');
      return;
    }

    console.log(`✅ Found ${decRows.length} row(s) to update`);
    console.log('');

    // Check if December 31 rows already exist
    const { data: existingDec31 } = await supabase
      .from('portfolio_segment_metrics_28d')
      .select('*')
      .eq('segment', 'all_tracked')
      .eq('date_end', '2025-12-31');

    if (existingDec31 && existingDec31.length > 0) {
      console.log(`⚠️  December 31 rows already exist (${existingDec31.length} row(s))`);
      console.log('   Existing rows:');
      existingDec31.forEach(r => {
        console.log(`     - scope=${r.scope}, clicks=${r.clicks_28d}, run_id=${r.run_id}, date_end=${r.date_end}`);
      });
      console.log('');
      console.log('   These rows will be used by the KPI tracker.');
      console.log('   The earlier December rows (2025-12-21, 2025-12-22) will remain unchanged.');
      return;
    }

    // Group by scope and take the latest row for each scope
    const latestByScope = {};
    decRows.forEach(row => {
      const scope = row.scope || 'unknown';
      if (!latestByScope[scope] || new Date(row.date_end) > new Date(latestByScope[scope].date_end)) {
        latestByScope[scope] = row;
      }
    });

    console.log('📝 Will update the latest row for each scope to date_end = 2025-12-31:');
    Object.keys(latestByScope).forEach(scope => {
      const row = latestByScope[scope];
      console.log(`   - scope=${scope}, current date_end=${row.date_end}, clicks=${row.clicks_28d}, run_id=${row.run_id}`);
    });
    console.log('');

    // Update each row
    let updatedCount = 0;
    for (const scope of Object.keys(latestByScope)) {
      const row = latestByScope[scope];
      
      const { data: updated, error: updateError } = await supabase
        .from('portfolio_segment_metrics_28d')
        .update({ date_end: '2025-12-31' })
        .eq('id', row.id)
        .select();

      if (updateError) {
        console.error(`❌ Error updating row for scope=${scope}:`, updateError.message);
        continue;
      }

      if (updated && updated.length > 0) {
        updatedCount++;
        console.log(`✅ Updated scope=${scope}: date_end changed from ${row.date_end} to 2025-12-31`);
      }
    }

    console.log('');
    if (updatedCount > 0) {
      console.log(`✨ Successfully updated ${updatedCount} row(s)`);
      console.log('   The KPI tracker should now show December 2025 data!');
    } else {
      console.log('⚠️  No rows were updated');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

updateDecemberTo31();
