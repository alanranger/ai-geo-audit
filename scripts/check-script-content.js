#!/usr/bin/env node

const url = 'https://www.alanranger.com/blog-on-photography/what-is-aperture-in-photography';

async function check() {
  const response = await fetch(url);
  const html = await response.text();
  
  // Check ALL script tags
  const allScriptsRegex = /<script[^>]*>(.*?)<\/script>/gis;
  const allMatches = [...html.matchAll(allScriptsRegex)];
  
  console.log(`Found ${allMatches.length} total script tags\n`);
  
  // Find dynamic loaders
  const dynamicLoaders = [];
  
  allMatches.forEach((match, idx) => {
    const fullTag = match[0];
    const content = match[1].trim();
    const hasTypeJsonLd = /type\s*=\s*["']application\/ld\+json["']/i.test(fullTag);
    const hasSchemaDomain = /schema\.alanranger\.com/i.test(content);
    const isJavaScript = /function|var |const |let |window\.|document\./i.test(content);
    
    if (hasSchemaDomain && (hasTypeJsonLd || isJavaScript)) {
      dynamicLoaders.push({ idx, fullTag, content, hasTypeJsonLd, isJavaScript });
    }
  });
  
  console.log(`Found ${dynamicLoaders.length} potential dynamic schema loaders:\n`);
  
  dynamicLoaders.forEach((loader, i) => {
    console.log(`Loader ${i + 1}:`);
    console.log(`  Has type="application/ld+json": ${loader.hasTypeJsonLd}`);
    console.log(`  Is JavaScript: ${loader.isJavaScript}`);
    console.log(`  Content length: ${loader.content.length}`);
    console.log(`  First 500 chars: ${loader.content.substring(0, 500)}`);
    console.log('');
  });
  
  // Extract slug and try fetching
  const slugMatch = url.match(/\/blog-on-photography\/([^\/]+)/);
  if (slugMatch) {
    const slug = slugMatch[1];
    console.log(`\nTrying to fetch schemas for slug: ${slug}\n`);
    
    const schemaFiles = [
      `${slug}_schema.json`,
      `${slug}_blogposting.json`,
      `${slug}_breadcrumb.json`,
      `${slug}_howto.json`,
      `${slug}_faq.json`
    ];
    
    for (const fileName of schemaFiles) {
      try {
        const schemaUrl = `https://schema.alanranger.com/${fileName}`;
        const schemaResponse = await fetch(schemaUrl);
        if (schemaResponse.ok) {
          const schemaData = await schemaResponse.json();
          console.log(`✅ ${fileName}: @type=${schemaData['@type'] || 'array'}`);
        } else {
          console.log(`❌ ${fileName}: ${schemaResponse.status}`);
        }
      } catch (e) {
        console.log(`❌ ${fileName}: ${e.message}`);
      }
    }
  }
}

check().catch(console.error);

