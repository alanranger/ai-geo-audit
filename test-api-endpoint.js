#!/usr/bin/env node

/**
 * Test the actual API endpoint
 */

const testUrls = [
  'https://www.alanranger.com/blog-on-photography/what-is-aperture-in-photography',
  'https://www.alanranger.com/blog-on-photography/what-is-iso-in-photography',
  'https://www.alanranger.com/blog-on-photography/what-is-exposure-in-photography'
];

async function testApi() {
  for (const url of testUrls) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Testing API with: ${url}`);
    console.log('='.repeat(80));
    
    try {
      const response = await fetch('http://localhost:3000/api/schema-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [url] })
      });
      
      const result = await response.json();
      
      if (result.pages && result.pages.length > 0) {
        const page = result.pages[0];
        const types = page.schemaTypes || [];
        
        console.log(`\n📊 Results:`);
        console.log(`  URL: ${page.url}`);
        console.log(`  Schema types detected: ${types.length}`);
        console.log(`  Types: ${types.join(', ')}`);
        console.log(`  BlogPosting detected: ${types.includes('BlogPosting') ? 'YES ✅' : 'NO ❌'}`);
        console.log(`  BreadcrumbList detected: ${types.includes('BreadcrumbList') ? 'YES ✅' : 'NO ❌'}`);
        console.log(`  HowTo detected: ${types.includes('HowTo') ? 'YES ✅' : 'NO ❌'}`);
      } else {
        console.log(`❌ No results returned`);
        console.log(`Response:`, JSON.stringify(result, null, 2));
      }
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

testApi().catch(console.error);
