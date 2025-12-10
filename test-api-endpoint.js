/**
 * Test the deployed API endpoint to check if search volume is returned
 * Run with: node test-api-endpoint.js
 */

const keywords = [
  "photography lessons online",
  "photography courses",
  "camera settings"
];

async function testApiEndpoint() {
  const baseUrl = process.argv[2] || 'https://ai-geo-audit.vercel.app';
  const endpoint = `${baseUrl}/api/aigeo/serp-rank-test`;
  const queryParam = encodeURIComponent(keywords.join(','));
  const url = `${endpoint}?keywords=${queryParam}`;
  
  console.log(`\n🧪 Testing API Endpoint`);
  console.log(`   URL: ${url}\n`);
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    console.log(`📊 Response Status: ${response.status}`);
    console.log(`📊 Response Keys: ${Object.keys(data).join(', ')}\n`);
    
    if (!response.ok) {
      console.error('❌ API Error:');
      console.error(JSON.stringify(data, null, 2));
      return;
    }
    
    const perKeyword = data.per_keyword || [];
    console.log(`📋 Found ${perKeyword.length} keywords in response\n`);
    
    if (perKeyword.length === 0) {
      console.warn('⚠️  No keywords found in response');
      return;
    }
    
    console.log('📊 Keyword Results:\n');
    let hasVolume = 0;
    let noVolume = 0;
    
    perKeyword.forEach((item, index) => {
      const keyword = item.keyword || 'Unknown';
      const volume = item.search_volume;
      const rank = item.best_rank_group;
      
      if (volume !== null && volume !== undefined) {
        hasVolume++;
        console.log(`   ${index + 1}. "${keyword}"`);
        console.log(`      ✓ Search Volume: ${volume.toLocaleString()}`);
        console.log(`      ✓ Rank: ${rank ?? 'Not ranked'}`);
        console.log(`      ✓ Has AI Overview: ${item.has_ai_overview ? 'Yes' : 'No'}`);
        console.log(`      ✓ AI Citations: ${item.ai_alan_citations_count ?? 0}`);
        console.log('');
      } else {
        noVolume++;
        console.log(`   ${index + 1}. "${keyword}"`);
        console.log(`      ✗ Search Volume: null/undefined`);
        console.log(`      ✓ Rank: ${rank ?? 'Not ranked'}`);
        console.log(`      ✓ Has AI Overview: ${item.has_ai_overview ? 'Yes' : 'No'}`);
        console.log(`      ✓ AI Citations: ${item.ai_alan_citations_count ?? 0}`);
        console.log('');
      }
    });
    
    console.log(`\n📈 Summary:`);
    console.log(`   Keywords with volume: ${hasVolume}`);
    console.log(`   Keywords without volume: ${noVolume}`);
    console.log(`   Total keywords: ${perKeyword.length}`);
    
    if (hasVolume === 0) {
      console.log(`\n❌ No search volume data found! This indicates an issue with the API integration.`);
      console.log(`\n   Check Vercel function logs for errors in fetchKeywordOverview()`);
    } else {
      console.log(`\n✅ Search volume data is being returned successfully!`);
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
  }
}

testApiEndpoint();

