#!/usr/bin/env node

import { safeJsonParse } from './api/aigeo/utils.js';

const url = 'https://www.alanranger.com/blog-on-photography/what-is-aperture-in-photography';

async function extractJsonLd(htmlString, pageUrl = null) {
  const jsonLdBlocks = [];
  
  // FIRST: Check ALL script tags for dynamic loaders (before parsing JSON-LD)
  const allScriptsRegex = /<script[^>]*>(.*?)<\/script>/gis;
  const allScripts = [...htmlString.matchAll(allScriptsRegex)];
  
  // Extract slug once
  let slug = null;
  if (pageUrl) {
    const slugMatch = pageUrl.match(/\/blog-on-photography\/([^\/]+)/) || 
                     pageUrl.match(/\/([^\/]+)\/?$/);
    if (slugMatch) slug = slugMatch[1];
  }
  
  // Check for dynamic loaders in ANY script tag
  if (slug) {
    for (const scriptMatch of allScripts) {
      const scriptContent = scriptMatch[1].trim();
      const hasSchemaDomain = /schema\.alanranger\.com/i.test(scriptContent);
      const isJavaScript = /function|var |const |let |window\.|document\.|fetch\(/i.test(scriptContent);
      
      if (hasSchemaDomain && isJavaScript) {
        console.log(`\n🔍 Found dynamic loader in script tag`);
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
              console.log(`  ✅ Fetched: ${fileName} (@type=${schemaData['@type'] || 'array'})`);
              if (Array.isArray(schemaData)) {
                jsonLdBlocks.push(...schemaData);
              } else {
                jsonLdBlocks.push(schemaData);
              }
            }
          } catch (e) {
            // Skip
          }
        }
        break; // Found loader, don't check other scripts
      }
    }
  }
  
  // THEN: Parse regular JSON-LD script tags
  const jsonLdRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
  const matches = [...htmlString.matchAll(jsonLdRegex)];
  
  for (const match of matches) {
    let jsonText = match[1].trim();
    jsonText = jsonText.replace(/<!--[\s\S]*?-->/g, '');
    
    // Check BEFORE parsing
    const isJavaScript = /function|var |const |let |window\.|document\.|fetch\(/i.test(jsonText);
    const hasSchemaDomain = /schema\.alanranger\.com/i.test(jsonText);
    const isDynamicLoader = hasSchemaDomain && (isJavaScript || /\.json/i.test(jsonText));
    
    console.log(`\n  Block ${matches.indexOf(match) + 1}:`);
    console.log(`    Is JavaScript: ${isJavaScript}`);
    console.log(`    Has schema.alanranger.com: ${hasSchemaDomain}`);
    console.log(`    Is dynamic loader: ${isDynamicLoader}`);
    console.log(`    Page URL: ${pageUrl || 'NOT PROVIDED'}`);
    
    if (isDynamicLoader && pageUrl) {
      console.log(`\n🔍 Found JavaScript loader - fetching schemas`);
      const slugMatch = pageUrl.match(/\/blog-on-photography\/([^\/]+)/) || 
                       pageUrl.match(/\/([^\/]+)\/?$/);
      
      if (slugMatch) {
        const slug = slugMatch[1];
        console.log(`  Extracted slug: ${slug}`);
        
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
              console.log(`    ✅ Fetched: ${fileName} (@type=${schemaData['@type'] || 'array'})`);
              if (Array.isArray(schemaData)) {
                jsonLdBlocks.push(...schemaData);
              } else {
                jsonLdBlocks.push(schemaData);
              }
            }
          } catch (e) {
            // Skip
          }
        }
      }
      continue; // Skip parsing this block
    }
    
    const parsed = safeJsonParse(jsonText);
    if (parsed) {
      if (Array.isArray(parsed)) {
        jsonLdBlocks.push(...parsed);
      } else {
        jsonLdBlocks.push(parsed);
      }
    } else {
      // Check if this is JavaScript code that loads schemas dynamically
      const hasSchemaDomain = /schema\.alanranger\.com/i.test(jsonText);
      const hasFunction = /function/i.test(jsonText);
      const hasJson = /\.json/i.test(jsonText);
      const isDynamicLoader = hasSchemaDomain && (hasFunction || hasJson);
      
      console.log(`\n  Block parse failed:`);
      console.log(`    Has schema.alanranger.com: ${hasSchemaDomain}`);
      console.log(`    Has function: ${hasFunction}`);
      console.log(`    Has .json: ${hasJson}`);
      console.log(`    Is dynamic loader: ${isDynamicLoader}`);
      console.log(`    Page URL provided: ${!!pageUrl}`);
      
      if (isDynamicLoader && pageUrl) {
        console.log(`\n🔍 Found dynamic schema loader for ${pageUrl}`);
        
        // Extract slug from URL
        const slugMatch = pageUrl.match(/\/blog-on-photography\/([^\/]+)/) || 
                         pageUrl.match(/\/([^\/]+)\/?$/);
        
        if (slugMatch) {
          const slug = slugMatch[1];
          console.log(`  Extracted slug: ${slug}`);
          
          const schemaFiles = [
            `${slug}_schema.json`,
            `${slug}_blogposting.json`,
            `${slug}_breadcrumb.json`,
            `${slug}_howto.json`,
            `${slug}_faq.json`
          ];
          
          console.log(`  Attempting to fetch ${schemaFiles.length} schema files...`);
          
          for (const fileName of schemaFiles) {
            try {
              const schemaUrl = `https://schema.alanranger.com/${fileName}`;
              console.log(`    Fetching: ${schemaUrl}`);
              const schemaResponse = await fetch(schemaUrl);
              if (schemaResponse.ok) {
                const schemaData = await schemaResponse.json();
                console.log(`    ✅ Found: @type=${schemaData['@type'] || 'array'}`);
                if (Array.isArray(schemaData)) {
                  jsonLdBlocks.push(...schemaData);
                  schemaData.forEach(item => {
                    console.log(`      Item: @type=${item['@type'] || 'missing'}`);
                  });
                } else {
                  jsonLdBlocks.push(schemaData);
                }
              } else {
                console.log(`    ❌ Not found (${schemaResponse.status})`);
              }
            } catch (e) {
              console.log(`    ❌ Error: ${e.message}`);
            }
          }
        } else {
          console.log(`  ❌ Could not extract slug from URL`);
        }
      }
    }
  }
  
  return { jsonLdBlocks };
}

async function test() {
  console.log(`Testing: ${url}\n`);
  
  const response = await fetch(url);
  const html = await response.text();
  
  const { jsonLdBlocks } = await extractJsonLd(html, url);
  
  console.log(`\n📊 Results:`);
  console.log(`  Total blocks: ${jsonLdBlocks.length}`);
  
  const allTypes = new Set();
  jsonLdBlocks.forEach(block => {
    const types = [];
    if (block['@type']) types.push(block['@type']);
    if (block['@graph']) {
      block['@graph'].forEach(item => {
        if (item['@type']) types.push(item['@type']);
      });
    }
    types.forEach(t => allTypes.add(t));
  });
  
  console.log(`  Types detected: ${Array.from(allTypes).join(', ')}`);
  console.log(`  BlogPosting: ${allTypes.has('BlogPosting') ? 'YES ✅' : 'NO ❌'}`);
  console.log(`  BreadcrumbList: ${allTypes.has('BreadcrumbList') ? 'YES ✅' : 'NO ❌'}`);
  console.log(`  HowTo: ${allTypes.has('HowTo') ? 'YES ✅' : 'NO ❌'}`);
}

test().catch(console.error);

