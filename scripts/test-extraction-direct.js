#!/usr/bin/env node

/**
 * Test extraction logic directly (simulating API)
 */

import { safeJsonParse } from './api/aigeo/utils.js';

// Copy exact extraction logic from schema-audit.js
function extractJsonLd(htmlString) {
  const jsonLdBlocks = [];
  const jsonLdRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
  const matches = [...htmlString.matchAll(jsonLdRegex)];
  
  let parseErrors = 0;
  const failedBlocks = [];
  
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
    } else {
      parseErrors++;
      failedBlocks.push({ sample: jsonText.substring(0, 500), full: jsonText });
    }
  }
  
  return { jsonLdBlocks, parseErrors, failedBlocks };
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

// Test the FIXED fallback logic (only checks JSON-LD script tags)
function testFallbackLogic(htmlString, jsonLdBlocks) {
  const importantTypes = ['BreadcrumbList', 'HowTo', 'BlogPosting', 'WebPage', 'FAQPage', 'Article', 'ItemList'];
  
  // Extract all JSON-LD script tags first (to avoid matching regular JavaScript)
  const jsonLdScriptRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi;
  const jsonLdScripts = htmlString.match(jsonLdScriptRegex) || [];
  const jsonLdHtml = jsonLdScripts.join('\n'); // Only search within JSON-LD script tags
  
  const results = {};
  
  importantTypes.forEach(typeName => {
    // Only check within JSON-LD script tags (not regular JavaScript)
    const typeInJsonLd = new RegExp(`"@type"\\s*:\\s*"${typeName}"`, 'i').test(jsonLdHtml) ||
                         new RegExp(`@type["\s]*:["\s]*["']${typeName}["']`, 'i').test(jsonLdHtml);
    
    if (typeInJsonLd) {
      const hasType = jsonLdBlocks.some(block => {
        if (!block) return false;
        const types = normalizeSchemaTypes(block);
        return types.includes(typeName);
      });
      
      results[typeName] = {
        inJsonLd: true,
        detected: hasType,
        shouldLog: !hasType // Only log if in JSON-LD but not detected
      };
    } else {
      results[typeName] = {
        inJsonLd: false,
        detected: false,
        shouldLog: false // Don't log if not in JSON-LD
      };
    }
  });
  
  return results;
}

async function testUrl(url) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing: ${url}`);
  console.log('='.repeat(80));
  
  try {
    const response = await fetch(url);
    const html = await response.text();
    
    const { jsonLdBlocks, parseErrors, failedBlocks } = extractJsonLd(html);
    
    // Get all detected types
    const allTypes = new Set();
    jsonLdBlocks.forEach(block => {
      const types = normalizeSchemaTypes(block);
      types.forEach(t => allTypes.add(t));
    });
    
    // Test the FIXED fallback logic
    const fallbackResults = testFallbackLogic(html, jsonLdBlocks);
    
    console.log(`\n📊 Extraction Results:`);
    console.log(`  Blocks extracted: ${jsonLdBlocks.length}`);
    console.log(`  Parse errors: ${parseErrors}`);
    console.log(`  Total types: ${allTypes.size}`);
    
    console.log(`\n🔍 Fallback Logic Test (FIXED - only checks JSON-LD):`);
    ['BlogPosting', 'BreadcrumbList', 'HowTo'].forEach(type => {
      const result = fallbackResults[type];
      console.log(`  ${type}:`);
      console.log(`    In JSON-LD script tags: ${result.inJsonLd ? 'YES' : 'NO'}`);
      console.log(`    Detected in blocks: ${result.detected ? 'YES ✅' : 'NO ❌'}`);
      console.log(`    Would log warning: ${result.shouldLog ? 'YES ⚠️' : 'NO ✓'}`);
    });
    
    console.log(`\n📋 Detected Types:`);
    console.log(`  BlogPosting: ${allTypes.has('BlogPosting') ? 'YES ✅' : 'NO ❌'}`);
    console.log(`  BreadcrumbList: ${allTypes.has('BreadcrumbList') ? 'YES ✅' : 'NO ❌'}`);
    console.log(`  HowTo: ${allTypes.has('HowTo') ? 'YES ✅' : 'NO ❌'}`);
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  }
}

async function main() {
  const testUrls = [
    'https://www.alanranger.com/blog-on-photography/what-is-aperture-in-photography', // Should NOT log false positive
    'https://www.alanranger.com/blog-on-photography/what-is-exposure-in-photography', // Has BlogPosting
  ];
  
  for (const url of testUrls) {
    await testUrl(url);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

main().catch(console.error);

