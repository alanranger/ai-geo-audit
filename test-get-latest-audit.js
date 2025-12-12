#!/usr/bin/env node

/**
 * Test script for get-latest-audit endpoint
 * 
 * This script tests the deployed get-latest-audit endpoint via HTTP
 * to diagnose FUNCTION_INVOCATION_FAILED errors and identify bottlenecks.
 */

const PROPERTY_URL = 'https://www.alanranger.com';
const API_BASE_URL = 'https://ai-geo-audit.vercel.app'; // Deployed endpoint

console.log('🧪 Testing get-latest-audit endpoint via HTTP...\n');
console.log(`Property URL: ${PROPERTY_URL}`);
console.log(`API Base URL: ${API_BASE_URL}\n`);

// Test the deployed endpoint via HTTP
async function testEndpoint() {
  try {
    console.log('📥 Step 1: Testing minimal request (timestamp + scores only)...\n');
    
    // Test minimal request
    const minimalUrl = `${API_BASE_URL}/api/supabase/get-latest-audit?propertyUrl=${encodeURIComponent(PROPERTY_URL)}&minimal=true`;
    const minimalController = new AbortController();
    const minimalTimeout = setTimeout(() => minimalController.abort(), 10000);
    
    const minimalStart = Date.now();
    let minimalResponse;
    try {
      minimalResponse = await fetch(minimalUrl, {
        signal: minimalController.signal
      });
      clearTimeout(minimalTimeout);
    } catch (fetchError) {
      clearTimeout(minimalTimeout);
      if (fetchError.name === 'AbortError') {
        console.error(`❌ Minimal request timed out after 10 seconds`);
      } else {
        console.error(`❌ Minimal request failed: ${fetchError.message}`);
      }
      return;
    }
    
    const minimalTime = Date.now() - minimalStart;
    console.log(`⏱️  Minimal request took: ${minimalTime}ms`);
    console.log(`📊 Status: ${minimalResponse.status}`);
    
    if (minimalResponse.ok) {
      const minimalResult = await minimalResponse.json();
      const responseSize = JSON.stringify(minimalResult).length;
      console.log(`📦 Response size: ${Math.round(responseSize / 1024)}KB`);
      
      if (minimalResult.status === 'ok' && minimalResult.data) {
        const data = minimalResult.data;
        console.log(`✅ Minimal data retrieved:`);
        console.log(`   - Timestamp: ${data.timestamp ? new Date(data.timestamp).toLocaleString() : 'null'}`);
        console.log(`   - Audit Date: ${data.auditDate || 'null'}`);
        console.log(`   - Scores: ${data.scores ? Object.keys(data.scores).length + ' scores' : 'null'}`);
      } else {
        console.log(`❌ Minimal request failed:`, minimalResult);
      }
    } else {
      const errorText = await minimalResponse.text();
      console.error(`❌ Minimal request failed: ${errorText}`);
    }
    
    console.log('\n' + '='.repeat(80) + '\n');
    console.log('📥 Step 2: Testing full request (all data)...\n');
    
    // Test full request
    const fullUrl = `${API_BASE_URL}/api/supabase/get-latest-audit?propertyUrl=${encodeURIComponent(PROPERTY_URL)}`;
    const fullController = new AbortController();
    const fullTimeout = setTimeout(() => fullController.abort(), 30000);
    
    const fullStart = Date.now();
    let fullResponse;
    try {
      fullResponse = await fetch(fullUrl, {
        signal: fullController.signal
      });
      clearTimeout(fullTimeout);
    } catch (fetchError) {
      clearTimeout(fullTimeout);
      if (fetchError.name === 'AbortError') {
        console.error(`❌ Full request timed out after 30 seconds`);
      } else {
        console.error(`❌ Full request failed: ${fetchError.message}`);
      }
      return;
    }
    
    const fullTime = Date.now() - fullStart;
    console.log(`⏱️  Full request took: ${fullTime}ms`);
    console.log(`📊 Status: ${fullResponse.status}`);
    
    if (fullResponse.ok) {
      const fullResult = await fullResponse.json();
      const responseSize = JSON.stringify(fullResult).length;
      console.log(`📦 Response size: ${Math.round(responseSize / 1024)}KB`);
      
      if (fullResult.status === 'ok' && fullResult.data) {
        const data = fullResult.data;
        console.log(`✅ Full data retrieved:`);
        console.log(`   - Timestamp: ${new Date(data.timestamp).toLocaleString()}`);
        console.log(`   - Audit Date: ${data.auditDate || 'null'}`);
        console.log(`   - Scores: ${data.scores ? 'present' : 'null'}`);
        console.log(`   - Search Data: ${data.searchData ? 'present' : 'null'}`);
        console.log(`   - Schema Audit: ${data.schemaAudit ? 'present' : 'null'}`);
        console.log(`   - Ranking AI Data: ${data.rankingAiData ? 'present' : 'null'}`);
        console.log(`   - Money Pages: ${data.moneyPagePriorityData ? 'present' : 'null'}`);
        
        // Check for large fields
        if (data.searchData) {
          if (data.searchData.queryPages) {
            console.log(`   - queryPages: ${data.searchData.queryPages.length} items`);
          }
          if (data.searchData.topQueries) {
            console.log(`   - topQueries: ${data.searchData.topQueries.length} items`);
          }
          if (data.searchData.timeseries) {
            console.log(`   - timeseries: ${data.searchData.timeseries.length} items`);
          }
        }
        
        if (data.schemaAudit && data.schemaAudit.data) {
          if (data.schemaAudit.data.pages) {
            console.log(`   - schema pages: ${data.schemaAudit.data.pages.length} items`);
          }
        }
        
        if (data.rankingAiData && data.rankingAiData.combinedRows) {
          console.log(`   - ranking keywords: ${data.rankingAiData.combinedRows.length} items`);
        }
      } else {
        console.log(`❌ Full request failed:`, fullResult);
      }
    } else {
      const errorText = await fullResponse.text();
      console.error(`❌ Full request failed: ${errorText}`);
      
      // Try to parse as JSON for more details
      try {
        const errorJson = JSON.parse(errorText);
        console.error(`   Error details:`, errorJson);
      } catch (e) {
        // Not JSON, already logged as text
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testEndpoint().catch(console.error);

