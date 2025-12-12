#!/usr/bin/env node

/**
 * Test ALL schema types against baseline
 * Comprehensive comparison of all detected types
 */

import fs from 'fs';
import { safeJsonParse } from './api/aigeo/utils.js';

// Expected baseline counts from Schema Tools (from SCHEMA_TYPE_COMPARISON.md)
const BASELINE = {
  BreadcrumbList: 220,
  BlogPosting: 220,
  HowTo: 219,
  WebPage: 220,
  FAQPage: 142,
  Article: 220,
  ImageObject: 220, // Note: shows 396 in Supabase because foundation pages too
  Event: 127,
  Question: 142, // Part of FAQPage
  Answer: 142, // Part of FAQPage
  Country: 73,
  Offer: 61,
  ListItem: 220, // Part of BreadcrumbList
  ItemList: 58,
  Product: 53,
  AdministrativeArea: 28,
  TextDigitalDocument: 27,
  AggregateOffer: 24,
  MediaObject: 24,
  Thing: 4,
  DownloadAction: 3,
  DigitalDocument: 3,
  Audience: 3,
  OfferShippingDetails: 2,
  CreativeWork: 2,
  MerchantReturnPolicy: 2,
  DefinedRegion: 2,
  MonetaryAmount: 1,
  Brand: 1,
  Rating: 1,
  Review: 1,
  AggregateRating: 1,
  HowToStep: 219, // Part of HowTo
  ServiceChannel: 1,
  EntryPoint: 1,
  VideoObject: 1,
  WatchAction: 1,
  Course: 1,
  HowToTool: 1
};

// Copy exact extraction logic from schema-audit.js (with dynamic schema fetching)
async function extractJsonLd(htmlString, pageUrl = null) {
  const jsonLdBlocks = [];
  
  // FIRST: Check ALL script tags for dynamic loaders (before parsing JSON-LD)
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
  try {
    const response = await fetch(url);
    const html = await response.text();
    
    const { jsonLdBlocks } = await extractJsonLd(html, url);
    
    const allTypes = new Set();
    jsonLdBlocks.forEach(block => {
      const types = normalizeSchemaTypes(block);
      types.forEach(t => allTypes.add(t));
    });
    
    return {
      url,
      types: Array.from(allTypes)
    };
  } catch (error) {
    return {
      url,
      error: error.message,
      types: []
    };
  }
}

async function main() {
  console.log('📊 Testing ALL URLs and comparing ALL schema types against baseline...\n');
  
  // Read URLs from CSV
  const csvPath = '../alan-shared-resources/csv/06-site-urls.csv';
  const csv = fs.readFileSync(csvPath, 'utf-8');
  const lines = csv.split('\n').slice(1); // Skip header
  
  const urls = lines
    .map(line => {
      const match = line.match(/^([^,]+),/);
      return match ? match[1] : null;
    })
    .filter(url => url && url.startsWith('http'));
  
  console.log(`Found ${urls.length} URLs to test\n`);
  
  const results = [];
  let processed = 0;
  
  // Test in batches to avoid rate limiting
  for (let i = 0; i < urls.length; i += 10) {
    const batch = urls.slice(i, i + 10);
    const batchResults = await Promise.all(
      batch.map(url => testUrl(url))
    );
    results.push(...batchResults);
    processed += batch.length;
    
    if (processed % 50 === 0) {
      console.log(`Processed ${processed}/${urls.length} URLs...`);
    }
    
    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Calculate counts for ALL schema types
  const allDetectedTypes = new Set();
  results.forEach(result => {
    if (result.error) return;
    result.types.forEach(type => allDetectedTypes.add(type));
  });
  
  const counts = {};
  allDetectedTypes.forEach(type => {
    counts[type] = results.filter(r => !r.error && r.types.includes(type)).length;
  });
  
  // Compare to baseline
  console.log(`\n${'='.repeat(100)}`);
  console.log('📊 COMPREHENSIVE SCHEMA TYPE COMPARISON');
  console.log('='.repeat(100));
  
  const comparison = [];
  
  // Check types in baseline
  Object.keys(BASELINE).forEach(type => {
    const expected = BASELINE[type];
    const detected = counts[type] || 0;
    const missing = expected - detected;
    const pct = expected > 0 ? Math.round((detected / expected) * 100) : 0;
    const status = missing === 0 ? '✅' : missing < expected * 0.1 ? '🟡' : '❌';
    
    comparison.push({
      type,
      expected,
      detected,
      missing,
      pct,
      status
    });
  });
  
  // Sort by missing count (descending)
  comparison.sort((a, b) => b.missing - a.missing);
  
  console.log(`\n${'Type'.padEnd(30)} ${'Expected'.padEnd(10)} ${'Detected'.padEnd(10)} ${'Missing'.padEnd(10)} ${'%'.padEnd(8)} Status`);
  console.log('-'.repeat(100));
  
  comparison.forEach(item => {
    const missingStr = item.missing > 0 ? `-${item.missing}` : item.missing < 0 ? `+${Math.abs(item.missing)}` : '0';
    console.log(`${item.type.padEnd(30)} ${String(item.expected).padEnd(10)} ${String(item.detected).padEnd(10)} ${missingStr.padEnd(10)} ${String(item.pct).padEnd(8)} ${item.status}`);
  });
  
  // Show types detected but not in baseline
  const unexpectedTypes = Array.from(allDetectedTypes).filter(type => !BASELINE[type]);
  if (unexpectedTypes.length > 0) {
    console.log(`\n\n📋 Types detected but NOT in baseline (${unexpectedTypes.length}):`);
    unexpectedTypes.forEach(type => {
      const count = counts[type] || 0;
      console.log(`  ${type}: ${count} pages`);
    });
  }
  
  // Summary statistics
  const critical = comparison.filter(c => c.status === '❌' && c.missing > 10);
  const minor = comparison.filter(c => c.status === '🟡');
  const perfect = comparison.filter(c => c.status === '✅');
  
  console.log(`\n\n📊 Summary:`);
  console.log(`  ✅ Perfect matches: ${perfect.length}`);
  console.log(`  🟡 Minor differences (<10%): ${minor.length}`);
  console.log(`  ❌ Critical issues (>10 missing): ${critical.length}`);
  
  // Save detailed results
  fs.writeFileSync('test-all-schema-types-results.json', JSON.stringify({
    counts,
    baseline: BASELINE,
    comparison,
    unexpectedTypes: unexpectedTypes.map(t => ({ type: t, count: counts[t] })),
    summary: {
      perfect: perfect.length,
      minor: minor.length,
      critical: critical.length
    }
  }, null, 2));
  
  console.log(`\n✅ Detailed results saved to test-all-schema-types-results.json`);
}

main().catch(console.error);

