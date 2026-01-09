/**
 * Run migration to add GBP rating and review count columns
 * This script applies the migration using Supabase client
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get Supabase credentials from environment
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  console.log('🔄 Running migration: Add GBP rating and review count columns...\n');
  
  // Read migration SQL
  const migrationPath = path.join(__dirname, 'migrations', '20251217_add_gbp_reviews_columns.sql');
  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
  
  try {
    // Execute the migration SQL
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: migrationSQL });
    
    if (error) {
      // If RPC doesn't exist, try direct SQL execution via REST API
      console.log('⚠️  RPC method not available, trying direct SQL execution...');
      
      // Split SQL into individual statements
      const statements = migrationSQL
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));
      
      for (const statement of statements) {
        console.log(`Executing: ${statement.substring(0, 50)}...`);
        // Use REST API to execute SQL
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
          },
          body: JSON.stringify({ sql_query: statement })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ Error executing statement: ${errorText}`);
        } else {
          console.log('✅ Statement executed successfully');
        }
      }
    } else {
      console.log('✅ Migration applied successfully!');
    }
    
    // Verify columns were added
    console.log('\n🔍 Verifying columns exist...');
    const { data: columns, error: verifyError } = await supabase
      .from('audit_results')
      .select('gbp_rating, gbp_review_count')
      .limit(1);
    
    if (verifyError && verifyError.code === '42703') {
      console.log('❌ Columns not found. Migration may have failed.');
      console.log('Error:', verifyError.message);
    } else {
      console.log('✅ Columns verified! Migration successful.');
    }
    
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    console.error('\n💡 You may need to run this SQL manually in Supabase SQL Editor:');
    console.log('\n' + migrationSQL);
    process.exit(1);
  }
}

runMigration();

