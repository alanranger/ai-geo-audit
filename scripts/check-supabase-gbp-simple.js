/**
 * Check latest audit data in Supabase using REST API
 * This works without needing local env vars - uses the same approach as the API endpoints
 */

const propertyUrl = 'https://www.alanranger.com';

// These should be in Vercel env vars, but for local check we'll need them
// For now, let's just show what we're checking for
console.log(`🔍 Checking latest audit for: ${propertyUrl}\n`);
console.log('📋 What to check in Supabase:');
console.log('');
console.log('Run this SQL in Supabase SQL Editor:');
console.log('');
console.log(`SELECT 
  audit_date,
  authority_score,
  authority_review_score,
  gbp_rating,
  gbp_review_count,
  local_entity_score,
  service_area_score,
  CASE 
    WHEN locations IS NULL THEN 'NULL'
    WHEN jsonb_typeof(locations) = 'array' THEN jsonb_array_length(locations)::text || ' locations'
    ELSE 'exists (not array)'
  END as locations_info,
  CASE 
    WHEN service_areas IS NULL THEN 'NULL'
    WHEN jsonb_typeof(service_areas) = 'array' THEN jsonb_array_length(service_areas)::text || ' service areas'
    ELSE 'exists (not array)'
  END as service_areas_info
FROM audit_results
WHERE property_url = '${propertyUrl}'
ORDER BY audit_date DESC
LIMIT 5;`);
console.log('');
console.log('Expected results:');
console.log('  - gbp_rating and gbp_review_count should be NULL for old audits');
console.log('  - After next audit, they should show values (e.g., 4.81 and 221)');
console.log('  - locations and service_areas should have data from recent audits');

