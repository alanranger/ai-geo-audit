// Check if Dec 13 metrics are correct or need recalculation
const SUPABASE_URL = 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const propertyUrl = 'https://www.alanranger.com';

async function checkDec13() {
  console.log('=== Checking Dec 13 spike ===\n');
  
  // Get latest audit for proportions
  const latestUrl = `${SUPABASE_URL}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&select=audit_date,money_segment_metrics&order=audit_date.desc&limit=1`;
  const latestResponse = await fetch(latestUrl, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  
  const latestData = await latestResponse.json();
  const latestAudit = latestData[0];
  let moneySegmentMetrics = typeof latestAudit.money_segment_metrics === 'string'
    ? JSON.parse(latestAudit.money_segment_metrics)
    : latestAudit.money_segment_metrics;
  
  const allMoney = moneySegmentMetrics.allMoney || {};
  console.log(`Latest audit (${latestAudit.audit_date}): ${allMoney.clicks} clicks, ${allMoney.impressions} impressions`);
  
  // Get Dec 13 timeseries data
  const timeseriesUrl = `${SUPABASE_URL}/rest/v1/gsc_timeseries?property_url=eq.${encodeURIComponent(propertyUrl)}&date=eq.2025-12-13&select=date,clicks,impressions`;
  const tsResponse = await fetch(timeseriesUrl, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  
  const tsData = await tsResponse.json();
  if (tsData.length > 0) {
    const ts = tsData[0];
    console.log(`\nDec 13 GSC timeseries: ${ts.clicks} clicks, ${ts.impressions} impressions`);
    
    // Get Dec 13 audit record
    const auditUrl = `${SUPABASE_URL}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.2025-12-13&select=audit_date,money_segment_metrics`;
    const auditResponse = await fetch(auditUrl, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    const auditData = await auditResponse.json();
    if (auditData.length > 0) {
      let metrics = auditData[0].money_segment_metrics;
      if (typeof metrics === 'string') {
        metrics = JSON.parse(metrics);
      }
      const currentAllMoney = metrics?.allMoney || {};
      console.log(`Dec 13 current metrics: ${currentAllMoney.clicks} clicks, ${currentAllMoney.impressions} impressions`);
      
      // Calculate what it should be using latest audit proportions
      // Use Dec 15 as reference (latest in timeseries)
      const refUrl = `${SUPABASE_URL}/rest/v1/gsc_timeseries?property_url=eq.${encodeURIComponent(propertyUrl)}&date=eq.2025-12-15&select=date,clicks,impressions`;
      const refResponse = await fetch(refUrl, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      
      const refData = await refResponse.json();
      if (refData.length > 0) {
        const ref = refData[0];
        const moneyClicksProportion = allMoney.clicks / ref.clicks;
        const moneyImpressionsProportion = allMoney.impressions / ref.impressions;
        
        const calculatedClicks = Math.round(ts.clicks * moneyClicksProportion);
        const calculatedImpressions = Math.round(ts.impressions * moneyImpressionsProportion);
        
        console.log(`\nDec 13 calculated (should be): ${calculatedClicks} clicks, ${calculatedImpressions} impressions`);
        console.log(`Dec 13 current (actual): ${currentAllMoney.clicks} clicks, ${currentAllMoney.impressions} impressions`);
        
        if (Math.abs(calculatedClicks - currentAllMoney.clicks) > 10 || 
            Math.abs(calculatedImpressions - currentAllMoney.impressions) > 100) {
          console.log(`\n⚠️ Dec 13 metrics appear incorrect - should be recalculated`);
        } else {
          console.log(`\n✓ Dec 13 metrics appear correct`);
        }
      }
    }
  }
}

checkDec13();

