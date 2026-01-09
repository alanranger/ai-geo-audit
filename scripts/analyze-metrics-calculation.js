// Analyze how money_segment_metrics should be calculated per-date
const SUPABASE_URL = 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const propertyUrl = 'https://www.alanranger.com';

async function analyze() {
  console.log('=== Analyzing money_segment_metrics calculation ===\n');
  
  // 1. Get latest audit with money_segment_metrics
  console.log('1. Latest audit with money_segment_metrics:');
  const latestAuditUrl = `${SUPABASE_URL}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&select=audit_date,money_segment_metrics,money_page_priority_data&order=audit_date.desc&limit=1`;
  
  const latestResponse = await fetch(latestAuditUrl, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (latestResponse.ok) {
    const latestData = await latestResponse.json();
    if (latestData.length > 0) {
      const audit = latestData[0];
      console.log(`   Latest audit date: ${audit.audit_date}`);
      
      const metrics = typeof audit.money_segment_metrics === 'string'
        ? JSON.parse(audit.money_segment_metrics)
        : audit.money_segment_metrics;
      
      const priorityData = typeof audit.money_page_priority_data === 'string'
        ? JSON.parse(audit.money_page_priority_data)
        : audit.money_page_priority_data;
      
      if (metrics) {
        console.log(`   All Money: ${metrics.allMoney?.clicks || 0} clicks, ${metrics.allMoney?.impressions || 0} impressions`);
        console.log(`   Landing: ${metrics.landingPages?.clicks || 0} clicks, ${metrics.landingPages?.impressions || 0} impressions`);
        console.log(`   Event: ${metrics.eventPages?.clicks || 0} clicks, ${metrics.eventPages?.impressions || 0} impressions`);
        console.log(`   Product: ${metrics.productPages?.clicks || 0} clicks, ${metrics.productPages?.impressions || 0} impressions`);
      }
      
      if (priorityData && Array.isArray(priorityData)) {
        console.log(`   Priority data: ${priorityData.length} money pages`);
        const segments = {
          landing: priorityData.filter(p => p.segmentType === 'landing').length,
          event: priorityData.filter(p => p.segmentType === 'event').length,
          product: priorityData.filter(p => p.segmentType === 'product').length
        };
        console.log(`   Segments: ${segments.landing} landing, ${segments.event} event, ${segments.product} product`);
      }
    }
  }
  
  // 2. Get gsc_timeseries for Dec 11-17
  console.log('\n2. gsc_timeseries data for Dec 11-17:');
  const tsUrl = `${SUPABASE_URL}/rest/v1/gsc_timeseries?property_url=eq.${encodeURIComponent(propertyUrl)}&date=gte.2025-12-11&date=lte.2025-12-17&select=date,clicks,impressions&order=date.asc`;
  
  const tsResponse = await fetch(tsUrl, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (tsResponse.ok) {
    const tsData = await tsResponse.json();
    console.log(`   Found ${tsData.length} dates:`);
    tsData.forEach(t => {
      console.log(`   ${t.date}: ${t.clicks} clicks, ${t.impressions} impressions`);
    });
  }
  
  // 3. Check which audit dates have money_segment_metrics
  console.log('\n3. Audit dates with money_segment_metrics (Dec 11-17):');
  const auditDatesUrl = `${SUPABASE_URL}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=gte.2025-12-11&audit_date=lte.2025-12-17&select=audit_date,money_segment_metrics&order=audit_date.asc`;
  
  const auditDatesResponse = await fetch(auditDatesUrl, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (auditDatesResponse.ok) {
    const auditDates = await auditDatesResponse.json();
    auditDates.forEach(a => {
      const m = typeof a.money_segment_metrics === 'string'
        ? JSON.parse(a.money_segment_metrics)
        : a.money_segment_metrics;
      
      if (m && m.allMoney && (m.allMoney.clicks > 0 || m.allMoney.impressions > 0)) {
        console.log(`   ✓ ${a.audit_date}: Has metrics (${m.allMoney.clicks} clicks, ${m.allMoney.impressions} impressions)`);
      } else {
        console.log(`   ✗ ${a.audit_date}: Missing or zero metrics`);
      }
    });
  }
  
  console.log('\n=== Analysis ===');
  console.log('The issue: money_segment_metrics are only saved for audit_date, not for all dates in the 28-day window.');
  console.log('Solution: When saving an audit, calculate metrics for ALL dates in the last 28 days');
  console.log('using gsc_timeseries data and the current audit\'s money page proportions.');
}

analyze();

