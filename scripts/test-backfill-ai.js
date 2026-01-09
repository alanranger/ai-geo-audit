// Test script to verify backfill AI logic before running
// Run with: node test-backfill-ai.js

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testBackfillLogic() {
  const auditDate = '2025-12-22';
  const siteUrl = 'https://www.alanranger.com';
  
  console.log(`\n=== Testing Backfill Logic for ${auditDate} ===\n`);
  
  // Get keywords
  const { data: keywords, error } = await supabase
    .from('keyword_rankings')
    .select('*')
    .eq('audit_date', auditDate)
    .eq('property_url', siteUrl);
  
  if (error) {
    console.error('Error fetching keywords:', error);
    return;
  }
  
  console.log(`Found ${keywords.length} keywords\n`);
  
  // Group by segment (simulate script logic)
  const segmentKeywords = {
    money: [],
    landing: [],
    event: [],
    product: [],
    all_tracked: []
  };
  
  keywords.forEach(keyword => {
    const keywordSegment = (keyword.segment || '').toLowerCase();
    const pageType = (keyword.page_type || '').toLowerCase();
    
    if (keywordSegment !== 'money') {
      return; // Skip non-money keywords
    }
    
    segmentKeywords.money.push(keyword);
    
    if (pageType === 'landing') {
      segmentKeywords.landing.push(keyword);
    } else if (pageType === 'product') {
      segmentKeywords.product.push(keyword);
    } else if (pageType === 'event') {
      segmentKeywords.event.push(keyword);
    } else {
      segmentKeywords.landing.push(keyword); // Default to landing
    }
  });
  
  // Calculate AI metrics
  console.log('=== Calculated AI Metrics ===\n');
  
  for (const [segment, keywordList] of Object.entries(segmentKeywords)) {
    const totalCitations = keywordList.reduce((sum, k) => sum + (parseInt(k.ai_alan_citations_count) || 0), 0);
    const overviewCount = keywordList.filter(k => 
      k.has_ai_overview === true || k.ai_overview_present_any === true
    ).length;
    
    console.log(`${segment}:`);
    console.log(`  Keywords: ${keywordList.length}`);
    console.log(`  Citations: ${totalCitations}`);
    console.log(`  Overview Count: ${overviewCount}`);
    console.log('');
  }
  
  // Check existing portfolio rows
  console.log('=== Existing Portfolio Rows ===\n');
  const { data: existing } = await supabase
    .from('portfolio_segment_metrics_28d')
    .select('*')
    .eq('run_id', auditDate)
    .eq('site_url', siteUrl)
    .order('segment');
  
  if (existing) {
    existing.forEach(row => {
      console.log(`${row.segment}: citations=${row.ai_citations_28d}, overview=${row.ai_overview_present_count}`);
    });
  }
  
  console.log('\n=== Test Complete ===\n');
}

testBackfillLogic().catch(console.error);

