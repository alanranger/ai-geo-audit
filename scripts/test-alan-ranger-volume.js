/**
 * Test script to fetch search volume for "alan ranger" keyword
 * Run with: node test-alan-ranger-volume.js
 * 
 * Requires DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD environment variables
 */

// Accept credentials from command line args or environment variables
const DATAFORSEO_LOGIN = process.argv[2] || process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.argv[3] || process.env.DATAFORSEO_PASSWORD;

if (!DATAFORSEO_LOGIN || !DATAFORSEO_PASSWORD) {
  console.error('❌ Missing DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD');
  console.error('\nUsage:');
  console.error('  node test-alan-ranger-volume.js <login> <password>');
  console.error('\nOr set environment variables:');
  console.error('  export DATAFORSEO_LOGIN="your_login"');
  console.error('  export DATAFORSEO_PASSWORD="your_password"');
  console.error('  node test-alan-ranger-volume.js');
  process.exit(1);
}

function normalizeKeyword(keyword) {
  if (!keyword) return '';
  return String(keyword)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' '); // Collapse multiple spaces to single space
}

async function testAlanRangerVolume() {
  const endpoint = "https://api.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live";
  
  const keywords = ["alan ranger"];
  
  const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString("base64");
  
  console.log('\n🧪 Testing DataForSEO Keyword Overview API for "alan ranger"');
  console.log(`   Endpoint: ${endpoint}`);
  console.log(`   Keywords: ${JSON.stringify(keywords)}`);
  console.log(`   Location: UK (2826)`);
  console.log(`   Language: en\n`);
  
  const requestBody = {
    keywords: keywords,
    language_code: "en",
    location_code: 2826,
  };
  
  console.log('📤 Request Body:');
  console.log(JSON.stringify([requestBody], null, 2));
  console.log('');
  
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify([requestBody]),
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
          console.log('✅ Raw Response Items:\n');
          result.items.forEach((item, idx) => {
            console.log(`Item ${idx + 1}:`);
            console.log(JSON.stringify(item, null, 2));
            console.log('');
          });
          
          // Process items
          const volumeByKeyword = {};
          console.log('🔍 Processing Items:\n');
          
          for (const item of result.items) {
            const kw = item.keyword || item.keyword_info?.keyword || (typeof item.keyword_info === 'string' ? item.keyword_info : null);
            
            if (!kw) {
              console.warn(`⚠️  Skipping item without keyword:`, Object.keys(item));
              continue;
            }
            
            const normalizedKw = normalizeKeyword(kw);
            const searchVolume = item.keyword_info?.search_volume ?? item.search_volume ?? null;
            const monthlySearches = item.keyword_info?.monthly_searches || item.monthly_searches || undefined;

            console.log(`   Original keyword: "${kw}"`);
            console.log(`   Normalized keyword: "${normalizedKw}"`);
            console.log(`   Search volume: ${searchVolume ?? 'null'}`);
            console.log(`   Monthly searches: ${monthlySearches ? 'present' : 'missing'}`);
            console.log('');

            volumeByKeyword[normalizedKw] = {
              search_volume: searchVolume,
              monthly_searches: monthlySearches,
            };
          }
          
          console.log(`\n📊 Volume Map:`);
          console.log(JSON.stringify(volumeByKeyword, null, 2));
          
          // Test lookup
          console.log(`\n🔍 Testing Lookup:`);
          const testKeyword = "alan ranger";
          const normalizedTest = normalizeKeyword(testKeyword);
          console.log(`   Test keyword: "${testKeyword}"`);
          console.log(`   Normalized: "${normalizedTest}"`);
          const found = volumeByKeyword[normalizedTest];
          if (found) {
            console.log(`   ✅ FOUND: search_volume = ${found.search_volume ?? 'null'}`);
          } else {
            console.log(`   ❌ NOT FOUND in volume map`);
            console.log(`   Available keys: ${Object.keys(volumeByKeyword).map(k => `"${k}"`).join(', ')}`);
          }
        } else {
          console.warn('⚠️  No items found in result');
        }
      } else {
        console.warn('⚠️  No result found in task');
        console.log('Task object:', JSON.stringify(task, null, 2));
      }
    } else {
      console.warn('⚠️  No tasks found in response');
      console.log('Full response:', JSON.stringify(data, null, 2));
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
  }
}

testAlanRangerVolume();

