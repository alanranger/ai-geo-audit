#!/usr/bin/env node

/**
 * Test pattern-based BreadcrumbList detection
 */

import { safeJsonParse } from './api/aigeo/utils.js';

// Copy normalizeSchemaTypes from API
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
  
  // PATTERN-BASED DETECTION: Check if ItemList should be treated as BreadcrumbList
  if (!collected.has('BreadcrumbList')) {
    function checkForBreadcrumbPattern(node, depth = 0) {
      if (!node || typeof node !== 'object' || depth > 10) return false;
      
      // Check if this is an ItemList with itemListElement
      const isItemList = collected.has('ItemList') || 
                        (node['@type'] === 'ItemList' || 
                         (Array.isArray(node['@type']) && node['@type'].includes('ItemList')));
      
      if (isItemList && Array.isArray(node.itemListElement) && node.itemListElement.length > 0) {
        // Check if items have breadcrumb-like structure (position, name, item.url)
        // Make it lenient - if at least 50% have breadcrumb structure, treat as BreadcrumbList
        const breadcrumbLikeItems = node.itemListElement.filter(item =>
          item && typeof item === 'object' && 
          (item.position !== undefined || item['@type'] === 'ListItem') &&
          (item.name || item.item?.name) &&
          (item.item?.url || item.url)
        );
        
        if (breadcrumbLikeItems.length >= Math.ceil(node.itemListElement.length * 0.5)) {
          collected.add('BreadcrumbList');
          return true;
        }
      }
      
      // Check @graph for ItemList with breadcrumb structure
      if (Array.isArray(node['@graph'])) {
        for (const graphItem of node['@graph']) {
          if (checkForBreadcrumbPattern(graphItem, depth + 1)) {
            return true;
          }
        }
      }
      
      // Check nested structures
      if (node.itemListElement && Array.isArray(node.itemListElement)) {
        const parent = node;
        const hasBreadcrumbStructure = node.itemListElement.some(item =>
          item && typeof item === 'object' && 
          (item.position !== undefined || item['@type'] === 'ListItem') &&
          (item.name || item.item?.name) &&
          (item.item?.url || item.url)
        );
        
        if (hasBreadcrumbStructure && (parent['@type'] === 'ItemList' || collected.has('ItemList'))) {
          collected.add('BreadcrumbList');
          return true;
        }
      }
      
      return false;
    }
    
    checkForBreadcrumbPattern(schemaObject);
  }
  
  return Array.from(collected);
}

const testUrl = 'https://www.alanranger.com/photography-services-near-me/composition-settings-photography-field-checklists';

async function test() {
  console.log(`Testing: ${testUrl}\n`);
  
  const response = await fetch(testUrl);
  const html = await response.text();
  
  const jsonLdRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
  const matches = [...html.matchAll(jsonLdRegex)];
  
  console.log(`Found ${matches.length} JSON-LD script tags\n`);
  
  const allTypes = new Set();
  
  matches.forEach((match, idx) => {
    const content = match[1].trim().replace(/<!--[\s\S]*?-->/g, '');
    const parsed = safeJsonParse(content);
    
    if (parsed) {
      const types = normalizeSchemaTypes(parsed);
      console.log(`Script ${idx + 1}: ${types.join(', ')}`);
      types.forEach(t => allTypes.add(t));
    }
  });
  
  console.log(`\n📊 All detected types:`);
  console.log(`  ${Array.from(allTypes).join(', ')}`);
  console.log(`\n✅ Has BreadcrumbList: ${allTypes.has('BreadcrumbList') ? 'YES ✅' : 'NO ❌'}`);
  console.log(`✅ Has ItemList: ${allTypes.has('ItemList') ? 'YES' : 'NO'}`);
}

test().catch(console.error);

