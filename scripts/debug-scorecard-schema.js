#!/usr/bin/env node

/**
 * Debug why scorecard shows X marks when schema is detected
 */

const testUrl = 'https://www.alanranger.com/free-online-photography-course';

// Simulate what the scorecard does
function checkSchemaCoverage(url, pagesArray) {
  console.log(`\nChecking schema coverage for: ${url}`);
  console.log(`Pages array length: ${pagesArray ? pagesArray.length : 0}`);
  
  if (!pagesArray || pagesArray.length === 0) {
    console.log('❌ No pages array');
    return null;
  }
  
  const normalizedUrl = url.toLowerCase().trim();
  console.log(`Normalized URL: ${normalizedUrl}`);
  
  const pageData = pagesArray.find(p => {
    const pUrl = (p.url || '').toLowerCase().trim();
    const exactMatch = pUrl === normalizedUrl;
    const includes1 = pUrl.includes(normalizedUrl);
    const includes2 = normalizedUrl.includes(pUrl);
    
    if (exactMatch || includes1 || includes2) {
      console.log(`  ✅ Match found: ${pUrl}`);
      return true;
    }
    return false;
  });
  
  if (pageData) {
    console.log(`\n✅ Page data found:`);
    console.log(`  URL: ${pageData.url}`);
    console.log(`  Schema types: ${JSON.stringify(pageData.schemaTypes)}`);
    
    if (pageData.schemaTypes) {
      const schemaTypes = Array.isArray(pageData.schemaTypes) ? pageData.schemaTypes : [];
      const typeStrings = schemaTypes.map(t => String(t).toLowerCase());
      console.log(`  Type strings: ${typeStrings.join(', ')}`);
      
      const schemaCoverage = {
        hasFAQ: typeStrings.some(t => t.includes('faq') || t === 'faqpage'),
        hasHowTo: typeStrings.some(t => t.includes('howto') || t === 'howto'),
        hasEvent: typeStrings.some(t => t.includes('event') && !t.includes('product')),
        hasProduct: typeStrings.some(t => t.includes('product')),
        hasBreadcrumb: typeStrings.some(t => t.includes('breadcrumb') || t === 'breadcrumblist'),
        hasImageObject: typeStrings.some(t => t.includes('image') || t === 'imageobject')
      };
      
      console.log(`\n📊 Schema Coverage:`);
      console.log(`  FAQ: ${schemaCoverage.hasFAQ ? '✅' : '❌'}`);
      console.log(`  HowTo: ${schemaCoverage.hasHowTo ? '✅' : '❌'}`);
      console.log(`  Event/Product: ${(schemaCoverage.hasEvent || schemaCoverage.hasProduct) ? '✅' : '❌'}`);
      console.log(`  Breadcrumb: ${schemaCoverage.hasBreadcrumb ? '✅' : '❌'}`);
      console.log(`  ImageObject: ${schemaCoverage.hasImageObject ? '✅' : '❌'}`);
      
      return schemaCoverage;
    } else {
      console.log('❌ No schemaTypes in pageData');
      return null;
    }
  } else {
    console.log(`\n❌ No page data found`);
    console.log(`\nSample URLs in pages array:`);
    pagesArray.slice(0, 5).forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.url}`);
    });
    return null;
  }
}

// Test with sample data structure
const samplePages = [
  {
    url: 'https://www.alanranger.com/free-online-photography-course',
    schemaTypes: ['BreadcrumbList', 'FAQPage', 'WebPage', 'Organization']
  },
  {
    url: 'https://www.alanranger.com/blog-on-photography/what-is-exposure-in-photography',
    schemaTypes: ['BlogPosting', 'Article', 'BreadcrumbList', 'HowTo', 'FAQPage']
  }
];

console.log('='.repeat(80));
console.log('Testing with sample data:');
console.log('='.repeat(80));

checkSchemaCoverage(testUrl, samplePages);

console.log('\n\n' + '='.repeat(80));
console.log('Testing URL variations:');
console.log('='.repeat(80));

const urlVariations = [
  'https://www.alanranger.com/free-online-photography-course',
  'https://www.alanranger.com/free-online-photography-course/',
  'https://www.alanranger.com/free-online-photography-course?srsltid=AfmBOop-Z3lh1nKUh952CurPSuDSkQcxfTG_Jd3_nVVe87w3g8_xbsHs',
  'free-online-photography-course'
];

urlVariations.forEach(url => {
  console.log(`\nTesting: ${url}`);
  const result = checkSchemaCoverage(url, samplePages);
  if (result) {
    console.log('✅ Match found');
  } else {
    console.log('❌ No match');
  }
});

