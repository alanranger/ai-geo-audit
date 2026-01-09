/**
 * Check latest audit data in Supabase to see if GBP data exists
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLatestAudit() {
  const propertyUrl = 'https://www.alanranger.com';
  
  console.log(`🔍 Checking latest audit for: ${propertyUrl}\n`);
  
  try {
    const { data, error } = await supabase
      .from('audit_results')
      .select('audit_date, authority_score, authority_review_score, gbp_rating, gbp_review_count, locations, service_areas')
      .eq('property_url', propertyUrl)
      .order('audit_date', { ascending: false })
      .limit(1);
    
    if (error) {
      console.error('❌ Error:', error.message);
      if (error.code === '42703') {
        console.error('\n⚠️  Columns gbp_rating or gbp_review_count do not exist yet.');
        console.error('   Please run the migration first!');
      }
      return;
    }
    
    if (!data || data.length === 0) {
      console.log('❌ No audit data found');
      return;
    }
    
    const audit = data[0];
    console.log('📊 Latest Audit Data:');
    console.log(`   Date: ${audit.audit_date}`);
    console.log(`   Authority Score: ${audit.authority_score}`);
    console.log(`   Authority Review Score: ${audit.authority_review_score}`);
    console.log(`   GBP Rating: ${audit.gbp_rating !== null ? audit.gbp_rating : 'NULL (not stored)'}`);
    console.log(`   GBP Review Count: ${audit.gbp_review_count !== null ? audit.gbp_review_count : 'NULL (not stored)'}`);
    console.log(`   Locations: ${audit.locations ? (Array.isArray(audit.locations) ? audit.locations.length : 'exists') : 'NULL'}`);
    console.log(`   Service Areas: ${audit.service_areas ? (Array.isArray(audit.service_areas) ? audit.service_areas.length : 'exists') : 'NULL'}`);
    
    if (audit.gbp_rating === null && audit.gbp_review_count === null) {
      console.log('\n⚠️  GBP data is NULL - this confirms the issue!');
      console.log('   After running the migration and a fresh audit, this should be populated.');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

checkLatestAudit();

