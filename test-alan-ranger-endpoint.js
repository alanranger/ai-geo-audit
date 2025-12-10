/**
 * Test the deployed API endpoint for "alan ranger" search volume
 * Run with: node test-alan-ranger-endpoint.js
 */

const keyword = "alan ranger";

async function testEndpoint() {
  const baseUrl = 'https://ai-geo-audit.vercel.app';
  const endpoint = `${baseUrl}/api/aigeo/serp-rank-test`;
  const url = `${endpoint}?keywords=${encodeURIComponent(keyword)}`;
  
  console.log(`\n🧪 Testing Deployed API Endpoint`);
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
    
    console.log('📊 Full Response JSON:\n');
    console.log(JSON.stringify(data, null, 2));
    
    console.log('\n\n📊 Keyword Result Details:\n');
    perKeyword.forEach((item, index) => {
      const keyword = item.keyword || 'Unknown';
      const volume = item.search_volume;
      const rank = item.best_rank_group;
      
      console.log(`   ${index + 1}. Keyword: "${keyword}"`);
      console.log(`      Search Volume: ${volume !== null && volume !== undefined ? volume : 'null/undefined'}`);
      console.log(`      Rank: ${rank ?? 'Not ranked'}`);
      console.log(`      Has AI Overview: ${item.has_ai_overview ? 'Yes' : 'No'}`);
      console.log(`      AI Citations: ${item.ai_alan_citations_count ?? 0}`);
      console.log('');
    });
    
    const alanRanger = perKeyword.find(item => 
      item.keyword && item.keyword.toLowerCase().includes('alan ranger')
    );
    
    if (alanRanger) {
      console.log(`\n✅ Found "alan ranger" in response:`);
      console.log(`   Search Volume: ${alanRanger.search_volume !== null && alanRanger.search_volume !== undefined ? alanRanger.search_volume : 'MISSING (null/undefined)'}`);
    } else {
      console.log(`\n❌ "alan ranger" NOT found in response`);
    }
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
  }
}

testEndpoint();

