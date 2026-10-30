#!/usr/bin/env node

/**
 * Test script for get-latest-audit endpoint
 * 
 * This script tests the Supabase query directly and the deployed endpoint
 * to diagnose FUNCTION_INVOCATION_FAILED errors and identify bottlenecks.
 */

const PROPERTY_URL = 'https://www.alanranger.com';
const API_BASE_URL = 'https://ai-geo-audit.vercel.app'; // Deployed endpoint
const SUPABASE_URL = 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🧪 Testing get-latest-audit endpoint...\n');
console.log(`Property URL: ${PROPERTY_URL}`);
console.log(`Supabase URL: ${SUPABASE_URL}\n`);

// Test Supabase query directly and then the endpoint
async function testEndpoint() {
  try {
    console.log('📥 Step 1: Testing Supabase query directly (minimal fields)...\n');
    
    // Test minimal query (only essential fields)
    const minimalSelectFields = 'audit_date,updated_at,visibility_score,content_schema_score,authority_score,local_entity_score,service_area_score';
    const minimalQueryUrl = `${SUPABASE_URL}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(PROPERTY_URL)}&order=audit_date.desc&limit=1&select=${encodeURIComponent(minimalSelectFields)}`;
    
    const minimalQueryStart = Date.now();
    let minimalQueryResponse;
    try {
      minimalQueryResponse = await fetch(minimalQueryUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      });
    } catch (fetchError) {
      console.error(`❌ Minimal query fetch failed: ${fetchError.message}`);
      return;
    }
    
    const minimalQueryTime = Date.now() - minimalQueryStart;
    console.log(`⏱️  Minimal query took: ${minimalQueryTime}ms`);
    console.log(`📊 Status: ${minimalQueryResponse.status}`);
    
    if (minimalQueryResponse.ok) {
      const minimalResults = await minimalQueryResponse.json();
      const responseSize = JSON.stringify(minimalResults).length;
      console.log(`📦 Response size: ${Math.round(responseSize / 1024)}KB`);
      
      if (minimalResults && minimalResults.length > 0) {
        const record = minimalResults[0];
        console.log(`✅ Minimal query successful:`);
        console.log(`   - audit_date: ${record.audit_date || 'null'}`);
        console.log(`   - updated_at: ${record.updated_at || 'null'}`);
        console.log(`   - visibility_score: ${record.visibility_score ?? 'null'}`);
        console.log(`   - content_schema_score: ${record.content_schema_score ?? 'null'}`);
        console.log(`   - authority_score: ${record.authority_score ?? 'null'}`);
      } else {
        console.log(`❌ No records found`);
      }
    } else {
      const errorText = await minimalQueryResponse.text();
      console.error(`❌ Minimal query failed: ${errorText}`);
    }
    
    console.log('\n' + '='.repeat(80) + '\n');
    console.log('📥 Step 2: Testing Supabase query directly (all fields)...\n');
    
    // Test full query (all fields)
    const fullQueryUrl = `${SUPABASE_URL}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(PROPERTY_URL)}&order=audit_date.desc&limit=1&select=*`;
    
    const fullQueryStart = Date.now();
    let fullQueryResponse;
    try {
      fullQueryResponse = await fetch(fullQueryUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      });
    } catch (fetchError) {
      console.error(`❌ Full query fetch failed: ${fetchError.message}`);
      return;
    }
    
    const fullQueryTime = Date.now() - fullQueryStart;
    console.log(`⏱️  Full query took: ${fullQueryTime}ms`);
    console.log(`📊 Status: ${fullQueryResponse.status}`);
    
    if (fullQueryResponse.ok) {
      const contentLength = fullQueryResponse.headers.get('content-length');
      if (contentLength) {
        const sizeKB = Math.round(parseInt(contentLength) / 1024);
        console.log(`📦 Response size (from header): ${sizeKB}KB`);
      }
      
      let fullResults;
      try {
        fullResults = await fullQueryResponse.json();
        const responseSize = JSON.stringify(fullResults).length;
        console.log(`📦 Response size (actual): ${Math.round(responseSize / 1024)}KB`);
        
        if (fullResults && fullResults.length > 0) {
          const record = fullResults[0];
          console.log(`✅ Full query successful:`);
          console.log(`   - audit_date: ${record.audit_date || 'null'}`);
          
          // Check field sizes
          const fields = [
            'query_pages',
            'top_queries',
            'schema_pages_detail',
            'gsc_timeseries',
            'ranking_ai_data',
            'money_page_priority_data',
            'money_segment_metrics'
          ];
          
          console.log(`\n📊 Field sizes:`);
          for (const field of fields) {
            if (record[field]) {
              const size = typeof record[field] === 'string' 
                ? record[field].length 
                : JSON.stringify(record[field]).length;
              const sizeKB = Math.round(size / 1024);
              console.log(`   - ${field}: ${sizeKB}KB`);
            } else {
              console.log(`   - ${field}: null`);
            }
          }
        } else {
          console.log(`❌ No records found`);
        }
      } catch (jsonError) {
        console.error(`❌ Failed to parse full query response: ${jsonError.message}`);
        const rawText = await fullQueryResponse.text();
        console.error(`   Raw response (first 500 chars): ${rawText.substring(0, 500)}`);
      }
    } else {
      const errorText = await fullQueryResponse.text();
      console.error(`❌ Full query failed: ${errorText}`);
    }
    
    console.log('\n' + '='.repeat(80) + '\n');
    console.log('📥 Step 3: Testing deployed endpoint (minimal request)...\n');
    
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
    console.log('📥 Step 4: Testing deployed endpoint (full request)...\n');
    
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

