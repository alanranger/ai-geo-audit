/**
 * Test Supabase Connection
 * 
 * This script tests the connection to Supabase and verifies access to the database.
 * 
 * Usage:
 *   1. Create a .env file with your Supabase credentials:
 *      SUPABASE_URL=https://your-project.supabase.co
 *      SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
 *   
 *   2. Run: node test-supabase-connection.js
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables from .env file if it exists
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials!');
  console.error('');
  console.error('Please set the following environment variables:');
  console.error('  - SUPABASE_URL');
  console.error('  - SUPABASE_SERVICE_ROLE_KEY');
  console.error('');
  console.error('You can either:');
  console.error('  1. Create a .env file in the project root with:');
  console.error('     SUPABASE_URL=https://your-project.supabase.co');
  console.error('     SUPABASE_SERVICE_ROLE_KEY=your-service-role-key');
  console.error('');
  console.error('  2. Or set them as environment variables:');
  console.error('     $env:SUPABASE_URL="https://your-project.supabase.co"');
  console.error('     $env:SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"');
  process.exit(1);
}

console.log('🔌 Connecting to Supabase...');
console.log(`   URL: ${supabaseUrl.substring(0, 30)}...`);
console.log(`   Key: ${supabaseKey.substring(0, 20)}...`);
console.log('');

// Create Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

// Test connection by querying audit_results table
async function testConnection() {
  try {
    console.log('📊 Testing connection...');
    
    // Test 1: Query audit_results table (should return at least metadata)
    console.log('   Test 1: Querying audit_results table...');
    const { data: auditData, error: auditError } = await supabase
      .from('audit_results')
      .select('property_url, audit_date, visibility_score')
      .limit(1);
    
    if (auditError) {
      console.error('   ❌ Error querying audit_results:', auditError.message);
      return false;
    }
    
    console.log(`   ✅ Successfully queried audit_results (found ${auditData?.length || 0} records)`);
    
    // Test 2: Query keyword_rankings table
    console.log('   Test 2: Querying keyword_rankings table...');
    const { data: keywordData, error: keywordError } = await supabase
      .from('keyword_rankings')
      .select('keyword, best_rank_group')
      .limit(1);
    
    if (keywordError) {
      console.error('   ❌ Error querying keyword_rankings:', keywordError.message);
      return false;
    }
    
    console.log(`   ✅ Successfully queried keyword_rankings (found ${keywordData?.length || 0} records)`);
    
    // Test 3: Get latest audit for a property
    console.log('   Test 3: Getting latest audit...');
    const { data: latestAudit, error: latestError } = await supabase
      .from('audit_results')
      .select('*')
      .order('audit_date', { ascending: false })
      .limit(1)
      .single();
    
    if (latestError && latestError.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('   ❌ Error getting latest audit:', latestError.message);
      return false;
    }
    
    if (latestAudit) {
      console.log(`   ✅ Found latest audit: ${latestAudit.audit_date} for ${latestAudit.property_url}`);
    } else {
      console.log('   ⚠️  No audit records found (this is OK if you haven\'t run any audits yet)');
    }
    
    console.log('');
    console.log('✅ All connection tests passed!');
    console.log('');
    console.log('You can now use Supabase in your scripts.');
    return true;
    
  } catch (error) {
    console.error('❌ Connection test failed:', error.message);
    console.error('   Stack:', error.stack);
    return false;
  }
}

// Run the test
testConnection()
  .then(success => {
    if (success) {
      console.log('🎉 Supabase connection is working!');
      process.exit(0);
    } else {
      console.log('❌ Connection test failed. Please check your credentials.');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
  });

