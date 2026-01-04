/**
 * Add a December 31, 2025 row for all_tracked segment
 * Uses the latest available December data (2025-12-22)
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const supabase = createClient(supabaseUrl, supabaseKey);

async function addDecember31Row() {
  try {
    console.log('🔍 Finding latest December 2025 data...');
    
    // Get the latest December row (2025-12-22)
    const { data: latestDec, error: fetchError } = await supabase
      .from('portfolio_segment_metrics_28d')
      .select('*')
      .eq('segment', 'all_tracked')
      .eq('date_end', '2025-12-22')
      .order('created_at', { ascending: false })
      .limit(2);

    if (fetchError) {
      throw fetchError;
    }

    if (!latestDec || latestDec.length === 0) {
      console.log('❌ No data found for 2025-12-22');
      return;
    }

    console.log(`✅ Found ${latestDec.length} row(s) for 2025-12-22`);
    console.log('');

    // Check if December 31 row already exists
    const { data: existingDec31 } = await supabase
      .from('portfolio_segment_metrics_28d')
      .select('*')
      .eq('segment', 'all_tracked')
      .eq('date_end', '2025-12-31');

    if (existingDec31 && existingDec31.length > 0) {
      console.log(`⚠️  December 31 row already exists (${existingDec31.length} row(s))`);
      console.log('   Existing rows:');
      existingDec31.forEach(r => {
        console.log(`     - scope=${r.scope}, clicks=${r.clicks_28d}, run_id=${r.run_id}`);
      });
      console.log('');
      console.log('   Do you want to update them? (This script will create new rows)');
      return;
    }

    // Create December 31 rows for each scope
    const rowsToInsert = [];
    
    latestDec.forEach(row => {
      // Create a new row with date_end = 2025-12-31
      const newRow = {
        ...row,
        date_end: '2025-12-31',
        created_at: new Date().toISOString(),
        // Remove id so Supabase generates a new one
        id: undefined
      };
      delete newRow.id;
      
      rowsToInsert.push(newRow);
    });

    console.log(`📝 Creating ${rowsToInsert.length} row(s) for 2025-12-31:`);
    rowsToInsert.forEach(r => {
      console.log(`   - scope=${r.scope}, clicks=${r.clicks_28d}, impressions=${r.impressions_28d || 0}`);
    });
    console.log('');

    // Insert the rows
    const { data: inserted, error: insertError } = await supabase
      .from('portfolio_segment_metrics_28d')
      .insert(rowsToInsert)
      .select();

    if (insertError) {
      throw insertError;
    }

    console.log(`✅ Successfully created ${inserted.length} row(s) for 2025-12-31`);
    console.log('');
    console.log('Created rows:');
    inserted.forEach(r => {
      console.log(`   - scope=${r.scope}, clicks=${r.clicks_28d}, run_id=${r.run_id}`);
    });
    console.log('');
    console.log('✨ The KPI tracker should now show December 2025 data!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

addDecember31Row();
