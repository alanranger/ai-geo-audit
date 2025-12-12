#!/usr/bin/env node

/**
 * Test ALL URLs and compare to baseline
 * Keep fixing until results match expected counts
 */

import fs from 'fs';
import { safeJsonParse } from './api/aigeo/utils.js';

// Expected baseline counts from Schema Tools
const BASELINE = {
  BreadcrumbList: 220,
  BlogPosting: 220,
  HowTo: 219,
  WebPage: 220,
  FAQPage: 142,
  Article: 220 // Should match BlogPosting
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
      // Check FIRST if this is JavaScript code that loads schemas dynamically
      const isDynamicLoader = /schema\.alanranger\.com/i.test(jsonText) && 
                              (/function/i.test(jsonText) || /\.json/i.test(jsonText) || /fetch\(/i.test(jsonText));
      
      if (isDynamicLoader && pageUrl) {
        // Extract slug and fetch schema files directly
        const slugMatch = pageUrl.match(/\/blog-on-photography\/([^\/]+)/) || 
                         pageUrl.match(/\/([^\/]+)\/?$/);
        
        if (slugMatch) {
          const slug = slugMatch[1];
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
              // File doesn't exist, skip
            }
          }
        }
        continue; // Skip parse error recovery for dynamic loaders
      }
      
      // Not a dynamic loader - try parse error recovery
      {
        parseErrors++;
        // Try to recover @type from failed parse
        const importantTypes = ['BreadcrumbList', 'HowTo', 'BlogPosting', 'FAQPage', 'WebPage', 'Article', 'ItemList', 'Product', 'Event'];
        let extractedType = null;
        
        const patterns = [
          /"@type"\s*:\s*"([^"]+)"/i,
          /["']@type["']\s*:\s*["']([^"']+)["']/i,
          /@type\s*:\s*["']([^"']+)["']/i,
          /"type"\s*:\s*"([^"]+)"/i
        ];
        
        for (const pattern of patterns) {
          const match = jsonText.match(pattern);
          if (match && match[1]) {
            extractedType = match[1].trim();
            if (importantTypes.includes(extractedType)) {
              break;
            }
          }
        }
        
        if (extractedType && importantTypes.includes(extractedType)) {
          jsonLdBlocks.push({
            '@type': extractedType,
            '@context': 'https://schema.org',
            _recovered: true
          });
          parseErrors--;
        } else {
          failedBlocks.push({ sample: jsonText.substring(0, 500), full: jsonText });
        }
      }
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
      types: Array.from(allTypes),
      hasBlogPosting: allTypes.has('BlogPosting'),
      hasBreadcrumbList: allTypes.has('BreadcrumbList'),
      hasHowTo: allTypes.has('HowTo'),
      hasWebPage: allTypes.has('WebPage'),
      hasFAQPage: allTypes.has('FAQPage'),
      hasArticle: allTypes.has('Article')
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
  console.log('📊 Testing ALL URLs against baseline...\n');
  
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
    
    console.log(`Processed ${processed}/${urls.length} URLs...`);
    
    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Calculate counts
  const counts = {
    BlogPosting: 0,
    BreadcrumbList: 0,
    HowTo: 0,
    WebPage: 0,
    FAQPage: 0,
    Article: 0
  };
  
  const missingBlogPosting = [];
  const missingBreadcrumbList = [];
  const missingHowTo = [];
  
  results.forEach(result => {
    if (result.error) return;
    
    if (result.hasBlogPosting) counts.BlogPosting++;
    else if (result.url.includes('/blog-on-photography/')) missingBlogPosting.push(result.url);
    
    if (result.hasBreadcrumbList) counts.BreadcrumbList++;
    else missingBreadcrumbList.push(result.url);
    
    if (result.hasHowTo) counts.HowTo++;
    else missingHowTo.push(result.url);
    
    if (result.hasWebPage) counts.WebPage++;
    if (result.hasFAQPage) counts.FAQPage++;
    if (result.hasArticle) counts.Article++;
  });
  
  // Compare to baseline
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 RESULTS vs BASELINE');
  console.log('='.repeat(80));
  
  Object.keys(BASELINE).forEach(type => {
    const expected = BASELINE[type];
    const detected = counts[type] || 0;
    const missing = expected - detected;
    const pct = expected > 0 ? Math.round((detected / expected) * 100) : 0;
    const status = missing === 0 ? '✅' : missing < expected * 0.1 ? '🟡' : '❌';
    
    console.log(`\n${type}:`);
    console.log(`  Expected: ${expected}`);
    console.log(`  Detected: ${detected} ${status}`);
    console.log(`  Missing: ${missing} (${100 - pct}%)`);
  });
  
  // Show sample missing URLs
  if (missingBlogPosting.length > 0) {
    console.log(`\n❌ Missing BlogPosting (sample of ${Math.min(5, missingBlogPosting.length)}):`);
    missingBlogPosting.slice(0, 5).forEach(url => console.log(`  - ${url}`));
  }
  
  if (missingBreadcrumbList.length > 0) {
    console.log(`\n❌ Missing BreadcrumbList (sample of ${Math.min(5, missingBreadcrumbList.length)}):`);
    missingBreadcrumbList.slice(0, 5).forEach(url => console.log(`  - ${url}`));
  }
  
  if (missingHowTo.length > 0) {
    console.log(`\n❌ Missing HowTo (sample of ${Math.min(5, missingHowTo.length)}):`);
    missingHowTo.slice(0, 5).forEach(url => console.log(`  - ${url}`));
  }
  
  // Save detailed results
  fs.writeFileSync('test-results.json', JSON.stringify({
    counts,
    baseline: BASELINE,
    missingBlogPosting: missingBlogPosting.slice(0, 20),
    missingBreadcrumbList: missingBreadcrumbList.slice(0, 20),
    missingHowTo: missingHowTo.slice(0, 20),
    allResults: results.slice(0, 50) // Sample
  }, null, 2));
  
  console.log(`\n✅ Detailed results saved to test-results.json`);
}

main().catch(console.error);

