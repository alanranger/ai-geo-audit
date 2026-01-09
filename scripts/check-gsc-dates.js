// Check actual GSC dates in Supabase
const SUPABASE_URL = 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const propertyUrl = 'https://www.alanranger.com';

async function checkGscDates() {
  console.log('=== Checking GSC dates in Supabase ===\n');
  
  // Check gsc_timeseries table
  console.log('1. Checking gsc_timeseries table...');
  const timeseriesUrl = `${SUPABASE_URL}/rest/v1/gsc_timeseries?property_url=eq.${encodeURIComponent(propertyUrl)}&select=date,clicks,impressions&order=date.desc&limit=5`;
  const tsResponse = await fetch(timeseriesUrl, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (tsResponse.ok) {
    const tsData = await tsResponse.json();
    console.log(`   Latest 5 dates in gsc_timeseries:`);
    tsData.forEach(t => {
      console.log(`   - ${t.date}: ${t.clicks} clicks, ${t.impressions} impressions`);
    });
    if (tsData.length > 0) {
      console.log(`   ✓ Latest GSC date: ${tsData[0].date}`);
    }
  } else {
    console.error(`   ✗ Failed to fetch: ${tsResponse.status}`);
  }
  
  // Check audit_results for latest audit date
  console.log('\n2. Checking latest audit date...');
  const auditUrl = `${SUPABASE_URL}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&select=audit_date&order=audit_date.desc&limit=1`;
  const auditResponse = await fetch(auditUrl, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (auditResponse.ok) {
    const auditData = await auditResponse.json();
    if (auditData.length > 0) {
      console.log(`   Latest audit date: ${auditData[0].audit_date}`);
    }
  }
  
  // Check what date the charts are using
  console.log('\n3. Today\'s date (GMT):');
  const today = new Date();
  const todayGMT = new Date(today.toISOString().split('T')[0] + 'T00:00:00Z');
  console.log(`   ${todayGMT.toISOString().split('T')[0]}`);
  
  console.log('\n=== Summary ===');
  console.log('GSC data is typically 2-3 days behind, so if today is Dec 18,');
  console.log('the latest GSC data should be around Dec 15-16.');
}

checkGscDates();

