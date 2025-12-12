#!/usr/bin/env node

/**
 * Investigate which URLs are missing critical schema types
 */

import fs from 'fs';
import { safeJsonParse } from './api/aigeo/utils.js';

// Copy exact extraction logic from schema-audit.js
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
        break;
      }
    }
  }
  
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
      types: Array.from(allTypes),
      hasBlogPosting: allTypes.has('BlogPosting'),
      hasBreadcrumbList: allTypes.has('BreadcrumbList'),
      hasHowTo: allTypes.has('HowTo'),
      hasArticle: allTypes.has('Article'),
      hasWebPage: allTypes.has('WebPage')
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
  console.log('🔍 Investigating missing schema types...\n');
  
  // Read URLs from CSV
  const csvPath = '../alan-shared-resources/csv/06-site-urls.csv';
  const csv = fs.readFileSync(csvPath, 'utf-8');
  const lines = csv.split('\n').slice(1);
  
  const urls = lines
    .map(line => {
      const match = line.match(/^([^,]+),/);
      return match ? match[1] : null;
    })
    .filter(url => url && url.startsWith('http'));
  
  console.log(`Testing ${urls.length} URLs...\n`);
  
  const results = [];
  let processed = 0;
  
  // Test in batches
  for (let i = 0; i < urls.length; i += 10) {
    const batch = urls.slice(i, i + 10);
    const batchResults = await Promise.all(
      batch.map(url => testUrl(url))
    );
    results.push(...batchResults);
    processed += batch.length;
    
    if (processed % 50 === 0) {
      console.log(`Processed ${processed}/${urls.length}...`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Find missing types
  const missingBlogPosting = results.filter(r => !r.error && !r.hasBlogPosting && r.url.includes('/blog-on-photography/'));
  const missingBreadcrumbList = results.filter(r => !r.error && !r.hasBreadcrumbList);
  const missingHowTo = results.filter(r => !r.error && !r.hasHowTo && r.url.includes('/blog-on-photography/'));
  const missingArticle = results.filter(r => !r.error && !r.hasArticle && r.url.includes('/blog-on-photography/'));
  
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 MISSING SCHEMA TYPES ANALYSIS');
  console.log('='.repeat(80));
  
  console.log(`\n❌ Missing BlogPosting (${missingBlogPosting.length} blog pages):`);
  missingBlogPosting.slice(0, 20).forEach(r => {
    console.log(`  - ${r.url}`);
  });
  if (missingBlogPosting.length > 20) {
    console.log(`  ... and ${missingBlogPosting.length - 20} more`);
  }
  
  console.log(`\n❌ Missing BreadcrumbList (${missingBreadcrumbList.length} pages):`);
  missingBreadcrumbList.slice(0, 20).forEach(r => {
    const isBlog = r.url.includes('/blog-on-photography/');
    console.log(`  - ${r.url} ${isBlog ? '[BLOG]' : ''}`);
  });
  if (missingBreadcrumbList.length > 20) {
    console.log(`  ... and ${missingBreadcrumbList.length - 20} more`);
  }
  
  console.log(`\n❌ Missing HowTo (${missingHowTo.length} blog pages):`);
  missingHowTo.slice(0, 20).forEach(r => {
    console.log(`  - ${r.url}`);
  });
  if (missingHowTo.length > 20) {
    console.log(`  ... and ${missingHowTo.length - 20} more`);
  }
  
  console.log(`\n❌ Missing Article (${missingArticle.length} blog pages):`);
  missingArticle.slice(0, 20).forEach(r => {
    console.log(`  - ${r.url}`);
  });
  if (missingArticle.length > 20) {
    console.log(`  ... and ${missingArticle.length - 20} more`);
  }
  
  // Categorize missing pages
  const blogMissing = {
    BlogPosting: missingBlogPosting,
    HowTo: missingHowTo,
    Article: missingArticle
  };
  
  const nonBlogMissing = {
    BreadcrumbList: missingBreadcrumbList.filter(r => !r.url.includes('/blog-on-photography/'))
  };
  
  console.log(`\n\n📋 Summary:`);
  console.log(`  Blog pages missing BlogPosting: ${missingBlogPosting.length}`);
  console.log(`  Blog pages missing HowTo: ${missingHowTo.length}`);
  console.log(`  Blog pages missing Article: ${missingArticle.length}`);
  console.log(`  Non-blog pages missing BreadcrumbList: ${nonBlogMissing.BreadcrumbList.length}`);
  console.log(`  Blog pages missing BreadcrumbList: ${missingBreadcrumbList.filter(r => r.url.includes('/blog-on-photography/')).length}`);
  
  // Save results
  fs.writeFileSync('missing-types-analysis.json', JSON.stringify({
    missingBlogPosting: missingBlogPosting.map(r => r.url),
    missingBreadcrumbList: missingBreadcrumbList.map(r => r.url),
    missingHowTo: missingHowTo.map(r => r.url),
    missingArticle: missingArticle.map(r => r.url),
    blogMissing,
    nonBlogMissing
  }, null, 2));
  
  console.log(`\n✅ Analysis saved to missing-types-analysis.json`);
  
  // Test a few missing URLs to see why
  console.log(`\n\n🔍 Testing sample missing URLs...\n`);
  
  const sampleMissing = [
    ...missingBlogPosting.slice(0, 3),
    ...missingBreadcrumbList.filter(r => r.url.includes('/blog-on-photography/')).slice(0, 2)
  ];
  
  for (const result of sampleMissing) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Testing: ${result.url}`);
    console.log('='.repeat(80));
    
    const response = await fetch(result.url);
    const html = await response.text();
    
    // Check for dynamic loader
    const slugMatch = result.url.match(/\/blog-on-photography\/([^\/]+)/);
    if (slugMatch) {
      const slug = slugMatch[1];
      console.log(`\nSlug: ${slug}`);
      
      const schemaFiles = [
        `${slug}_schema.json`,
        `${slug}_blogposting.json`,
        `${slug}_breadcrumb.json`,
        `${slug}_howto.json`
      ];
      
      console.log(`\nChecking schema files:`);
      for (const fileName of schemaFiles) {
        try {
          const schemaUrl = `https://schema.alanranger.com/${fileName}`;
          const schemaResponse = await fetch(schemaUrl);
          if (schemaResponse.ok) {
            const schemaData = await schemaResponse.json();
            console.log(`  ✅ ${fileName}: @type=${schemaData['@type'] || 'array'}`);
          } else {
            console.log(`  ❌ ${fileName}: ${schemaResponse.status}`);
          }
        } catch (e) {
          console.log(`  ❌ ${fileName}: ${e.message}`);
        }
      }
    }
    
    // Check for script tags with schema.alanranger.com
    const allScripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
    const hasDynamicLoader = allScripts.some(script => 
      /schema\.alanranger\.com/i.test(script) && 
      (/function|var |const |let |window\.|document\.|fetch\(/i.test(script))
    );
    
    console.log(`\nHas dynamic loader script: ${hasDynamicLoader ? 'YES' : 'NO'}`);
    
    // Check JSON-LD script tags
    const jsonLdScripts = html.match(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
    console.log(`JSON-LD script tags: ${jsonLdScripts.length}`);
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

main().catch(console.error);
