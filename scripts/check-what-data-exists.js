// Check what GSC data exists in Supabase for Dec 11-17
const SUPABASE_URL = 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const propertyUrl = 'https://www.alanranger.com';

async function checkData() {
  console.log('=== Checking what GSC data exists in Supabase ===\n');
  
  // 1. Check gsc_timeseries table
  console.log('1. gsc_timeseries table (per-date aggregate data):');
  const timeseriesUrl = `${SUPABASE_URL}/rest/v1/gsc_timeseries?property_url=eq.${encodeURIComponent(propertyUrl)}&date=gte.2025-12-11&date=lte.2025-12-17&select=date,clicks,impressions,ctr,position&order=date.asc`;
  
  try {
    const tsResponse = await fetch(timeseriesUrl, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (tsResponse.ok) {
      const tsData = await tsResponse.json();
      console.log(`   Found ${tsData.length} dates in gsc_timeseries table:`);
      tsData.forEach(t => {
        console.log(`   ${t.date}: ${t.clicks} clicks, ${t.impressions} impressions, ${(t.ctr * 100).toFixed(2)}% CTR`);
      });
    }
  } catch (e) {
    console.error('   Error:', e.message);
  }
  
  // 2. Check audit_results.gsc_timeseries field
  console.log('\n2. audit_results.gsc_timeseries field (stored in audit records):');
  const auditUrl = `${SUPABASE_URL}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=gte.2025-12-11&audit_date=lte.2025-12-17&select=audit_date,gsc_timeseries&order=audit_date.asc`;
  
  try {
    const auditResponse = await fetch(auditUrl, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (auditResponse.ok) {
      const auditData = await auditResponse.json();
      auditData.forEach(record => {
        if (record.gsc_timeseries) {
          const ts = typeof record.gsc_timeseries === 'string' 
            ? JSON.parse(record.gsc_timeseries)
            : record.gsc_timeseries;
          console.log(`   ${record.audit_date}: Has ${ts.length} timeseries data points`);
          
          // Find Dec 11-17 in this timeseries
          const relevantDates = ts.filter(t => {
            const date = t.date ? t.date.split('T')[0] : null;
            return date && date >= '2025-12-11' && date <= '2025-12-17';
          });
          if (relevantDates.length > 0) {
            console.log(`      Contains ${relevantDates.length} dates from Dec 11-17:`);
            relevantDates.forEach(t => {
              const date = t.date ? t.date.split('T')[0] : 'unknown';
              console.log(`        ${date}: ${t.clicks} clicks, ${t.impressions} impressions`);
            });
          }
        } else {
          console.log(`   ${record.audit_date}: No gsc_timeseries data`);
        }
      });
    }
  } catch (e) {
    console.error('   Error:', e.message);
  }
  
  // 3. Check query_pages (page-level data)
  console.log('\n3. audit_results.query_pages (page-level GSC data):');
  const queryPagesUrl = `${SUPABASE_URL}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=gte.2025-12-11&audit_date=lte.2025-12-17&select=audit_date,query_pages&order=audit_date.asc`;
  
  try {
    const qpResponse = await fetch(queryPagesUrl, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (qpResponse.ok) {
      const qpData = await qpResponse.json();
      qpData.forEach(record => {
        if (record.query_pages) {
          const qp = typeof record.query_pages === 'string' 
            ? JSON.parse(record.query_pages)
            : record.query_pages;
          console.log(`   ${record.audit_date}: Has ${qp.length} query_pages entries`);
          if (qp.length > 0) {
            // Check if pages have date info
            const sample = qp[0];
            console.log(`      Sample entry keys: ${Object.keys(sample).join(', ')}`);
            if (sample.date) {
              console.log(`      ✓ Has per-date page data`);
            } else {
              console.log(`      ⚠ No date field - aggregated over date range`);
            }
          }
        } else {
          console.log(`   ${record.audit_date}: No query_pages data`);
        }
      });
    }
  } catch (e) {
    console.error('   Error:', e.message);
  }
  
  console.log('\n=== Summary ===');
  console.log('The issue: money_segment_metrics need to know which PAGES are money pages');
  console.log('and their segment types (landing/event/product).');
  console.log('gsc_timeseries has aggregate totals per date, but not page-level breakdown.');
  console.log('query_pages has page-level data, but aggregated over 28 days (not per-date).');
}

checkData();

