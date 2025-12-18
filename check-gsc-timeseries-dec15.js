// Check gsc_timeseries data for Dec 15 to see if GSC data exists
const SUPABASE_URL = 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const propertyUrl = 'https://www.alanranger.com';

async function checkTimeseries() {
  // Check gsc_timeseries table for Dec 15
  const timeseriesUrl = `${SUPABASE_URL}/rest/v1/gsc_timeseries?property_url=eq.${encodeURIComponent(propertyUrl)}&date=eq.2025-12-15&select=*`;
  
  console.log('Checking gsc_timeseries table for Dec 15...\n');
  
  try {
    const response = await fetch(timeseriesUrl, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error:', response.status, errorText);
      return;
    }
    
    const data = await response.json();
    
    if (data.length === 0) {
      console.log('❌ No gsc_timeseries data found for Dec 15');
    } else {
      console.log('✓ Found gsc_timeseries data for Dec 15:');
      console.log(JSON.stringify(data[0], null, 2));
    }
    
    // Also check audit_results for Dec 15 to see if gsc_timeseries is stored there
    console.log('\n\nChecking audit_results.gsc_timeseries for Dec 15...\n');
    const auditUrl = `${SUPABASE_URL}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.2025-12-15&select=audit_date,gsc_timeseries&limit=1`;
    
    const auditResponse = await fetch(auditUrl, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (auditResponse.ok) {
      const auditData = await auditResponse.json();
      if (auditData.length > 0 && auditData[0].gsc_timeseries) {
        const ts = typeof auditData[0].gsc_timeseries === 'string' 
          ? JSON.parse(auditData[0].gsc_timeseries)
          : auditData[0].gsc_timeseries;
        
        console.log(`✓ Found ${ts.length} timeseries data points in audit_results`);
        // Find Dec 15 in the timeseries
        const dec15 = ts.find(t => t.date === '2025-12-15' || t.date === '2025-12-15T00:00:00.000Z');
        if (dec15) {
          console.log('\nDec 15 timeseries data:');
          console.log(JSON.stringify(dec15, null, 2));
        } else {
          console.log('\n⚠ Dec 15 not found in timeseries (checking date format)...');
          console.log('Sample dates in timeseries:', ts.slice(0, 3).map(t => t.date));
        }
      } else {
        console.log('❌ No gsc_timeseries found in audit_results for Dec 15');
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkTimeseries();

