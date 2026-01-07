/**
 * Diagnostic Script: Test URL Task AI Matching
 * 
 * This script queries Supabase to verify:
 * 1. Data exists for "photography courses" keyword
 * 2. The best_url format for that keyword
 * 3. Whether it contains "photography-courses-coventry"
 * 4. The AI overview and citations data
 * 
 * Run with: node test-url-task-ai-matching.js
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://igzvwbvgvmzvvzoclufx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

async function querySupabase() {
  console.log('========================================');
  console.log('URL Task AI Matching Diagnostic Test');
  console.log('========================================\n');

  try {
    // Query for "photography courses" (exact match) to see what UI shows
    console.log('=== Query 1: Exact keyword "photography courses" ===\n');
    const exactQueryUrl = `${SUPABASE_URL}/rest/v1/keyword_rankings?` +
      `keyword=eq.photography courses&` +
      `property_url=eq.https://www.alanranger.com&` +
      `order=audit_date.desc&` +
      `limit=1`;
    
    const exactResponse = await fetch(exactQueryUrl, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (exactResponse.ok) {
      const exactData = await exactResponse.json();
      if (exactData.length > 0) {
        const row = exactData[0];
        console.log('✅ Found "photography courses" (what UI shows):');
        console.log(`  Keyword: "${row.keyword}"`);
        console.log(`  best_url: ${row.best_url}`);
        console.log(`  has_ai_overview: ${row.has_ai_overview}`);
        console.log(`  ai_alan_citations_count: ${row.ai_alan_citations_count}`);
        console.log(`  ai_alan_citations (array): ${Array.isArray(row.ai_alan_citations) ? row.ai_alan_citations.length : 'N/A'} items`);
        console.log(`  audit_date: ${row.audit_date}`);
        console.log('');
      } else {
        console.log('⚠️  No exact match for "photography courses"\n');
      }
    }
    
    // Query for keywords containing "photography" and "course"
    console.log('=== Query 2: Keywords with photography-courses-coventry URL ===\n');
    const queryUrl = `${SUPABASE_URL}/rest/v1/keyword_rankings?` +
      `keyword=ilike.*photography*course*&` +
      `best_url=ilike.*photography-courses-coventry*&` +
      `order=audit_date.desc&` +
      `limit=10`;

    console.log('Query URL:', queryUrl.replace(SUPABASE_KEY || 'KEY', 'KEY_HIDDEN'));
    console.log('\nFetching data from Supabase...\n');

    const response = await fetch(queryUrl, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Query failed:', response.status, response.statusText);
      console.error('Error details:', errorText);
      return;
    }

    const data = await response.json();
    
    console.log(`✅ Found ${data.length} matching rows\n`);
    
    if (data.length === 0) {
      console.log('⚠️  No data found. Trying broader search...\n');
      
      // Try broader search
      const broadQueryUrl = `${SUPABASE_URL}/rest/v1/keyword_rankings?` +
        `keyword=ilike.*photography*course*&` +
        `order=audit_date.desc&` +
        `limit=20`;
      
      const broadResponse = await fetch(broadQueryUrl, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (broadResponse.ok) {
        const broadData = await broadResponse.json();
        console.log(`Found ${broadData.length} rows with "photography" and "course" in keyword:\n`);
        broadData.forEach((row, idx) => {
          console.log(`${idx + 1}. Keyword: "${row.keyword}"`);
          console.log(`   best_url: ${row.best_url || 'N/A'}`);
          console.log(`   has_ai_overview: ${row.has_ai_overview || false}`);
          console.log(`   ai_alan_citations_count: ${row.ai_alan_citations_count || 0}`);
          console.log(`   Contains "photography-courses-coventry": ${(row.best_url || '').includes('photography-courses-coventry') ? 'YES ✅' : 'NO ❌'}`);
          console.log('');
        });
      }
      return;
    }

    // Display results
    data.forEach((row, idx) => {
      console.log(`Row ${idx + 1}:`);
      console.log(`  Keyword: "${row.keyword}"`);
      console.log(`  best_url: ${row.best_url}`);
      console.log(`  Normalized (no protocol/www/query): ${normalizeUrl(row.best_url)}`);
      console.log(`  has_ai_overview: ${row.has_ai_overview}`);
      console.log(`  ai_alan_citations_count: ${row.ai_alan_citations_count}`);
      console.log(`  audit_date: ${row.audit_date}`);
      console.log(`  property_url: ${row.property_url}`);
      console.log('');
    });

    // Test URL normalization
    const testUrls = [
      'www.alanranger.com/photography-courses-coventry',
      'https://www.alanranger.com/photography-courses-coventry',
      'https://www.alanranger.com/photography-courses-coventry?srsltid=test'
    ];

    console.log('URL Normalization Test:');
    testUrls.forEach(url => {
      console.log(`  "${url}" → "${normalizeUrl(url)}"`);
    });
    console.log('');

    // Check if any row's normalized URL matches test URL
    const testUrlNormalized = normalizeUrl('www.alanranger.com/photography-courses-coventry');
    console.log(`Target normalized URL: "${testUrlNormalized}"\n`);
    
    const matches = data.filter(row => {
      const rowNormalized = normalizeUrl(row.best_url || '');
      return rowNormalized === testUrlNormalized || 
             rowNormalized.includes('photography-courses-coventry') ||
             testUrlNormalized.includes(rowNormalized.split('/').pop() || '');
    });

    console.log(`✅ Found ${matches.length} rows that should match:\n`);
    matches.forEach((row, idx) => {
      console.log(`Match ${idx + 1}:`);
      console.log(`  Keyword: "${row.keyword}"`);
      console.log(`  best_url: ${row.best_url}`);
      console.log(`  Normalized: "${normalizeUrl(row.best_url)}"`);
      console.log(`  has_ai_overview: ${row.has_ai_overview} ${row.has_ai_overview ? '✅' : '❌'}`);
      console.log(`  ai_alan_citations_count: ${row.ai_alan_citations_count || 0}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

function normalizeUrl(url) {
  if (!url) return '';
  let normalized = String(url).toLowerCase().trim();
  normalized = normalized.replace(/^https?:\/\//, '');
  normalized = normalized.replace(/^www\./, '');
  normalized = normalized.split('?')[0].split('#')[0];
  normalized = normalized.replace(/\/$/, '');
  return normalized;
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || 
                     import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/')) ||
                     process.argv[1]?.includes('test-url-task-ai-matching.js');

if (isMainModule) {
  if (!SUPABASE_KEY) {
    console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY environment variable required');
    console.error('   Set it with: export SUPABASE_SERVICE_ROLE_KEY=your_key');
    process.exit(1);
  }
  querySupabase().catch(err => {
    console.error('❌ Unhandled error:', err);
    process.exit(1);
  });
}

export { querySupabase, normalizeUrl };
