#!/usr/bin/env node

/**
 * Check why BreadcrumbList isn't being detected on specific pages
 */

import { safeJsonParse } from './api/aigeo/utils.js';

const testUrl = 'https://www.alanranger.com/photography-services-near-me/composition-settings-photography-field-checklists';

async function check() {
  console.log(`Checking: ${testUrl}\n`);
  
  const response = await fetch(testUrl);
  const html = await response.text();
  
  // Extract JSON-LD script tags
  const jsonLdRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
  const matches = [...html.matchAll(jsonLdRegex)];
  
  console.log(`Found ${matches.length} JSON-LD script tags\n`);
  
  matches.forEach((match, idx) => {
    const content = match[1].trim().replace(/<!--[\s\S]*?-->/g, '');
    const parsed = safeJsonParse(content);
    
    console.log(`Script ${idx + 1}:`);
    if (parsed) {
      console.log(`  Parsed: YES`);
      console.log(`  @type: ${parsed['@type'] || 'missing'}`);
      if (parsed['@graph']) {
        console.log(`  Has @graph: YES (${parsed['@graph'].length} items)`);
        parsed['@graph'].forEach((item, i) => {
          console.log(`    Graph item ${i + 1}: @type=${item['@type'] || 'missing'}`);
          if (item['@type'] === 'BreadcrumbList' || item.itemListElement) {
            console.log(`      *** BREADCRUMB FOUND IN GRAPH ITEM ${i + 1} ***`);
            console.log(`      Full item:`, JSON.stringify(item, null, 2).substring(0, 500));
          }
        });
      }
      if (parsed['@type'] === 'BreadcrumbList' || parsed.itemListElement) {
        console.log(`  *** BREADCRUMB FOUND IN ROOT ***`);
        console.log(`  Full object:`, JSON.stringify(parsed, null, 2).substring(0, 500));
      }
      // Check for BreadcrumbList anywhere in the structure
      const jsonStr = JSON.stringify(parsed);
      if (jsonStr.includes('BreadcrumbList')) {
        console.log(`  Contains "BreadcrumbList" string: YES`);
        // Try to find where
        const breadcrumbMatch = jsonStr.match(/"@type"\s*:\s*"BreadcrumbList"/);
        if (breadcrumbMatch) {
          console.log(`  Found "@type": "BreadcrumbList" in JSON`);
        }
      } else {
        console.log(`  Contains "BreadcrumbList" string: NO`);
      }
    } else {
      console.log(`  Parsed: NO`);
      console.log(`  Content sample: ${content.substring(0, 200)}`);
    }
    console.log('');
  });
  
  // Also check for BreadcrumbList in @graph structure
  console.log(`\nChecking @graph structure for BreadcrumbList...`);
  matches.forEach((match, idx) => {
    const content = match[1].trim().replace(/<!--[\s\S]*?-->/g, '');
    const parsed = safeJsonParse(content);
    if (parsed && parsed['@graph']) {
      parsed['@graph'].forEach((item, i) => {
        if (item['@type'] === 'BreadcrumbList') {
          console.log(`  ✅ Found BreadcrumbList in script ${idx + 1}, graph item ${i + 1}`);
        }
        // Also check nested structures
        if (item.itemListElement && Array.isArray(item.itemListElement)) {
          console.log(`  ✅ Found itemListElement array in script ${idx + 1}, graph item ${i + 1} (likely BreadcrumbList)`);
          console.log(`     @type: ${item['@type'] || 'missing'}`);
        }
      });
    }
  });
}

check().catch(console.error);

