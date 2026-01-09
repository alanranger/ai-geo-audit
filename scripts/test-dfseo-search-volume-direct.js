/**
 * Direct test of DataForSEO keywords_data/google_ads/search_volume/live endpoint
 * This will show us the actual response structure
 */

// You'll need to provide credentials
const DATAFORSEO_LOGIN = process.argv[2] || process.env.DATAFORSEO_LOGIN;
const DATAFORSEO_PASSWORD = process.argv[3] || process.env.DATAFORSEO_PASSWORD;

if (!DATAFORSEO_LOGIN || !DATAFORSEO_PASSWORD) {
  console.error('❌ Missing credentials');
  console.error('Usage: node test-dfseo-search-volume-direct.js <login> <password>');
  process.exit(1);
}

const keywords = ["alan ranger", "beginners photography classes"];

async function testDirect() {
  const endpoint = "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live";
  const auth = Buffer.from(`${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}`).toString("base64");
  
  const requestBody = [{
    keywords: keywords,
    location_code: 2826,
    sort_by: "relevance"
  }];
  
  console.log('\n🧪 Testing DataForSEO API Directly');
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Keywords: ${JSON.stringify(keywords)}`);
  console.log(`Request body: ${JSON.stringify(requestBody, null, 2)}\n`);
  
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();
    
    console.log(`\n📊 HTTP Status: ${response.status}`);
    console.log(`📊 Response Type: ${Array.isArray(data) ? 'Array' : typeof data}`);
    console.log(`\n📋 FULL RESPONSE STRUCTURE:\n`);
    console.log(JSON.stringify(data, null, 2));
    
    // Try to extract results
    console.log(`\n🔍 Parsing Results:\n`);
    
    let items = [];
    
    // Check if response is array
    if (Array.isArray(data)) {
      console.log(`✓ Response is an array with ${data.length} elements`);
      const first = data[0];
      console.log(`  First element keys: ${Object.keys(first).join(', ')}`);
      console.log(`  First element status_code: ${first.status_code}`);
      console.log(`  First element status_message: ${first.status_message}`);
      
      if (Array.isArray(first.result)) {
        items = first.result;
        console.log(`  ✓ Found result array with ${items.length} items`);
      } else {
        console.log(`  ✗ result is not an array: ${typeof first.result}`);
        if (first.result) {
          console.log(`    result keys: ${Object.keys(first.result).join(', ')}`);
        }
      }
    } else {
      console.log(`Response is object, keys: ${Object.keys(data).join(', ')}`);
      if (data.status_code) console.log(`  status_code: ${data.status_code}`);
      if (data.status_message) console.log(`  status_message: ${data.status_message}`);
      
      if (Array.isArray(data.result)) {
        items = data.result;
        console.log(`  ✓ Found result array with ${items.length} items`);
      } else if (data.tasks && Array.isArray(data.tasks)) {
        console.log(`  Found tasks array with ${data.tasks.length} tasks`);
        const task = data.tasks[0];
        if (task && Array.isArray(task.result)) {
          items = task.result;
          console.log(`  ✓ Found result in tasks[0].result with ${items.length} items`);
        }
      }
    }
    
    console.log(`\n📊 Extracted ${items.length} items\n`);
    
    if (items.length > 0) {
      console.log(`✅ First item structure:\n`);
      console.log(JSON.stringify(items[0], null, 2));
      
      console.log(`\n📊 All items:\n`);
      items.forEach((item, idx) => {
        const kw = item.keyword;
        const vol = item.search_volume;
        console.log(`  ${idx + 1}. "${kw}" → search_volume: ${vol ?? 'null'}`);
      });
    } else {
      console.log(`❌ No items extracted!`);
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
  }
}

testDirect();

