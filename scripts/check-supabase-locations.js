// Quick script to check what's stored in Supabase for locations and service_areas
const supabaseUrl = 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

async function checkSupabase() {
  console.log('=== Checking Supabase audit_results table ===\n');
  
  // Check latest audit record
  const response = await fetch(
    `${supabaseUrl}/rest/v1/audit_results?select=audit_date,property_url,locations,service_areas,local_entity_score,service_area_score&order=audit_date.desc&limit=1`,
    {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    }
  );
  
  if (!response.ok) {
    console.error(`❌ Error: ${response.status} ${response.statusText}`);
    const text = await response.text();
    console.error(text);
    return;
  }
  
  const data = await response.json();
  
  if (data.length === 0) {
    console.log('⚠️ No audit records found');
    return;
  }
  
  const record = data[0];
  console.log('📊 Latest Audit Record:');
  console.log(`   Date: ${record.audit_date}`);
  console.log(`   Property: ${record.property_url}`);
  console.log(`   Local Entity Score: ${record.local_entity_score}`);
  console.log(`   Service Area Score: ${record.service_area_score}`);
  console.log('');
  
  console.log('📍 Locations Column:');
  console.log(`   Type: ${typeof record.locations}`);
  console.log(`   Is Array: ${Array.isArray(record.locations)}`);
  console.log(`   Is Null: ${record.locations === null}`);
  console.log(`   Is Undefined: ${record.locations === undefined}`);
  
  if (record.locations === null) {
    console.log('   ⚠️ locations is NULL');
  } else if (record.locations === undefined) {
    console.log('   ⚠️ locations is UNDEFINED (column might not exist)');
  } else if (typeof record.locations === 'string') {
    console.log('   ⚠️ locations is a STRING (needs parsing)');
    try {
      const parsed = JSON.parse(record.locations);
      console.log(`   Parsed type: ${typeof parsed}`);
      console.log(`   Parsed is array: ${Array.isArray(parsed)}`);
      if (Array.isArray(parsed)) {
        console.log(`   Parsed length: ${parsed.length}`);
        if (parsed.length > 0) {
          console.log(`   First location: ${JSON.stringify(parsed[0]).substring(0, 200)}...`);
        }
      }
    } catch (e) {
      console.log(`   ❌ Failed to parse: ${e.message}`);
    }
  } else if (Array.isArray(record.locations)) {
    console.log(`   ✅ locations is an ARRAY with ${record.locations.length} items`);
    if (record.locations.length > 0) {
      console.log(`   First location: ${JSON.stringify(record.locations[0]).substring(0, 200)}...`);
    }
  } else {
    console.log(`   Value: ${JSON.stringify(record.locations).substring(0, 200)}`);
  }
  console.log('');
  
  console.log('🌍 Service Areas Column:');
  console.log(`   Type: ${typeof record.service_areas}`);
  console.log(`   Is Array: ${Array.isArray(record.service_areas)}`);
  console.log(`   Is Null: ${record.service_areas === null}`);
  console.log(`   Is Undefined: ${record.service_areas === undefined}`);
  
  if (record.service_areas === null) {
    console.log('   ⚠️ service_areas is NULL');
  } else if (record.service_areas === undefined) {
    console.log('   ⚠️ service_areas is UNDEFINED (column might not exist)');
  } else if (typeof record.service_areas === 'string') {
    console.log('   ⚠️ service_areas is a STRING (needs parsing)');
    try {
      const parsed = JSON.parse(record.service_areas);
      console.log(`   Parsed type: ${typeof parsed}`);
      console.log(`   Parsed is array: ${Array.isArray(parsed)}`);
      if (Array.isArray(parsed)) {
        console.log(`   Parsed length: ${parsed.length}`);
      }
    } catch (e) {
      console.log(`   ❌ Failed to parse: ${e.message}`);
    }
  } else if (Array.isArray(record.service_areas)) {
    console.log(`   ✅ service_areas is an ARRAY with ${record.service_areas.length} items`);
  } else {
    console.log(`   Value: ${JSON.stringify(record.service_areas).substring(0, 200)}`);
  }
  console.log('');
  
  // Check if columns exist
  console.log('🔍 Checking column existence...');
  const columnsResponse = await fetch(
    `${supabaseUrl}/rest/v1/rpc/get_table_columns?table_name=audit_results`,
    {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    }
  );
  
  // Try a different approach - query information_schema
  const schemaQuery = `
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'audit_results' 
    AND column_name IN ('locations', 'service_areas')
    ORDER BY column_name;
  `;
  
  console.log('\n=== Summary ===');
  if (record.locations && Array.isArray(record.locations) && record.locations.length > 0) {
    console.log('✅ Locations: Data is stored correctly in Supabase');
  } else {
    console.log('❌ Locations: Data is missing or empty in Supabase');
  }
  
  if (record.service_areas && Array.isArray(record.service_areas) && record.service_areas.length > 0) {
    console.log('✅ Service Areas: Data is stored correctly in Supabase');
  } else {
    console.log('❌ Service Areas: Data is missing or empty in Supabase');
  }
}

checkSupabase().catch(console.error);

