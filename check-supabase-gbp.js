/**
 * Check latest audit data in Supabase to see GBP data
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  console.error('   Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLatestAudit() {
  const propertyUrl = 'https://www.alanranger.com';
  
  console.log(`🔍 Checking latest audit for: ${propertyUrl}\n`);
  
  try {
    // Check if columns exist first
    const { data: latest, error } = await supabase
      .from('audit_results')
      .select('audit_date, authority_score, authority_review_score, gbp_rating, gbp_review_count, locations, service_areas, local_entity_score, service_area_score')
      .eq('property_url', propertyUrl)
      .order('audit_date', { ascending: false })
      .limit(5);
    
    if (error) {
      console.error('❌ Error:', error.message);
      if (error.code === '42703') {
        console.error('\n⚠️  Columns gbp_rating or gbp_review_count do not exist yet.');
        console.error('   Please run the migration first!');
      }
      return;
    }
    
    if (!latest || latest.length === 0) {
      console.log('❌ No audit data found');
      return;
    }
    
    console.log(`📊 Latest ${latest.length} Audits:\n`);
    
    latest.forEach((audit, idx) => {
      console.log(`--- Audit ${idx + 1} (${audit.audit_date}) ---`);
      console.log(`   Authority Score: ${audit.authority_score}`);
      console.log(`   Authority Review Score: ${audit.authority_review_score}`);
      console.log(`   GBP Rating: ${audit.gbp_rating !== null && audit.gbp_rating !== undefined ? audit.gbp_rating : 'NULL (not stored)'}`);
      console.log(`   GBP Review Count: ${audit.gbp_review_count !== null && audit.gbp_review_count !== undefined ? audit.gbp_review_count : 'NULL (not stored)'}`);
      console.log(`   Local Entity Score: ${audit.local_entity_score}`);
      console.log(`   Service Area Score: ${audit.service_area_score}`);
      
      if (audit.locations) {
        const locs = Array.isArray(audit.locations) ? audit.locations : (typeof audit.locations === 'string' ? JSON.parse(audit.locations) : []);
        console.log(`   Locations: ${locs.length} location(s)`);
      } else {
        console.log(`   Locations: NULL`);
      }
      
      if (audit.service_areas) {
        const sas = Array.isArray(audit.service_areas) ? audit.service_areas : (typeof audit.service_areas === 'string' ? JSON.parse(audit.service_areas) : []);
        console.log(`   Service Areas: ${sas.length} service area(s)`);
      } else {
        console.log(`   Service Areas: NULL`);
      }
      
      if (audit.gbp_rating === null && audit.gbp_review_count === null) {
        console.log(`   ⚠️  GBP data is NULL - will be populated on next audit`);
      } else {
        console.log(`   ✅ GBP data exists!`);
      }
      console.log('');
    });
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
  }
}

checkLatestAudit();

