#!/usr/bin/env node

/**
 * Debug specific URLs that should have schemas but don't
 */

import { safeJsonParse } from './api/aigeo/utils.js';

// URLs that should have BlogPosting/Article/HowTo/BreadcrumbList but don't
const testUrls = [
  'https://www.alanranger.com/blog-on-photography/what-is-aperture-in-photography',
  'https://www.alanranger.com/photography-services-near-me/composition-settings-photography-field-checklists',
  'https://www.alanranger.com/blog-on-photography',
  'https://www.alanranger.com/about-alan-ranger'
];

async function extractJsonLd(htmlString, pageUrl = null) {
  const jsonLdBlocks = [];
  
  let slug = null;
  if (pageUrl) {
    const slugMatch = pageUrl.match(/\/blog-on-photography\/([^\/]+)/) || 
                     pageUrl.match(/\/([^\/]+)\/?$/);
    if (slugMatch) slug = slugMatch[1];
  }
  
  if (slug) {
    const allScriptsRegex = /<script[^>]*>(.*?)<\/script>/gis;
    const allScripts = [...htmlString.matchAll(allScriptsRegex)];
    
    for (const scriptMatch of allScripts) {
      const scriptContent = scriptMatch[1].trim();
      const hasSchemaDomain = /schema\.alanranger\.com/i.test(scriptContent);
      const isJavaScript = /function|var |const |let |window\.|document\.|fetch\(/i.test(scriptContent);
      
      if (hasSchemaDomain && isJavaScript) {
        console.log(`  ✅ Found dynamic loader for slug: ${slug}`);
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
        break;
      }
    }
  }
  
  const jsonLdRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
  const matches = [...htmlString.matchAll(jsonLdRegex)];
  
  console.log(`  Found ${matches.length} JSON-LD script tags`);
  
  for (const match of matches) {
    let jsonText = match[1].trim();
    jsonText = jsonText.replace(/<!--[\s\S]*?-->/g, '');
    
    const parsed = safeJsonParse(jsonText);
    if (parsed) {
      if (Array.isArray(parsed)) {
        jsonLdBlocks.push(...parsed);
      } else {
        jsonLdBlocks.push(parsed);
      }
    }
  }
  
  return { jsonLdBlocks };
}

function normalizeSchemaTypes(schemaObject) {
  const collected = new Set();

  function addType(value) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(v => {
        if (typeof v === 'string' && v.trim()) {
          collected.add(v.trim());
        }
      });
    } else if (typeof value === 'string' && value.trim()) {
      collected.add(value.trim());
    }
  }

  if (Array.isArray(schemaObject)) {
    schemaObject.forEach(item => {
      if (item && item['@type']) {
        addType(item['@type']);
      }
    });
  } else if (schemaObject['@graph'] && Array.isArray(schemaObject['@graph'])) {
    schemaObject['@graph'].forEach(item => {
      if (item && item['@type']) {
        addType(item['@type']);
      }
    });
  } else if (schemaObject['@type']) {
    addType(schemaObject['@type']);
  }

  function walk(node, depth = 0) {
    if (!node || typeof node !== 'object') return;
    if (depth > 15) return;

    const nodeType = node['@type'];
    if (nodeType) {
      if (Array.isArray(nodeType)) {
        nodeType.forEach(t => addType(t));
      } else {
        addType(nodeType);
      }
    }

    if (Array.isArray(node['@graph'])) {
      node['@graph'].forEach(child => {
        if (child && child['@type']) {
          addType(child['@type']);
        }
        walk(child, depth + 1);
      });
    }

    const nestedKeys = ['author', 'creator', 'publisher', 'provider', 'performer', 'brand', 'mainEntityOfPage', 'itemListElement'];
    nestedKeys.forEach(key => {
      const value = node[key];
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          value.forEach(v => {
            if (v && v['@type']) addType(v['@type']);
            walk(v, depth + 1);
          });
        } else {
          if (value['@type']) addType(value['@type']);
          walk(value, depth + 1);
        }
      }
    });

    for (const key in node) {
      if (key === '@type' || key === '@graph' || nestedKeys.includes(key)) {
        continue;
      }
      const value = node[key];
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          value.forEach(item => {
            if (item && typeof item === 'object') {
              if (item['@type']) addType(item['@type']);
              walk(item, depth + 1);
            }
          });
        } else {
          if (value['@type']) addType(value['@type']);
          walk(value, depth + 1);
        }
      }
    }
  }

  walk(schemaObject);
  return Array.from(collected);
}

async function testUrl(url) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing: ${url}`);
  console.log('='.repeat(80));
  
  try {
    const response = await fetch(url);
    const html = await response.text();
    
    const { jsonLdBlocks } = await extractJsonLd(html, url);
    
    console.log(`\nTotal schema blocks: ${jsonLdBlocks.length}`);
    
    const allTypes = new Set();
    jsonLdBlocks.forEach((block, idx) => {
      const types = normalizeSchemaTypes(block);
      console.log(`  Block ${idx + 1}: ${types.join(', ')}`);
      types.forEach(t => allTypes.add(t));
    });
    
    console.log(`\n📊 All detected types (${allTypes.size}):`);
    console.log(`  ${Array.from(allTypes).join(', ')}`);
    
    console.log(`\n✅ Has BlogPosting: ${allTypes.has('BlogPosting') ? 'YES' : 'NO'}`);
    console.log(`✅ Has BreadcrumbList: ${allTypes.has('BreadcrumbList') ? 'YES' : 'NO'}`);
    console.log(`✅ Has HowTo: ${allTypes.has('HowTo') ? 'YES' : 'NO'}`);
    console.log(`✅ Has Article: ${allTypes.has('Article') ? 'YES' : 'NO'}`);
    console.log(`✅ Has WebPage: ${allTypes.has('WebPage') ? 'YES' : 'NO'}`);
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  }
}

async function main() {
  for (const url of testUrls) {
    await testUrl(url);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

main().catch(console.error);

