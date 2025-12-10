/**
 * Test the deployed API endpoint with all 5 tracked keywords
 * Run with: node test-all-keywords.js
 */

const keywords = [
  "beginners photography classes",
  "photography lessons online",
  "camera courses for beginners",
  "alan ranger",
  "beginners photography course"
];

async function testAllKeywords() {
  const baseUrl = 'https://ai-geo-audit.vercel.app';
  const endpoint = `${baseUrl}/api/aigeo/serp-rank-test`;
  const queryParam = encodeURIComponent(keywords.join(','));
  const url = `${endpoint}?keywords=${queryParam}`;
  
  console.log(`\n🧪 Testing All 5 Keywords`);
  console.log(`   URL: ${url}\n`);
  console.log(`   Keywords being tested:`);
  keywords.forEach((kw, idx) => {
    console.log(`     ${idx + 1}. "${kw}"`);
  });
  console.log('');
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    console.log(`📊 Response Status: ${response.status}\n`);
    
    if (!response.ok) {
      console.error('❌ API Error:');
      console.error(JSON.stringify(data, null, 2));
      return;
    }
    
    const perKeyword = data.per_keyword || [];
    console.log(`📋 Found ${perKeyword.length} keywords in response\n`);
    
    console.log('📊 Search Volume Results:\n');
    const results = [];
    
    perKeyword.forEach((item) => {
      const keyword = item.keyword || 'Unknown';
      const volume = item.search_volume;
      const hasVolume = volume !== null && volume !== undefined;
      
      results.push({
        keyword,
        search_volume: volume,
        has_volume: hasVolume
      });
      
      const status = hasVolume ? '✅' : '❌';
      console.log(`${status} "${keyword}"`);
      console.log(`   Search Volume: ${hasVolume ? volume : 'null/undefined'}`);
      console.log('');
    });
    
    const withVolume = results.filter(r => r.has_volume).length;
    const withoutVolume = results.filter(r => !r.has_volume).length;
    
    console.log(`\n📈 Summary:`);
    console.log(`   Keywords with volume: ${withVolume}/${results.length}`);
    console.log(`   Keywords without volume: ${withoutVolume}/${results.length}`);
    
    const missing = results.filter(r => !r.has_volume);
    if (missing.length > 0) {
      console.log(`\n❌ Missing search volume for:`);
      missing.forEach(r => {
        console.log(`   - "${r.keyword}"`);
      });
    }
    
    console.log(`\n📋 Full JSON Response:\n`);
    console.log(JSON.stringify(data, null, 2));
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
  }
}

testAllKeywords();

