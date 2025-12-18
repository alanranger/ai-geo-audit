// Test script to debug per-date money_segment_metrics calculation
const SUPABASE_URL = 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnenZ3YnZndm16dnZ6b2NsdWZ4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzY3NzkyOCwiZXhwIjoyMDczMjUzOTI4fQ.W9tkTSYu6Wml0mUr-gJD6hcLMZDcbaYYaOsyDXuwd8M';

const propertyUrl = 'https://www.alanranger.com';

async function testCalculation() {
  console.log('=== Testing per-date money_segment_metrics calculation ===\n');
  
  try {
    // 1. Get latest audit's money_segment_metrics
    console.log('1. Fetching latest audit data...');
    const latestUrl = `${SUPABASE_URL}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&select=audit_date,money_segment_metrics,money_page_priority_data&order=audit_date.desc&limit=1`;
    const latestResponse = await fetch(latestUrl, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!latestResponse.ok) {
      throw new Error(`Failed to fetch latest audit: ${latestResponse.status}`);
    }
    
    const latestData = await latestResponse.json();
    if (latestData.length === 0) {
      throw new Error('No audit data found');
    }
    
    const latestAudit = latestData[0];
    const auditDate = latestAudit.audit_date; // Use the latest audit date
    
    let moneySegmentMetrics = typeof latestAudit.money_segment_metrics === 'string'
      ? JSON.parse(latestAudit.money_segment_metrics)
      : latestAudit.money_segment_metrics;
    
    let moneyPagePriorityData = typeof latestAudit.money_page_priority_data === 'string'
      ? JSON.parse(latestAudit.money_page_priority_data)
      : latestAudit.money_page_priority_data;
    
    console.log(`   Latest audit date: ${auditDate}`);
    console.log(`   Has moneySegmentMetrics: ${!!moneySegmentMetrics}`);
    console.log(`   Has moneyPagePriorityData: ${!!moneyPagePriorityData}`);
    
    if (!moneySegmentMetrics || !moneyPagePriorityData) {
      throw new Error('Missing required data from latest audit');
    }
    
    const allMoney = moneySegmentMetrics.allMoney || {};
    console.log(`   All Money: ${allMoney.clicks} clicks, ${allMoney.impressions} impressions`);
    
    // 2. Fetch timeseries from gsc_timeseries table
    console.log('\n2. Fetching timeseries from gsc_timeseries table...');
    const currentDate = new Date(auditDate);
    const twentyEightDaysAgo = new Date(currentDate);
    twentyEightDaysAgo.setDate(twentyEightDaysAgo.getDate() - 28);
    const startDateStr = twentyEightDaysAgo.toISOString().split('T')[0];
    
    const timeseriesQuery = `${SUPABASE_URL}/rest/v1/gsc_timeseries?property_url=eq.${encodeURIComponent(propertyUrl)}&date=gte.${startDateStr}&date=lte.${auditDate}&select=date,clicks,impressions,ctr,position&order=date.asc`;
    const timeseriesResponse = await fetch(timeseriesQuery, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!timeseriesResponse.ok) {
      throw new Error(`Failed to fetch timeseries: ${timeseriesResponse.status}`);
    }
    
    const timeseriesData = await timeseriesResponse.json();
    const timeseries = timeseriesData.map(t => ({
      date: t.date,
      clicks: t.clicks || 0,
      impressions: t.impressions || 0,
      ctr: t.ctr || 0,
      position: t.position || 0
    }));
    
    console.log(`   Found ${timeseries.length} dates in timeseries`);
    console.log(`   Date range: ${timeseries[0]?.date} to ${timeseries[timeseries.length - 1]?.date}`);
    
    // 3. Find current audit date in timeseries, or use the latest date in timeseries
    let currentDateData = timeseries.find(t => {
      const tsDate = t.date ? t.date.split('T')[0] : null;
      return tsDate === auditDate;
    });
    
    // If audit date not in timeseries, use the latest date that has data
    if (!currentDateData || currentDateData.clicks === 0) {
      console.log(`   ⚠ Audit date ${auditDate} not in timeseries, using latest date with data`);
      // Find the latest date with clicks > 0
      for (let i = timeseries.length - 1; i >= 0; i--) {
        if (timeseries[i].clicks > 0) {
          currentDateData = timeseries[i];
          console.log(`   Using ${currentDateData.date} as reference date`);
          break;
        }
      }
    }
    
    if (!currentDateData || currentDateData.clicks === 0) {
      throw new Error(`No valid timeseries data found`);
    }
    
    console.log(`   Current date data: ${currentDateData.clicks} clicks, ${currentDateData.impressions} impressions`);
    
    // 4. Calculate proportions
    const moneyClicksProportion = allMoney.clicks > 0 ? allMoney.clicks / currentDateData.clicks : 0;
    const moneyImpressionsProportion = allMoney.impressions > 0 ? allMoney.impressions / currentDateData.impressions : 0;
    
    console.log(`\n3. Calculated proportions:`);
    console.log(`   Money clicks proportion: ${moneyClicksProportion} (${(moneyClicksProportion * 100).toFixed(1)}%)`);
    console.log(`   Money impressions proportion: ${moneyImpressionsProportion} (${(moneyImpressionsProportion * 100).toFixed(1)}%)`);
    
    // Validate proportions
    if (moneyClicksProportion <= 0 || moneyImpressionsProportion <= 0 || 
        moneyClicksProportion > 1 || moneyImpressionsProportion > 1) {
      throw new Error(`Invalid proportions: clicks=${moneyClicksProportion}, impressions=${moneyImpressionsProportion}`);
    }
    
    // 5. Calculate segment proportions
    const segmentProportions = {
      allMoney: { clicks: 1.0, impressions: 1.0 },
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
    
    console.log(`\n4. Segment proportions:`);
    console.log(`   Landing: ${(segmentProportions.landingPages.clicks * 100).toFixed(1)}% clicks, ${(segmentProportions.landingPages.impressions * 100).toFixed(1)}% impressions`);
    console.log(`   Event: ${(segmentProportions.eventPages.clicks * 100).toFixed(1)}% clicks, ${(segmentProportions.eventPages.impressions * 100).toFixed(1)}% impressions`);
    console.log(`   Product: ${(segmentProportions.productPages.clicks * 100).toFixed(1)}% clicks, ${(segmentProportions.productPages.impressions * 100).toFixed(1)}% impressions`);
    
    // 6. Get audit dates in range
    console.log(`\n5. Fetching audit dates in range...`);
    const timeseriesDates = timeseries.map(t => t.date ? t.date.split('T')[0] : null).filter(Boolean);
    const minDate = timeseriesDates.length > 0 ? timeseriesDates[0] : null;
    const maxDate = timeseriesDates.length > 0 ? timeseriesDates[timeseriesDates.length - 1] : null;
    
    console.log(`   Date range: ${minDate} to ${maxDate}`);
    
    const historyQuery = `${SUPABASE_URL}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=gte.${minDate}&audit_date=lte.${maxDate}&select=audit_date,money_segment_metrics&order=audit_date.asc`;
    const historyResponse = await fetch(historyQuery, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!historyResponse.ok) {
      throw new Error(`Failed to fetch history: ${historyResponse.status}`);
    }
    
    const historyRecords = await historyResponse.json();
    const historyMap = new Map(historyRecords.map(r => [r.audit_date, r]));
    
    console.log(`   Found ${historyRecords.length} audit records in range`);
    
    // 7. Calculate metrics for each date
    console.log(`\n6. Calculating metrics for each date...`);
    const updates = [];
    
    for (const tsPoint of timeseries) {
      const tsDate = tsPoint.date ? tsPoint.date.split('T')[0] : null;
      if (!tsDate) continue;
      
      // Skip current audit date
      if (tsDate === auditDate) continue;
      
      const existingRecord = historyMap.get(tsDate);
      if (!existingRecord) {
        console.log(`   ⚠ ${tsDate}: No audit record, skipping`);
        continue;
      }
      
      let existingMetrics = existingRecord.money_segment_metrics;
      if (typeof existingMetrics === 'string') {
        try {
          existingMetrics = JSON.parse(existingMetrics);
        } catch (e) {
          existingMetrics = null;
        }
      }
      
      const isInvalid = !existingMetrics || 
        (existingMetrics.allMoney && existingMetrics.allMoney.clicks === 0 && existingMetrics.allMoney.impressions === 0) ||
        (!existingMetrics.allMoney);
      
      if (isInvalid && tsPoint.clicks > 0) {
        // Calculate metrics
        const dateMoneyClicks = Math.round(tsPoint.clicks * moneyClicksProportion);
        const dateMoneyImpressions = Math.round(tsPoint.impressions * moneyImpressionsProportion);
        const dateMoneyCtr = dateMoneyImpressions > 0 ? dateMoneyClicks / dateMoneyImpressions : 0;
        
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
        
        updates.push({
          audit_date: tsDate,
          money_segment_metrics: calculatedMetrics
        });
        
        console.log(`   ✓ ${tsDate}: Will update (${dateMoneyClicks} clicks, ${dateMoneyImpressions} impressions)`);
      } else {
        console.log(`   - ${tsDate}: Already has valid metrics or no data`);
      }
    }
    
    console.log(`\n7. Summary: ${updates.length} dates need updating`);
    
    // 8. Update ALL records (not just test one)
    if (updates.length > 0) {
      console.log(`\n8. Updating ${updates.length} audit record(s)...`);
      
      for (const update of updates) {
        const updateUrl = `${SUPABASE_URL}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.${update.audit_date}`;
        
        const updateResponse = await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
          },
          body: JSON.stringify({
            money_segment_metrics: update.money_segment_metrics
          })
        });
        
        if (updateResponse.ok) {
          const allMoney = update.money_segment_metrics.allMoney || {};
          console.log(`   ✓ Updated ${update.audit_date}: ${allMoney.clicks} clicks, ${allMoney.impressions} impressions`);
        } else {
          const errorText = await updateResponse.text();
          console.error(`   ✗ Failed to update ${update.audit_date}: ${updateResponse.status} - ${errorText}`);
        }
      }
      
      console.log(`\n✓ Completed updating ${updates.length} record(s)`);
    }
    
    console.log('\n=== Test Complete ===\n');
    
  } catch (error) {
    console.error('\n✗ Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testCalculation();

