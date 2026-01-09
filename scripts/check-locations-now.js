const supabaseUrl = 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

// Check what's actually in the database
const dbResponse = await fetch(`${supabaseUrl}/rest/v1/audit_results?select=property_url,audit_date,locations&order=audit_date.desc&limit=1`, {
  headers: {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`
  }
});

console.log('=== DATABASE CHECK ===');
if (dbResponse.ok) {
  const dbData = await dbResponse.json();
  if (dbData.length > 0) {
    const record = dbData[0];
    console.log('Latest audit:', record.audit_date);
    console.log('Property:', record.property_url);
    console.log('Locations type:', typeof record.locations);
    console.log('Locations value:', record.locations);
    console.log('Is array?', Array.isArray(record.locations));
    if (Array.isArray(record.locations)) {
      console.log('Locations count:', record.locations.length);
      if (record.locations.length > 0) {
        console.log('First location:', JSON.stringify(record.locations[0], null, 2));
      }
    } else if (typeof record.locations === 'string') {
      console.log('Locations is a STRING (needs parsing)');
      try {
        const parsed = JSON.parse(record.locations);
        console.log('Parsed locations count:', Array.isArray(parsed) ? parsed.length : 'not an array');
      } catch (e) {
        console.log('Failed to parse:', e.message);
      }
    }
  } else {
    console.log('No records found');
  }
} else {
  console.log('DB query failed:', dbResponse.status);
}

// Check what the API returns
console.log('\n=== API CHECK ===');
const apiResponse = await fetch(`https://ai-geo-audit.vercel.app/api/supabase/get-latest-audit?propertyUrl=${encodeURIComponent('https://www.alanranger.com')}`);
if (apiResponse.ok) {
  const apiData = await apiResponse.json();
  console.log('API status:', apiData.status);
  if (apiData.data && apiData.data.localSignals) {
    console.log('localSignals exists:', !!apiData.data.localSignals);
    console.log('localSignals.status:', apiData.data.localSignals.status);
    if (apiData.data.localSignals.data) {
      console.log('localSignals.data.locations type:', typeof apiData.data.localSignals.data.locations);
      console.log('localSignals.data.locations is array?', Array.isArray(apiData.data.localSignals.data.locations));
      console.log('localSignals.data.locations count:', apiData.data.localSignals.data.locations?.length || 0);
      if (apiData.data.localSignals.data.locations && apiData.data.localSignals.data.locations.length > 0) {
        console.log('First location in API response:', JSON.stringify(apiData.data.localSignals.data.locations[0], null, 2));
      }
    }
  } else {
    console.log('No localSignals in API response');
    console.log('API data keys:', Object.keys(apiData.data || {}));
  }
} else {
  console.log('API request failed:', apiResponse.status);
  const errorText = await apiResponse.text();
  console.log('Error:', errorText);
}










