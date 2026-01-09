// Fix Dec 13 metrics
const SUPABASE_URL = 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const propertyUrl = 'https://www.alanranger.com';

async function fixDec13() {
  console.log('=== Fixing Dec 13 metrics ===\n');
  
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
  
  // Get Dec 13 and Dec 15 timeseries data
  const timeseriesUrl = `${SUPABASE_URL}/rest/v1/gsc_timeseries?property_url=eq.${encodeURIComponent(propertyUrl)}&date=in.(2025-12-13,2025-12-15)&select=date,clicks,impressions&order=date.asc`;
  const tsResponse = await fetch(timeseriesUrl, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  
  const tsData = await tsResponse.json();
  const dec15 = tsData.find(t => t.date.startsWith('2025-12-15'));
  const dec13 = tsData.find(t => t.date.startsWith('2025-12-13'));
  
  if (dec15 && dec13) {
    // Calculate proportions from Dec 15 (reference date)
    const moneyClicksProportion = allMoney.clicks / dec15.clicks;
    const moneyImpressionsProportion = allMoney.impressions / dec15.impressions;
    
    // Calculate Dec 13 metrics
    const dateMoneyClicks = Math.round(dec13.clicks * moneyClicksProportion);
    const dateMoneyImpressions = Math.round(dec13.impressions * moneyImpressionsProportion);
    const dateMoneyCtr = dateMoneyImpressions > 0 ? dateMoneyClicks / dateMoneyImpressions : 0;
    
    // Calculate segment proportions
    const segmentProportions = {
      landingPages: {
        clicks: allMoney.clicks > 0 ? (moneySegmentMetrics.landingPages?.clicks || 0) / allMoney.clicks : 0,
        impressions: allMoney.impressions > 0 ? (moneySegmentMetrics.landingPages?.impressions || 0) / allMoney.impressions : 0
      },
      eventPages: {
        clicks: allMoney.clicks > 0 ? (moneySegmentMetrics.eventPages?.clicks || 0) / allMoney.clicks : 0,
        impressions: allMoney.impressions > 0 ? (moneySegmentMetrics.eventPages?.impressions || 0) / allMoney.impressions : 0
      },
      productPages: {
        clicks: allMoney.clicks > 0 ? (moneySegmentMetrics.productPages?.clicks || 0) / allMoney.clicks : 0,
        impressions: allMoney.impressions > 0 ? (moneySegmentMetrics.productPages?.impressions || 0) / allMoney.impressions : 0
      }
    };
    
    const calculatedMetrics = {
      allMoney: {
        clicks: dateMoneyClicks,
        impressions: dateMoneyImpressions,
        ctr: dateMoneyCtr,
        avgPosition: allMoney.avgPosition || 0,
        behaviourScore: allMoney.behaviourScore || 0
      },
      landingPages: {
        clicks: Math.round(dateMoneyClicks * segmentProportions.landingPages.clicks),
        impressions: Math.round(dateMoneyImpressions * segmentProportions.landingPages.impressions),
        ctr: 0,
        avgPosition: moneySegmentMetrics.landingPages?.avgPosition || 0,
        behaviourScore: moneySegmentMetrics.landingPages?.behaviourScore || 0
      },
      eventPages: {
        clicks: Math.round(dateMoneyClicks * segmentProportions.eventPages.clicks),
        impressions: Math.round(dateMoneyImpressions * segmentProportions.eventPages.impressions),
        ctr: 0,
        avgPosition: moneySegmentMetrics.eventPages?.avgPosition || 0,
        behaviourScore: moneySegmentMetrics.eventPages?.behaviourScore || 0
      },
      productPages: {
        clicks: Math.round(dateMoneyClicks * segmentProportions.productPages.clicks),
        impressions: Math.round(dateMoneyImpressions * segmentProportions.productPages.impressions),
        ctr: 0,
        avgPosition: moneySegmentMetrics.productPages?.avgPosition || 0,
        behaviourScore: moneySegmentMetrics.productPages?.behaviourScore || 0
      }
    };
    
    // Calculate CTRs
    if (calculatedMetrics.landingPages.impressions > 0) {
      calculatedMetrics.landingPages.ctr = calculatedMetrics.landingPages.clicks / calculatedMetrics.landingPages.impressions;
    }
    if (calculatedMetrics.eventPages.impressions > 0) {
      calculatedMetrics.eventPages.ctr = calculatedMetrics.eventPages.clicks / calculatedMetrics.eventPages.impressions;
    }
    if (calculatedMetrics.productPages.impressions > 0) {
      calculatedMetrics.productPages.ctr = calculatedMetrics.productPages.clicks / calculatedMetrics.productPages.impressions;
    }
    
    console.log(`Calculated Dec 13 metrics: ${dateMoneyClicks} clicks, ${dateMoneyImpressions} impressions, ${(dateMoneyCtr * 100).toFixed(2)}% CTR\n`);
    
    // Update Dec 13
    const updateUrl = `${SUPABASE_URL}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.2025-12-13`;
    const updateResponse = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({
        money_segment_metrics: calculatedMetrics
      })
    });
    
    if (updateResponse.ok) {
      console.log('✓ Successfully updated Dec 13 metrics');
    } else {
      const errorText = await updateResponse.text();
      console.error(`✗ Failed to update: ${updateResponse.status} - ${errorText}`);
    }
  }
}

fixDec13();

