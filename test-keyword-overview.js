/**
 * Local test script for DataForSEO Keyword Overview API
 * 
 * Run with: node test-keyword-overview.js
 * 
 * Requires DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD environment variables.
 * Set them before running:
 *   export DATAFORSEO_LOGIN="your_login"
 *   export DATAFORSEO_PASSWORD="your_password"
 *   node test-keyword-overview.js
 * 
 * Or on Windows PowerShell:
 *   $env:DATAFORSEO_LOGIN="your_login"
 *   $env:DATAFORSEO_PASSWORD="your_password"
 *   node test-keyword-overview.js
 */

// Try to load dotenv if available (optional)
try {
  require('dotenv').config({ path: '.env.local' });
} catch (e) {
  // dotenv not available, use environment variables directly
}

// Accept credentials from command line args or environment variables
const DATAFORSEO_LOGIN = process.argv[2] || process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.argv[3] || process.env.DATAFORSEO_PASSWORD;

if (!DATAFORSEO_LOGIN || !DATAFORSEO_PASSWORD) {
  console.error('❌ Missing DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD');
  console.error('\nUsage:');
  console.error('  node test-keyword-overview.js <login> <password>');
  console.error('\nOr set environment variables:');
  console.error('  export DATAFORSEO_LOGIN="your_login"');
  console.error('  export DATAFORSEO_PASSWORD="your_password"');
  console.error('  node test-keyword-overview.js');
  console.error('\nOr on Windows PowerShell:');
  console.error('  $env:DATAFORSEO_LOGIN="your_login"');
  console.error('  $env:DATAFORSEO_PASSWORD="your_password"');
  console.error('  node test-keyword-overview.js');
  process.exit(1);
}

function normalizeKeyword(keyword) {
  return String(keyword).toLowerCase().trim();
}

async function testKeywordOverview() {
  const endpoint = "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live";
  
  // Test with a few sample keywords
  const keywords = [
    "photography lessons online",
    "photography courses",
    "camera settings"
  ];
  
  const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString("base64");
  
  console.log(`\n🧪 Testing Keyword Overview API`);
  console.log(`   Endpoint: ${endpoint}`);
  console.log(`   Keywords: ${keywords.join(', ')}`);
  console.log(`   Location: UK (2826)`);
  console.log(`   Language: en\n`);
  
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify([
        {
          keywords: keywords,
          language_code: "en",
          location_code: 2826,
        },
      ]),
    });

    const data = await response.json();
    
    console.log(`📊 Response Status: ${response.status}`);
    console.log(`📊 API Status Code: ${data.status_code}`);
    console.log(`📊 API Status Message: ${data.status_message || 'N/A'}\n`);
    
    if (!response.ok || !String(data.status_code).startsWith("200")) {
      console.error('❌ API Error Response:');
      console.error(JSON.stringify(data, null, 2));
      return;
    }

    // Inspect response structure
    console.log('📋 Response Structure:');
    console.log(`   - tasks array length: ${data.tasks?.length || 0}`);
    
    if (data.tasks && data.tasks.length > 0) {
      const task = data.tasks[0];
      console.log(`   - task.status_code: ${task.status_code}`);
      console.log(`   - task.status_message: ${task.status_message || 'N/A'}`);
      console.log(`   - task.result array length: ${task.result?.length || 0}`);
      
      if (task.result && task.result.length > 0) {
        const result = task.result[0];
        console.log(`   - result.items array length: ${result.items?.length || 0}\n`);
        
        if (result.items && result.items.length > 0) {
          console.log('✅ Sample Item Structure:');
          const sampleItem = result.items[0];
          console.log(JSON.stringify(sampleItem, null, 2));
          console.log('\n');
          
          // Process items
          const volumeByKeyword = {};
          for (const item of result.items) {
            const kw = item.keyword || item.keyword_info?.keyword;
            if (!kw) {
              console.warn(`⚠️  Skipping item without keyword:`, Object.keys(item));
              continue;
            }
            
            const normalizedKw = normalizeKeyword(kw);
            const searchVolume = item.keyword_info?.search_volume ?? null;
            const monthlySearches = item.keyword_info?.monthly_searches || undefined;

            volumeByKeyword[normalizedKw] = {
              search_volume: searchVolume,
              monthly_searches: monthlySearches,
            };
            
            console.log(`   ✓ "${kw}" → volume: ${searchVolume ?? 'null'}`);
          }
          
          console.log(`\n✅ Successfully processed ${Object.keys(volumeByKeyword).length} keywords`);
          console.log(`\n📊 Volume Map:`);
          console.log(JSON.stringify(volumeByKeyword, null, 2));
        } else {
          console.warn('⚠️  No items found in result');
        }
      } else {
        console.warn('⚠️  No result found in task');
      }
    } else {
      console.warn('⚠️  No tasks found in response');
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
  }
}

testKeywordOverview();

