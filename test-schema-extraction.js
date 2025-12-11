#!/usr/bin/env node

/**
 * Test Schema Extraction
 * 
 * Tests schema extraction on a few URLs from 06-site-urls.csv
 * Uses the same extraction logic as the API to debug issues locally
 */

import fs from 'fs';
import { safeJsonParse } from './api/aigeo/utils.js';

// Copy the exact extraction logic from schema-audit.js
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
      failedBlocks.push({
        sample: jsonText.substring(0, 500),
        full: jsonText
      });
    }
  }
  
  return { jsonLdBlocks, parseErrors, failedBlocks };
}

// Copy the exact normalizeSchemaTypes logic from schema-audit.js
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

  // STEP 1: Use Schema Tools proven logic
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

  // STEP 2: Walk nested structures
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
    
    const { jsonLdBlocks, parseErrors, failedBlocks } = extractJsonLd(html);
    
    console.log(`\n📋 Extracted ${jsonLdBlocks.length} schema block(s)`);
    if (parseErrors > 0) {
      console.log(`⚠️ ${parseErrors} block(s) failed to parse`);
    }
    
    // Check for BlogPosting ONLY in JSON-LD script tags (not regular JS)
    const jsonLdScriptRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi;
    const jsonLdScripts = html.match(jsonLdScriptRegex) || [];
    
    let blogPostingInJsonLd = false;
    let blogPostingScripts = [];
    
    jsonLdScripts.forEach((script, idx) => {
      if (/BlogPosting/i.test(script)) {
        blogPostingInJsonLd = true;
        blogPostingScripts.push({ idx, script });
      }
    });
    
    if (blogPostingScripts.length > 0) {
      console.log(`\n🔍 BlogPosting found in ${blogPostingScripts.length} JSON-LD script tag(s):`);
      blogPostingScripts.forEach(({ idx, script }) => {
        const content = script.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
        const typeMatch = content.match(/"@type"\s*:\s*"([^"]+)"/i);
        console.log(`  Script ${idx + 1}: @type=${typeMatch ? typeMatch[1] : 'NOT FOUND'}`);
        console.log(`  Content sample: ${content.substring(0, 400)}`);
        
        // Try to parse it
        const parsed = safeJsonParse(content);
        if (parsed) {
          console.log(`  ✓ Parsed successfully`);
          const types = normalizeSchemaTypes(parsed);
          console.log(`  Types found: ${types.join(', ')}`);
        } else {
          console.log(`  ✗ Parse FAILED`);
          console.log(`  Error sample: ${content.substring(0, 500)}`);
        }
      });
    }
    
    const breadcrumbInHtml = /"@type"\s*:\s*"BreadcrumbList"/i.test(html);
    const howToInHtml = /"@type"\s*:\s*"HowTo"/i.test(html);
    
    console.log(`\n🔍 HTML Check (JSON-LD script tags only):`);
    console.log(`  BlogPosting in JSON-LD: ${blogPostingInJsonLd ? 'YES' : 'NO'}`);
    console.log(`  BreadcrumbList mentioned: ${breadcrumbInHtml ? 'YES' : 'NO'}`);
    console.log(`  HowTo mentioned: ${howToInHtml ? 'YES' : 'NO'}`);
    
    // Extract types from each block
    const allTypes = new Set();
    jsonLdBlocks.forEach((block, idx) => {
      const types = normalizeSchemaTypes(block);
      types.forEach(t => allTypes.add(t));
      
      const hasBlogPosting = types.includes('BlogPosting');
      const hasBreadcrumb = types.includes('BreadcrumbList');
      const hasHowTo = types.includes('HowTo');
      
      if (hasBlogPosting || hasBreadcrumb || hasHowTo) {
        console.log(`\n✅ Block ${idx + 1}:`);
        if (hasBlogPosting) console.log(`   ✓ BlogPosting detected`);
        if (hasBreadcrumb) console.log(`   ✓ BreadcrumbList detected`);
        if (hasHowTo) console.log(`   ✓ HowTo detected`);
        console.log(`   All types: ${types.join(', ')}`);
        console.log(`   @type: ${block['@type'] || 'missing'}`);
        console.log(`   Sample: ${JSON.stringify(block).substring(0, 200)}`);
      }
    });
    
    console.log(`\n📊 Summary:`);
    console.log(`  Total types detected: ${allTypes.size}`);
    console.log(`  BlogPosting detected: ${allTypes.has('BlogPosting') ? 'YES' : 'NO'}`);
    console.log(`  BreadcrumbList detected: ${allTypes.has('BreadcrumbList') ? 'YES' : 'NO'}`);
    console.log(`  HowTo detected: ${allTypes.has('HowTo') ? 'YES' : 'NO'}`);
    
    // Check for missing types
    if (blogPostingInJsonLd && !allTypes.has('BlogPosting')) {
      console.log(`\n❌ ISSUE: BlogPosting in JSON-LD script tag but NOT detected!`);
      if (failedBlocks.length > 0) {
        console.log(`\n  Failed parse blocks (${failedBlocks.length}):`);
        failedBlocks.forEach((block, idx) => {
          const hasBlogPosting = /BlogPosting/i.test(block.sample);
          if (hasBlogPosting) {
            console.log(`\n  Block ${idx + 1} (contains BlogPosting):`);
            console.log(`  Sample: ${block.sample}`);
            // Try to extract @type
            const typeMatch = block.full.match(/"@type"\s*:\s*"([^"]+)"/i);
            if (typeMatch) {
              console.log(`  Extracted @type: ${typeMatch[1]}`);
            }
          }
        });
      }
    }
    
    if (breadcrumbInHtml && !allTypes.has('BreadcrumbList')) {
      console.log(`\n❌ ISSUE: BreadcrumbList mentioned in HTML but NOT detected!`);
    }
    
    if (howToInHtml && !allTypes.has('HowTo')) {
      console.log(`\n❌ ISSUE: HowTo mentioned in HTML but NOT detected!`);
    }
    
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
  }
}

async function main() {
  // Read URLs from CSV
  const csvPath = '../alan-shared-resources/csv/06-site-urls.csv';
  const csv = fs.readFileSync(csvPath, 'utf-8');
  const lines = csv.split('\n').slice(1); // Skip header
  
  // Test URLs - one that works, ones that don't
  const testUrls = [
    'https://www.alanranger.com/blog-on-photography/what-is-exposure-in-photography', // This one works
    'https://www.alanranger.com/blog-on-photography/what-is-shutter-speed', // This one works
    'https://www.alanranger.com/blog-on-photography/what-is-aperture-in-photography', // This one doesn't
  ];
  
  for (const url of testUrls) {
    await testUrl(url);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit
  }
}

main().catch(console.error);

