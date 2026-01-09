// Check money_segment_metrics for Dec 11-17
const SUPABASE_URL = 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const propertyUrl = 'https://www.alanranger.com';

async function checkMetrics() {
  const url = `${SUPABASE_URL}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=gte.2025-12-11&audit_date=lte.2025-12-17&select=audit_date,money_segment_metrics&order=audit_date.asc`;
  
  try {
    const response = await fetch(url, {
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
    
    console.log('\n=== Money Segment Metrics for Dec 11-17 ===\n');
    
    for (const record of data) {
      console.log(`\nDate: ${record.audit_date}`);
      const metrics = typeof record.money_segment_metrics === 'string' 
        ? JSON.parse(record.money_segment_metrics)
        : record.money_segment_metrics;
      
      if (!metrics) {
        console.log('  ❌ No metrics (null/undefined)');
        continue;
      }
      
      const allMoney = metrics.allMoney || {};
      console.log(`  All Money:`);
      console.log(`    Clicks: ${allMoney.clicks || 0}`);
      console.log(`    Impressions: ${allMoney.impressions || 0}`);
      console.log(`    CTR: ${allMoney.ctr ? (allMoney.ctr * 100).toFixed(2) + '%' : '0%'}`);
      console.log(`    Avg Position: ${allMoney.avgPosition || 0}`);
      
      const landing = metrics.landingPages || {};
      console.log(`  Landing Pages:`);
      console.log(`    Clicks: ${landing.clicks || 0}`);
      console.log(`    Impressions: ${landing.impressions || 0}`);
      
      const event = metrics.eventPages || {};
      console.log(`  Event Pages:`);
      console.log(`    Clicks: ${event.clicks || 0}`);
      console.log(`    Impressions: ${event.impressions || 0}`);
      
      const product = metrics.productPages || {};
      console.log(`  Product Pages:`);
      console.log(`    Clicks: ${product.clicks || 0}`);
      console.log(`    Impressions: ${product.impressions || 0}`);
    }
    
    console.log('\n=== End of Report ===\n');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkMetrics();

