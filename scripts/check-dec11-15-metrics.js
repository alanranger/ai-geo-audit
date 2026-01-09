// Check money_segment_metrics for Dec 11-15
const SUPABASE_URL = 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const propertyUrl = 'https://www.alanranger.com';

async function checkMetrics() {
  console.log('=== Checking money_segment_metrics for Dec 11-15 ===\n');
  
  const dates = ['2025-12-11', '2025-12-13', '2025-12-15'];
  
  for (const date of dates) {
    const query = `${SUPABASE_URL}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.${date}&select=audit_date,is_partial,money_segment_metrics`;
    const response = await fetch(query, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.length > 0) {
        const record = data[0];
        let metrics = record.money_segment_metrics;
        if (typeof metrics === 'string') {
          try {
            metrics = JSON.parse(metrics);
          } catch (e) {
            metrics = null;
          }
        }
        
        const allMoney = metrics?.allMoney || {};
        const hasValidMetrics = allMoney.clicks > 0 || allMoney.impressions > 0;
        
        console.log(`${date}:`);
        console.log(`  is_partial: ${record.is_partial}`);
        console.log(`  Has metrics: ${!!metrics}`);
        console.log(`  Valid metrics: ${hasValidMetrics}`);
        if (metrics && allMoney) {
          console.log(`  All Money: ${allMoney.clicks} clicks, ${allMoney.impressions} impressions, ${(allMoney.ctr * 100).toFixed(2)}% CTR`);
        } else {
          console.log(`  All Money: MISSING or ZERO`);
        }
        console.log('');
      } else {
        console.log(`${date}: No audit record found\n`);
      }
    } else {
      console.error(`${date}: Failed to fetch - ${response.status}`);
    }
  }
}

checkMetrics();

