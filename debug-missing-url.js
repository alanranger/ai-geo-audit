#!/usr/bin/env node

/**
 * Debug a specific URL to see why types are missing
 */

import { safeJsonParse } from './api/aigeo/utils.js';

const url = 'https://www.alanranger.com/blog-on-photography/what-is-aperture-in-photography';

async function debugUrl() {
  console.log(`Debugging: ${url}\n`);
  
  const response = await fetch(url);
  const html = await response.text();
  
  // Check ALL script tags
  const allScripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
  console.log(`Total script tags: ${allScripts.length}\n`);
  
  // Check for BlogPosting, BreadcrumbList, HowTo in ANY script tag
  const typesToFind = ['BlogPosting', 'BreadcrumbList', 'HowTo'];
  
  typesToFind.forEach(type => {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Searching for: ${type}`);
    console.log('='.repeat(80));
    
    const scriptsWithType = allScripts.filter(s => new RegExp(type, 'i').test(s));
    console.log(`Found in ${scriptsWithType.length} script tag(s)\n`);
    
    scriptsWithType.forEach((script, idx) => {
      const hasTypeAttr = /type\s*=\s*["']application\/ld\+json["']/i.test(script);
      const content = script.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
      
      console.log(`Script ${idx + 1}:`);
      console.log(`  Has type="application/ld+json": ${hasTypeAttr ? 'YES' : 'NO'}`);
      console.log(`  Content length: ${content.length}`);
      console.log(`  Starts with { or [: ${/^[\s\n]*[{\[]/.test(content) ? 'YES' : 'NO'}`);
      console.log(`  Contains @type: ${/"@type"/i.test(content) ? 'YES' : 'NO'}`);
      
      if (hasTypeAttr || /^[\s\n]*[{\[]/.test(content)) {
        console.log(`  Content sample (first 500 chars):`);
        console.log(`  ${content.substring(0, 500)}`);
        
        // Try to parse
        const parsed = safeJsonParse(content);
        if (parsed) {
          console.log(`  ✓ Parsed successfully`);
          console.log(`  @type: ${parsed['@type'] || 'missing'}`);
          if (parsed['@graph']) {
            console.log(`  Has @graph: YES (${parsed['@graph'].length} items)`);
            parsed['@graph'].forEach((item, i) => {
              console.log(`    Graph item ${i + 1}: @type=${item['@type'] || 'missing'}`);
            });
          }
        } else {
          console.log(`  ✗ Parse FAILED`);
          // Try to extract @type
          const typeMatch = content.match(/"@type"\s*:\s*"([^"]+)"/i);
          if (typeMatch) {
            console.log(`  Extracted @type: ${typeMatch[1]}`);
          }
        }
      } else {
        console.log(`  Looks like regular JavaScript (not JSON-LD)`);
      }
      console.log('');
    });
  });
  
  // Extract slug and try to fetch schema files directly
  const slugMatch = url.match(/\/blog-on-photography\/([^\/]+)/);
  if (slugMatch) {
    const slug = slugMatch[1];
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Trying to fetch schema files directly (slug: ${slug}):`);
    console.log('='.repeat(80));
    
    const schemaFiles = [
      `https://schema.alanranger.com/${slug}_schema.json`,
      `https://schema.alanranger.com/${slug}_blogposting.json`,
      `https://schema.alanranger.com/${slug}_breadcrumb.json`,
      `https://schema.alanranger.com/${slug}_howto.json`
    ];
    
    for (const schemaUrl of schemaFiles) {
      try {
        const schemaResponse = await fetch(schemaUrl);
        if (schemaResponse.ok) {
          const schemaData = await schemaResponse.json();
          console.log(`\n✅ Found: ${schemaUrl}`);
          console.log(`  @type: ${schemaData['@type'] || 'missing'}`);
          if (Array.isArray(schemaData)) {
            schemaData.forEach((item, i) => {
              console.log(`  Item ${i + 1}: @type=${item['@type'] || 'missing'}`);
            });
          }
        }
      } catch (e) {
        // File doesn't exist, skip
      }
    }
  }
  
  // Also check for microdata
  console.log(`\n${'='.repeat(80)}`);
  console.log('Checking for Microdata:');
  console.log('='.repeat(80));
  const hasMicrodata = /itemscope/i.test(html);
  console.log(`Has microdata (itemscope): ${hasMicrodata ? 'YES' : 'NO'}`);
  if (hasMicrodata) {
    const breadcrumbMicrodata = /itemtype=["']https?:\/\/schema\.org\/BreadcrumbList["']/i.test(html);
    console.log(`BreadcrumbList microdata: ${breadcrumbMicrodata ? 'YES' : 'NO'}`);
  }
}

debugUrl().catch(console.error);

