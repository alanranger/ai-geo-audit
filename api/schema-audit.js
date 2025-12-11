/**
 * Schema Audit API
 * 
 * CSV-based schema coverage scanner.
 * Reads URLs from 06-site-urls.csv and crawls each for JSON-LD schema markup.
 * 
 * Returns comprehensive schema inventory, coverage metrics, and rich result eligibility.
 */

import { safeJsonParse } from './aigeo/utils.js';

// Rich result eligible schema types
const RICH_RESULT_TYPES = [
  'Article',
  'Event',
  'FAQPage',
  'Product',
  'LocalBusiness',
  'Course',
  'Review',
  'HowTo',
  'VideoObject',
  'ImageObject', // For image search rich results
  'ItemList' // Creates Carousel rich results in Google Search Console
];

/**
 * Extract all JSON-LD blocks from HTML
 * Also fetches dynamically loaded schemas from schema.alanranger.com
 */
async function extractJsonLd(htmlString, pageUrl = null) {
  const jsonLdBlocks = [];
  
  // FIRST: Check ALL script tags for dynamic loaders (before parsing JSON-LD)
  // This handles cases where JavaScript loaders are in script tags without type="application/ld+json"
  const allScriptsRegex = /<script[^>]*>(.*?)<\/script>/gis;
  const allScripts = [...htmlString.matchAll(allScriptsRegex)];
  
  for (const scriptMatch of allScripts) {
    const scriptContent = scriptMatch[1].trim();
    const hasSchemaDomain = /schema\.alanranger\.com/i.test(scriptContent);
    const isJavaScript = /function|var |const |let |window\.|document\.|fetch\(/i.test(scriptContent);
    
    if (hasSchemaDomain && isJavaScript) {
      const schemaFiles = [];
      
      // Pattern 1: Blog posts - slug-based files
      if (pageUrl && pageUrl.includes('/blog-on-photography/')) {
        const slugMatch = pageUrl.match(/\/blog-on-photography\/([^\/]+)/);
        if (slugMatch) {
          const slug = slugMatch[1];
          schemaFiles.push(
            `${slug}_schema.json`,
            `${slug}_blogposting.json`,
            `${slug}_breadcrumb.json`,
            `${slug}_howto.json`,
            `${slug}_faq.json`
          );
        }
      }
      
      // Pattern 2: Path-based mapping (lessons, workshops, blog index)
      if (pageUrl) {
        const path = new URL(pageUrl).pathname.replace(/\/$/, '') || '/';
        
        // Check for path-based mappings mentioned in loader
        if (/lessons-schema\.json/i.test(scriptContent) || path === '/beginners-photography-lessons') {
          schemaFiles.push('lessons-schema.json');
        }
        if (/workshops-schema\.json/i.test(scriptContent) || path === '/photographic-workshops-near-me') {
          schemaFiles.push('workshops-schema.json');
        }
        if (/blog-schema\.json/i.test(scriptContent) || path === '/blog-on-photography') {
          schemaFiles.push('blog-schema.json');
        }
      }
      
      // Fetch all schema files
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
            console.log(`✅ Fetched schema from ${schemaUrl}: @type=${schemaData['@type'] || 'array'}`);
          }
        } catch (e) {
          // File doesn't exist, skip
        }
      }
      
      if (schemaFiles.length > 0) {
        break; // Found loader, don't check other scripts
      }
    }
  }
  
  // THEN: Parse regular JSON-LD script tags
  const jsonLdRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
  const matches = [...htmlString.matchAll(jsonLdRegex)];
  
  let parseErrors = 0;
  let totalBlocks = 0;
  const failedBlocks = [];
  
  for (const match of matches) {
    totalBlocks++;
    let jsonText = match[1].trim();
    
    // Try to clean up common JSON issues before parsing
    // Remove HTML comments that might be inside script tags
    jsonText = jsonText.replace(/<!--[\s\S]*?-->/g, '');
    
    const parsed = safeJsonParse(jsonText);
    if (parsed) {
      // Handle both single objects and arrays
      if (Array.isArray(parsed)) {
        jsonLdBlocks.push(...parsed);
      } else {
        jsonLdBlocks.push(parsed);
      }
    } else {
      // Check if this is JavaScript code that loads schemas dynamically
      // Pattern: JavaScript code that references schema.alanranger.com
      const isDynamicLoader = /schema\.alanranger\.com/i.test(jsonText) && 
                              (/function/i.test(jsonText) || /\.json/i.test(jsonText));
      
      if (isDynamicLoader && pageUrl) {
        // Extract slug from URL and fetch schema files directly
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
          
          // Fetch schema files from schema.alanranger.com
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
                console.log(`✅ Fetched schema from ${schemaUrl}: @type=${schemaData['@type'] || 'array'}`);
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
        // Not a dynamic loader - try parse error recovery
        parseErrors++;
        
        // CRITICAL: Try to extract @type from failed parse blocks
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
          console.log(`⚠️ Failed to parse JSON-LD block but detected @type="${extractedType}". Creating recovered schema...`);
          jsonLdBlocks.push({
            '@type': extractedType,
            '@context': 'https://schema.org',
            _parseError: true,
            _recovered: true
          });
          parseErrors--;
          console.log(`✅ Recovered ${extractedType} schema from parse error`);
        } else {
          const mentionedTypes = importantTypes.filter(type => 
            new RegExp(type, 'i').test(jsonText)
          );
          if (mentionedTypes.length > 0) {
            console.log(`⚠️ Failed to parse JSON-LD block containing: ${mentionedTypes.join(', ')}`);
            
            const harderPatterns = [
              /@type["\s]*:["\s]*["']([^"']+)["']/i,
              /type["\s]*:["\s]*["']([^"']+)["']/i
            ];
            
            for (const pattern of harderPatterns) {
              const hardMatch = jsonText.match(pattern);
              if (hardMatch && hardMatch[1] && importantTypes.includes(hardMatch[1].trim())) {
                const recoveredType = hardMatch[1].trim();
                console.log(`✅ Hard recovery: Found @type="${recoveredType}"`);
                jsonLdBlocks.push({
                  '@type': recoveredType,
                  '@context': 'https://schema.org',
                  _parseError: true,
                  _recovered: true,
                  _hardRecovery: true
                });
                parseErrors--;
                break;
              }
            }
            
            failedBlocks.push({
              type: mentionedTypes.join(', '),
              sample: jsonText.substring(0, 500)
            });
          }
        }
      }
    }
  }
  
  if (parseErrors > 0) {
    console.log(`⚠️ JSON-LD extraction: ${parseErrors}/${totalBlocks} blocks failed to parse`);
    if (failedBlocks.length > 0) {
      console.log(`  Failed blocks with important types:`, failedBlocks.map(b => b.type).join(', '));
    }
  }
  
  // Also check for microdata BreadcrumbList (itemscope/itemtype)
  // This is a fallback for sites that use microdata instead of JSON-LD
  const breadcrumbMicrodataRegex = /<nav[^>]*itemscope[^>]*itemtype=["']https?:\/\/schema\.org\/BreadcrumbList["'][^>]*>/i;
  if (breadcrumbMicrodataRegex.test(htmlString)) {
    // Create a synthetic BreadcrumbList object for microdata detection
    jsonLdBlocks.push({
      '@type': 'BreadcrumbList',
      '@context': 'https://schema.org',
      _detectedFrom: 'microdata'
    });
  }
  
  // Fallback: Check if important schema types are mentioned in JSON-LD script tags but not extracted
  // This catches cases where they're in script tags that didn't match our regex OR failed to parse
  const importantTypes = ['BreadcrumbList', 'HowTo', 'BlogPosting', 'WebPage', 'FAQPage', 'Article', 'ItemList'];
  
  // Extract all JSON-LD script tags first (to avoid matching regular JavaScript)
  const jsonLdScriptRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi;
  const jsonLdScripts = htmlString.match(jsonLdScriptRegex) || [];
  const jsonLdHtml = jsonLdScripts.join('\n'); // Only search within JSON-LD script tags
  
  // Check each important type
  importantTypes.forEach(typeName => {
    // Only check within JSON-LD script tags (not regular JavaScript)
    const typeInJsonLd = new RegExp(`"@type"\\s*:\\s*"${typeName}"`, 'i').test(jsonLdHtml) ||
                         new RegExp(`@type["\s]*:["\s]*["']${typeName}["']`, 'i').test(jsonLdHtml);
    
    if (typeInJsonLd) {
      // Check if we already have this type in extracted blocks (use normalizeSchemaTypes for accurate check)
      const hasType = jsonLdBlocks.some(block => {
        if (!block) return false;
        const types = normalizeSchemaTypes(block);
        return types.includes(typeName);
      });
      
      // If mentioned in HTML but not detected, try to find and extract it
      if (!hasType) {
        console.log(`🔍 ${typeName} mentioned in HTML but not in extracted blocks. Searching for script tag...`);
        
        // Try multiple regex patterns to find script tags containing this type
        const patterns = [
          // Pattern 1: Standard script tag with type attribute
          new RegExp(`<script[^>]*type\\s*=\\s*["']application/ld\\+json["'][^>]*>[\\s\\S]*?"@type"\\s*:\\s*"${typeName}"[\\s\\S]*?<\\/script>`, 'gi'),
          // Pattern 2: Script tag without type attribute but with @type
          new RegExp(`<script[^>]*>[\\s\\S]*?"@type"\\s*:\\s*"${typeName}"[\\s\\S]*?<\\/script>`, 'gi'),
          // Pattern 3: More flexible - any script tag containing the type (up to 10KB)
          new RegExp(`<script[^>]*>[\\s\\S]{0,10000}"@type"\\s*:\\s*"${typeName}"[\\s\\S]{0,10000}<\\/script>`, 'gi'),
          // Pattern 4: Even more flexible - look for script tags near the type mention
          new RegExp(`<script[^>]*>[\\s\\S]*?${typeName}[\\s\\S]*?<\\/script>`, 'gi')
        ];
        
        let aggressiveMatches = [];
        for (let i = 0; i < patterns.length; i++) {
          const pattern = patterns[i];
          try {
            const matches = [...htmlString.matchAll(pattern)];
            if (matches.length > 0) {
              aggressiveMatches = matches;
              console.log(`🔍 Found ${typeName} in script tag using pattern ${i + 1} (${matches.length} match(es)). Attempting extraction...`);
              break;
            }
          } catch (e) {
            // Regex might be too complex, skip it
            continue;
          }
        }
        
        if (aggressiveMatches.length > 0) {
          let extracted = false;
          
          aggressiveMatches.forEach((match, idx) => {
            let jsonText = match[0].replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
            // Remove HTML comments
            let cleaned = jsonText.replace(/<!--[\s\S]*?-->/g, '');
            
            // Try to fix common JSON issues
            cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1'); // Remove trailing commas
            cleaned = cleaned.replace(/([{\[])\s*,/g, '$1'); // Remove leading commas
            
            const parsed = safeJsonParse(cleaned);
            
            if (parsed) {
              if (Array.isArray(parsed)) {
                jsonLdBlocks.push(...parsed);
              } else {
                jsonLdBlocks.push(parsed);
              }
              extracted = true;
              console.log(`✅ Successfully parsed ${typeName} from aggressive regex (match ${idx + 1})`);
            } else {
              // Even if parsing fails, create minimal schema if we can confirm @type
              const typeMatch = cleaned.match(new RegExp(`"@type"\\s*:\\s*"${typeName}"`, 'i')) ||
                               cleaned.match(new RegExp(`["']@type["']\\s*:\\s*["']${typeName}["']`, 'i')) ||
                               cleaned.match(new RegExp(`@type\\s*:\\s*["']${typeName}["']`, 'i'));
              
              if (typeMatch) {
                jsonLdBlocks.push({
                  '@type': typeName,
                  '@context': 'https://schema.org',
                  _recovered: true,
                  _fromAggressiveRegex: true,
                  _parseFailed: true
                });
                extracted = true;
                console.log(`✅ Created minimal ${typeName} schema from aggressive regex (parse failed but @type confirmed)`);
                console.log(`  Sample from failed JSON: ${cleaned.substring(0, 300)}`);
              }
            }
          });
          
          if (!extracted) {
            console.log(`⚠️ ${typeName} mentioned in HTML but not detected in JSON-LD for ${url}`);
            console.log(`  Tried ${aggressiveMatches.length} script tag(s) but couldn't extract @type`);
          }
        } else {
          console.log(`⚠️ ${typeName} mentioned in HTML but not detected in JSON-LD for ${url}`);
          console.log(`  Could not find script tag containing ${typeName}`);
        }
      }
    }
  });
  
  return jsonLdBlocks;
}

/**
 * Extract page title from HTML
 */
function extractTitle(htmlString) {
  // Try <title> tag first
  const titleMatch = htmlString.match(/<title[^>]*>(.*?)<\/title>/is);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1].trim().replace(/\s+/g, ' ');
  }
  
  // Try og:title meta tag
  const ogTitleMatch = htmlString.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/is);
  if (ogTitleMatch && ogTitleMatch[1]) {
    return ogTitleMatch[1].trim();
  }
  
  // Try h1 as fallback
  const h1Match = htmlString.match(/<h1[^>]*>(.*?)<\/h1>/is);
  if (h1Match && h1Match[1]) {
    return h1Match[1].trim().replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
  }
  
  return null;
}

/**
 * Extract meta description from HTML
 */
function extractMetaDescription(htmlString) {
  // Try standard meta description tag
  const metaDescMatch = htmlString.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/is);
  if (metaDescMatch && metaDescMatch[1]) {
    return metaDescMatch[1].trim();
  }
  
  // Try og:description meta tag
  const ogDescMatch = htmlString.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/is);
  if (ogDescMatch && ogDescMatch[1]) {
    return ogDescMatch[1].trim();
  }
  
  return null;
}

/**
 * Normalize schema types from a schema object
 * Returns array of @type values
 * Uses the proven Schema Tools extraction logic as base, then walks nested structures
 */
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

  // STEP 1: Use Schema Tools proven logic (simple and works)
  // Handle arrays
  if (Array.isArray(schemaObject)) {
    schemaObject.forEach(item => {
      if (item && item['@type']) {
        addType(item['@type']);
      }
    });
  }
  // Handle @graph structure (critical for BreadcrumbList detection)
  else if (schemaObject['@graph'] && Array.isArray(schemaObject['@graph'])) {
    schemaObject['@graph'].forEach(item => {
      if (item && item['@type']) {
        addType(item['@type']);
      }
    });
  }
  // Handle simple object with @type
  else if (schemaObject['@type']) {
    addType(schemaObject['@type']);
  }

  // STEP 2: Walk nested structures to catch all types (recursive)
  function walk(node, depth = 0) {
    if (!node || typeof node !== 'object') return;
    if (depth > 15) return; // Prevent infinite recursion

    // Check @type at this level
    const nodeType = node['@type'];
    if (nodeType) {
      if (Array.isArray(nodeType)) {
        nodeType.forEach(t => addType(t));
      } else {
        addType(nodeType);
      }
    }

    // Walk @graph
    if (Array.isArray(node['@graph'])) {
      node['@graph'].forEach(child => {
        if (child && child['@type']) {
          addType(child['@type']);
        }
        walk(child, depth + 1);
      });
    }

    // Walk nested properties that often contain schema objects
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

    // Walk all other object properties recursively
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

  // Walk the schema object to catch nested types
  walk(schemaObject);
  
  // PATTERN-BASED DETECTION: Check if ItemList should be treated as BreadcrumbList
  // Many sites use ItemList with itemListElement for breadcrumbs instead of explicit BreadcrumbList
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
        const breadcrumbLikeItems = node.itemListElement.filter(item =>
          item && typeof item === 'object' && 
          (item.position !== undefined || item['@type'] === 'ListItem') &&
          (item.name || item.item?.name) &&
          (item.item?.url || item.url)
        );
        
        if (breadcrumbLikeItems.length >= Math.ceil(node.itemListElement.length * 0.5) && 
            (parent['@type'] === 'ItemList' || collected.has('ItemList'))) {
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

/**
 * Detect rich result eligibility from schema types
 */
function detectRichResultEligibility(typesArray) {
  const eligible = {};
  RICH_RESULT_TYPES.forEach(type => {
    eligible[type] = typesArray.includes(type);
  });
  return eligible;
}

/**
 * Get parent collection page URL for a given URL
 * Returns null if no parent collection page exists
 */
function getParentCollectionPageUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    
    // Blog posts -> blog index
    if (pathname.startsWith('/blog-on-photography/') && pathname !== '/blog-on-photography') {
      return `${urlObj.origin}/blog-on-photography`;
    }
    
    // Workshops -> workshops listing
    if (pathname.startsWith('/photographic-workshops-near-me/') && pathname !== '/photographic-workshops-near-me') {
      return `${urlObj.origin}/photographic-workshops-near-me`;
    }
    
    // Lessons -> lessons listing
    if (pathname.startsWith('/beginners-photography-lessons/') && pathname !== '/beginners-photography-lessons') {
      return `${urlObj.origin}/beginners-photography-lessons`;
    }
    
    // Events -> events listing (if different from workshops)
    if (pathname.startsWith('/photography-services-near-me/') && pathname !== '/photography-services-near-me') {
      // Check if it's an event/product page
      return `${urlObj.origin}/photography-services-near-me`;
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Check if a URL is listed in a parent collection page's ItemList schema
 */
async function checkInheritedSchema(url, parentCollectionUrl) {
  try {
    const response = await fetch(parentCollectionUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AI-GEO-Audit/1.0; +https://ai-geo-audit.vercel.app)'
      },
      signal: AbortSignal.timeout(10000)
    });
    
    if (!response.ok) {
      return false;
    }
    
    const html = await response.text();
    const schemas = await extractJsonLd(html, url);
    
    // Normalize the URL for comparison (remove trailing slashes, etc.)
    const normalizedUrl = url.replace(/\/$/, '');
    
    // Look for ItemList schema that contains this URL
    for (const schema of schemas) {
      const types = normalizeSchemaTypes(schema);
      
      // Check if this is an ItemList or CollectionPage
      if (types.includes('ItemList') || types.includes('CollectionPage')) {
        // Check itemListElement array
        const itemList = schema.itemListElement || schema['@graph']?.find(item => 
          normalizeSchemaTypes(item).includes('ItemList')
        )?.itemListElement;
        
        if (Array.isArray(itemList)) {
          for (const item of itemList) {
            // Check if item has a URL that matches
            const itemUrl = item.url || item['@id'] || item.item?.url || item.item?.['@id'];
            if (itemUrl) {
              const normalizedItemUrl = itemUrl.replace(/\/$/, '');
              if (normalizedItemUrl === normalizedUrl || normalizedItemUrl.includes(normalizedUrl) || normalizedUrl.includes(normalizedItemUrl)) {
                return true;
              }
            }
            
            // Also check nested items
            if (item.item) {
              const nestedUrl = item.item.url || item.item['@id'];
              if (nestedUrl) {
                const normalizedNestedUrl = nestedUrl.replace(/\/$/, '');
                if (normalizedNestedUrl === normalizedUrl || normalizedNestedUrl.includes(normalizedUrl) || normalizedUrl.includes(normalizedNestedUrl)) {
                  return true;
                }
              }
            }
          }
        }
      }
    }
    
    return false;
  } catch (error) {
    // Silently fail - don't break the audit if parent page check fails
    return false;
  }
}

/**
 * Parse CSV and extract URLs from column A (skip header)
 */
async function parseCsvUrls() {
  // Fetch CSV directly from GitHub (primary source)
  const GITHUB_CSV_URL = process.env.GITHUB_CSV_URL || 
    "https://raw.githubusercontent.com/alanranger/alan-shared-resources/main/csv/06-site-urls.csv";
  
  // Fallback to hosted CSV if GitHub fails
  const FALLBACK_CSV_URL = process.env.CSV_URL || 
    "https://schema-tools-six.vercel.app/06-site-urls.csv";

  console.log("📄 Fetching CSV from GitHub:", GITHUB_CSV_URL);

  let csvText = "";
  let source = 'github';

  try {
    // Try GitHub first
    const res = await fetch(GITHUB_CSV_URL);

    if (res.ok) {
      csvText = await res.text();
      console.log("✓ CSV fetched from GitHub successfully");
    } else {
      throw new Error(`GitHub fetch failed: HTTP ${res.status}`);
    }
  } catch (githubErr) {
    console.warn("⚠ GitHub fetch failed, trying fallback:", githubErr.message);
    
    // Fallback to hosted CSV
    try {
      const fallbackRes = await fetch(FALLBACK_CSV_URL);
      if (fallbackRes.ok) {
        csvText = await fallbackRes.text();
        source = 'hosted';
        console.log("✓ CSV fetched from fallback location");
      } else {
        throw new Error(`Fallback fetch failed: HTTP ${fallbackRes.status}`);
      }
    } catch (fallbackErr) {
      console.error("❌ CSV fetch error from both sources:", fallbackErr);
      throw new Error(`Unable to load site URLs CSV from GitHub or fallback. GitHub: ${githubErr.message}, Fallback: ${fallbackErr.message}`);
    }
  }
  
  console.log(`✓ CSV loaded from ${source}, size: ${csvText.length} bytes`);
  const csvContent = csvText;
  
  // Parse CSV - extract URLs from url column (skip header)
  const lines = csvContent.split('\n').filter(line => line.trim());
  const urls = [];
  
  // Parse header row to find URL column index
  let urlColumnIndex = 0; // Default to first column
  if (lines.length > 0) {
    const headerLine = lines[0].trim();
    const headers = parseCsvLine(headerLine);
    const urlHeaderIndex = headers.findIndex(h => h.toLowerCase() === 'url');
    if (urlHeaderIndex !== -1) {
      urlColumnIndex = urlHeaderIndex;
    }
  }
  
  // Helper function to parse CSV line with proper quote handling
  function parseCsvLine(line) {
    const columns = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // End of column
        columns.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    columns.push(current); // Add last column
    return columns;
  }
  
  for (let i = 1; i < lines.length; i++) { // Skip header row
    const line = lines[i].trim();
    if (!line) continue; // Skip empty rows
    
    try {
      const columns = parseCsvLine(line);
      if (columns[urlColumnIndex]) {
        const url = columns[urlColumnIndex].trim().replace(/^"|"$/g, '');
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
          urls.push(url);
        }
      }
    } catch (e) {
      // Skip malformed lines
      continue;
    }
  }
  
  return urls;
}

/**
 * Delay helper function
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Crawl a single URL with concurrency control
 */
async function crawlUrl(url, semaphore, delayAfterMs = 0) {
  await semaphore.acquire();
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AI-GEO-Audit/1.0; +https://ai-geo-audit.vercel.app)'
      },
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    
    if (!response.ok) {
      // Categorize HTTP errors
      let errorType = 'HTTP Error';
      if (response.status === 429) {
        errorType = 'Rate Limited';
      } else if (response.status >= 500) {
        errorType = 'Server Error';
      } else if (response.status === 404) {
        errorType = 'Not Found';
      } else if (response.status === 403) {
        errorType = 'Forbidden';
      }
      
      // Add delay after failed request
      if (delayAfterMs > 0) {
        await delay(delayAfterMs);
      }
      
      return {
        url,
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        errorType: errorType,
        schemas: []
      };
    }
    
    const html = await response.text();
    const schemas = await extractJsonLd(html, url);
    const title = extractTitle(html);
    const metaDescription = extractMetaDescription(html);
    
    // Debug: Log ALL extracted schemas and their detection
    if (schemas.length > 0) {
      console.log(`📋 Extracted ${schemas.length} schema block(s) from ${url}`);
    }
    
    // Debug: Check ALL schemas for BreadcrumbList, HowTo, FAQPage, BlogPosting and log details
    schemas.forEach((schema, idx) => {
      // First, check raw @type before normalization
      const rawType = schema['@type'];
      const types = normalizeSchemaTypes(schema);
      const importantTypes = ['BreadcrumbList', 'HowTo', 'FAQPage', 'BlogPosting', 'Article'];
      const foundImportantTypes = types.filter(t => importantTypes.includes(t));
      
      // Log if raw @type exists but wasn't detected
      if (rawType && !types.includes(rawType)) {
        console.log(`⚠️ SCHEMA DETECTION ISSUE: Raw @type="${rawType}" exists but normalizeSchemaTypes didn't detect it for ${url}`);
        console.log(`  Detected types: ${types.join(', ') || 'NONE'}`);
        console.log(`  Schema sample:`, JSON.stringify(schema).substring(0, 400));
      }
      
      if (foundImportantTypes.length > 0) {
        console.log(`✅ ${foundImportantTypes.join(', ')} detected in schema block ${idx} for ${url}`);
        console.log(`  All types in block: ${types.join(', ')}`);
        console.log(`  Schema @type: ${rawType || 'missing'}`);
        console.log(`  Schema structure sample:`, JSON.stringify(schema).substring(0, 300));
      }
    });
    
    // Also check if important types are mentioned anywhere in HTML but not detected
    const allDetectedTypes = new Set();
    schemas.forEach(s => normalizeSchemaTypes(s).forEach(t => allDetectedTypes.add(t)));
    
    // Check all important schema types
    const importantTypes = ['BreadcrumbList', 'HowTo', 'FAQPage', 'BlogPosting', 'WebPage', 'Article', 'ItemList'];
    importantTypes.forEach(type => {
      // Check if type is mentioned in HTML (either as @type or just the name)
      const typeInHtml = new RegExp(`"@type"\\s*:\\s*"${type}"`, 'i').test(html) || 
                         (type === 'BlogPosting' && /BlogPosting/i.test(html)) ||
                         (type === 'WebPage' && /"@type"\\s*:\\s*"WebPage"/i.test(html));
      
      if (typeInHtml && !allDetectedTypes.has(type)) {
        console.log(`⚠️ ${type} mentioned in HTML but not detected in JSON-LD for ${url}`);
        // Try to find where it's mentioned
        const matches = html.match(new RegExp(`"@type"\\s*:\\s*"${type}"`, 'i'));
        if (matches) {
          console.log(`  Found @type reference in HTML at position ${matches.index}`);
          // Show context around the match
          const contextStart = Math.max(0, matches.index - 100);
          const contextEnd = Math.min(html.length, matches.index + 200);
          console.log(`  Context: ${html.substring(contextStart, contextEnd)}`);
        }
      }
    });
    
    // Add delay after successful request to avoid rate limiting
    if (delayAfterMs > 0) {
      await delay(delayAfterMs);
    }
    
    return {
      url,
      success: true,
      schemas,
      title,
      metaDescription
    };
  } catch (error) {
    // Categorize error types for better diagnostics
    let errorType = 'Unknown';
    let errorMessage = error.message || 'Unknown error';
    
    if (error.name === 'AbortError' || error.message.includes('timeout')) {
      errorType = 'Timeout';
      errorMessage = 'Request timed out after 10 seconds';
    } else if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
      errorType = 'Connection Error';
    } else if (error.message.includes('ENOTFOUND') || error.message.includes('DNS')) {
      errorType = 'DNS Error';
    } else if (error.message.includes('certificate') || error.message.includes('SSL')) {
      errorType = 'SSL/Certificate Error';
    } else if (error.message.includes('HTTP')) {
      errorType = 'HTTP Error';
    } else if (error.message.includes('network')) {
      errorType = 'Network Error';
    }
    
    // Add delay after error to avoid rate limiting
    if (delayAfterMs > 0) {
      await delay(delayAfterMs);
    }
    
    return {
      url,
      success: false,
      error: errorMessage,
      errorType: errorType,
      schemas: []
    };
  } finally {
    semaphore.release();
  }
}

/**
 * Simple semaphore for concurrency control
 */
class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }
  
  async acquire() {
    return new Promise((resolve) => {
      if (this.current < this.max) {
        this.current++;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }
  
  release() {
    this.current--;
    if (this.queue.length > 0) {
      this.current++;
      const next = this.queue.shift();
      next();
    }
  }
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Allow GET and POST requests
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({
      status: 'error',
      source: 'schema-audit',
      message: 'Method not allowed. Use GET or POST.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    // Check if manual URL list is provided in request body
    let urls = [];
    let urlSource = 'github';
    
    if (req.method === 'POST') {
      // Parse request body
      let body = {};
      try {
        if (typeof req.body === 'string') {
          body = JSON.parse(req.body);
        } else {
          body = req.body || {};
        }
      } catch (e) {
        // Body might already be parsed
        body = req.body || {};
      }
      
      if (body.urls && Array.isArray(body.urls)) {
        // Use manual URL list from request
        urls = body.urls.filter(url => url && typeof url === 'string' && url.startsWith('http'));
        urlSource = 'manual';
        console.log(`📄 Using manual URL list: ${urls.length} URLs provided`);
      } else {
        // POST but no URLs provided, fall back to CSV
        urls = await parseCsvUrls();
        urlSource = 'csv';
      }
    } else {
      // GET request - parse CSV and get URLs from GitHub/hosted CSV
      urls = await parseCsvUrls();
      urlSource = 'csv';
    }
    
    if (urls.length === 0) {
      return res.status(400).json({
        status: 'error',
        source: 'schema-audit',
        message: 'No URLs found in CSV file',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    // Crawl URLs with concurrency limit and delay between requests
    // Reduced delay to avoid Vercel timeout limits
    const semaphore = new Semaphore(4);
    const delayBetweenRequests = 150; // 150ms delay after each request (reduced from 300ms)
    
    let results = [];
    try {
      // Initial crawl with delays
      console.log(`🕷️ Starting initial crawl of ${urls.length} URLs with ${delayBetweenRequests}ms delay between requests...`);
      const startTime = Date.now();
      const crawlPromises = urls.map(url => crawlUrl(url, semaphore, delayBetweenRequests));
      results = await Promise.all(crawlPromises);
      const crawlTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✓ Initial crawl completed in ${crawlTime} seconds`);
      
      // Identify failed crawls for retry
      const failedResults = results.filter(r => !r.success);
      const retryCount = failedResults.length;
      
      if (retryCount > 0) {
        console.log(`🔄 Retrying ${retryCount} failed crawls with longer delays (1.5 seconds)...`);
        const retrySemaphore = new Semaphore(2); // Lower concurrency for retries
        const retryDelay = 1500; // 1.5 second delay for retries (reduced from 2s)
        
        // Add a shorter initial delay before starting retries
        await delay(2000); // Reduced from 3s
        
        const retryStartTime = Date.now();
        const retryPromises = failedResults.map(result => {
          return crawlUrl(result.url, retrySemaphore, retryDelay);
        });
        
        const retryResults = await Promise.all(retryPromises);
        const retryTime = ((Date.now() - retryStartTime) / 1000).toFixed(1);
        console.log(`✓ Retry completed in ${retryTime} seconds`);
        
        // Update results with retry attempts (replace failed with retry results)
        const resultsMap = new Map(results.map(r => [r.url, r]));
        retryResults.forEach(retryResult => {
          resultsMap.set(retryResult.url, retryResult);
        });
        results = Array.from(resultsMap.values());
        
        const retrySuccessCount = retryResults.filter(r => r.success).length;
        const retryFailedCount = retryCount - retrySuccessCount;
        console.log(`✓ Retry results: ${retrySuccessCount}/${retryCount} succeeded, ${retryFailedCount} still failed`);
      }
    } catch (crawlError) {
      console.error('❌ Error during crawl process:', crawlError);
      console.error('Stack:', crawlError.stack);
      // If crawl fails entirely, return empty results with error
      throw new Error(`Crawl process failed: ${crawlError.message}`);
    }
    
    // Aggregate results - first pass: check inline schema
    const totalPages = results.length;
    let pagesWithSchema = 0;
    let pagesWithInheritedSchema = 0;
    const schemaTypes = {};
    const allTypes = new Set();
    const errors = [];
    const richEligible = {};
    const pagesNeedingInheritanceCheck = []; // URLs without inline schema
    
    // Track error types for diagnostics
    const errorTypes = {};
    const errorExamples = {}; // Store one example URL per error type
    
    console.log(`📊 Starting schema audit aggregation:`);
    console.log(`  Total pages crawled: ${totalPages}`);
    console.log(`  Successful crawls: ${results.filter(r => r.success).length}`);
    const failedResults = results.filter(r => !r.success);
    console.log(`  Failed crawls: ${failedResults.length}`);
    
    // Analyze error types
    failedResults.forEach(result => {
      const errorType = result.errorType || 'Unknown';
      errorTypes[errorType] = (errorTypes[errorType] || 0) + 1;
      if (!errorExamples[errorType]) {
        errorExamples[errorType] = {
          url: result.url,
          error: result.error
        };
      }
    });
    
    if (Object.keys(errorTypes).length > 0) {
      console.log(`📊 Error breakdown:`);
      Object.entries(errorTypes).forEach(([type, count]) => {
        console.log(`  • ${type}: ${count} pages`);
        if (errorExamples[type]) {
          console.log(`    Example: ${errorExamples[type].url} - ${errorExamples[type].error}`);
        }
      });
    }
    
    // Initialize rich eligible map
    RICH_RESULT_TYPES.forEach(type => {
      richEligible[type] = false;
    });
    
    // Store schema types per page
    const pageSchemaTypesMap = new Map();
    
    // First pass: check for inline schema
    results.forEach(result => {
      if (!result.success) {
        errors.push({
          url: result.url,
          error: result.error
        });
        // Store empty schema types for failed pages
        pageSchemaTypesMap.set(result.url, []);
        return;
      }
      
      const hasInlineSchema = result.schemas.length > 0;
      
      if (hasInlineSchema) {
        pagesWithSchema++;
        
        // Collect all types from this page
        const pageTypes = new Set();
        result.schemas.forEach((schema, schemaIdx) => {
          const types = normalizeSchemaTypes(schema);
          types.forEach(type => {
            pageTypes.add(type);
            allTypes.add(type);
            schemaTypes[type] = (schemaTypes[type] || 0) + 1;
          });
          
          // Debug: Check each schema block for important types
          const importantTypes = ['BreadcrumbList', 'HowTo', 'FAQPage', 'BlogPosting', 'Article'];
          const foundImportantTypes = types.filter(t => importantTypes.includes(t));
          if (foundImportantTypes.length > 0) {
            console.log(`✅ ${foundImportantTypes.join(', ')} found in schema block ${schemaIdx} for ${result.url}`);
            console.log(`  Schema @type: ${schema['@type'] || 'missing'}, All types: ${types.join(', ')}`);
          }
        });
        
        // Store schema types for this page
        const pageTypesArray = Array.from(pageTypes);
        pageSchemaTypesMap.set(result.url, pageTypesArray);
        
        // Debug logging for pages missing important types
        if (pageTypesArray.length > 0) {
          const importantTypes = ['BreadcrumbList', 'HowTo', 'FAQPage', 'BlogPosting', 'Article'];
          const missingImportantTypes = importantTypes.filter(t => !pageTypesArray.includes(t));
          
          // Only log if page has schemas but is missing important types (to reduce noise)
          if (missingImportantTypes.length > 0 && result.schemas.length > 0) {
            // Check if any schema block has @type matching missing types (might be detection issue)
            const schemaTypesInBlocks = result.schemas.map(s => s['@type']).filter(Boolean);
            const hasTypeInBlock = missingImportantTypes.some(t => 
              schemaTypesInBlocks.some(st => 
                (Array.isArray(st) ? st.includes(t) : st === t)
              )
            );
            
            if (hasTypeInBlock) {
              console.log(`⚠️ Page has @type in schema but normalizeSchemaTypes didn't detect: ${result.url}`);
              console.log(`  Missing types: ${missingImportantTypes.join(', ')}`);
              console.log(`  Schema @types found: ${schemaTypesInBlocks.join(', ')}`);
              console.log(`  Detected types: ${pageTypesArray.slice(0, 15).join(', ')}${pageTypesArray.length > 15 ? '...' : ''}`);
              // Log first schema block structure for debugging
              if (result.schemas[0]) {
                console.log(`  First schema sample:`, JSON.stringify(result.schemas[0]).substring(0, 400));
              }
            }
          }
        }
        
        // Check rich result eligibility
        const pageEligible = detectRichResultEligibility(pageTypesArray);
        RICH_RESULT_TYPES.forEach(type => {
          if (pageEligible[type]) {
            richEligible[type] = true;
          }
        });
      } else {
        // No inline schema - store empty array
        pageSchemaTypesMap.set(result.url, []);
        // Check if we should look for inherited schema
        const parentUrl = getParentCollectionPageUrl(result.url);
        if (parentUrl) {
          pagesNeedingInheritanceCheck.push({
            url: result.url,
            parentUrl: parentUrl
          });
        }
      }
    });
    
    console.log(`📊 After first pass (inline schema check):`);
    console.log(`  Pages with inline schema: ${pagesWithSchema}`);
    console.log(`  Pages needing inheritance check: ${pagesNeedingInheritanceCheck.length}`);
    console.log(`  Pages without inline and without parent: ${totalPages - pagesWithSchema - pagesNeedingInheritanceCheck - errors.length}`);
    
    // Second pass: check for inherited schema (only for pages without inline schema)
    let inheritanceResults = [];
    if (pagesNeedingInheritanceCheck.length > 0) {
      console.log(`Checking ${pagesNeedingInheritanceCheck.length} pages for inherited schema from parent collection pages...`);
      const inheritanceCheckSemaphore = new Semaphore(2); // Lower concurrency for parent page checks
      const inheritanceChecks = pagesNeedingInheritanceCheck.map(async ({ url, parentUrl }) => {
        await inheritanceCheckSemaphore.acquire();
        try {
          const hasInherited = await checkInheritedSchema(url, parentUrl);
          return { url, hasInherited };
        } finally {
          inheritanceCheckSemaphore.release();
        }
      });
      
      inheritanceResults = await Promise.all(inheritanceChecks);
      
      // Process inheritance results
      inheritanceResults.forEach(({ url, hasInherited }) => {
        if (hasInherited) {
          pagesWithInheritedSchema++;
          // Note: inherited schema doesn't contribute to schemaTypes count
          // as it's from the parent page, not this page
        }
      });
      
      console.log(`Found ${pagesWithInheritedSchema} pages with inherited schema`);
    }
    
    // Build lookup for inheritance results
    const inheritanceMap = new Map();
    inheritanceResults.forEach(({ url, hasInherited }) => {
      inheritanceMap.set(url, hasInherited);
    });
    
    // Build complete list of pages without schema
    // A page is missing schema if: no inline schema AND (no parent page OR parent page check returned false)
    const missingSchemaPages = [];
    let pagesWithoutInline = 0;
    let pagesWithParentButNoInherited = 0;
    let pagesWithoutParent = 0;
    let pagesWithParentButNotChecked = 0;
    
    // Build a set of all URLs that were checked for inheritance
    const checkedUrls = new Set(inheritanceResults.map(r => r.url));
    
    // Track all pages for diagnostic purposes
    let successfulPages = 0;
    let failedPages = 0;
    let pagesWithSchemasArray = [];
    let pagesWithoutSchemasArray = [];
    
    results.forEach(result => {
      if (!result.success) {
        // Failed crawls = pages without schema (can't verify if they have schema)
        failedPages++;
        pagesWithoutInline++; // Count failed as without inline schema
        pagesWithoutSchemasArray.push(result.url);
        missingSchemaPages.push({ 
          url: result.url, 
          parentUrl: null,
          error: result.error || 'Crawl failed'
        });
        return;
      }
      successfulPages++;
      const hasInlineSchema = result.schemas && result.schemas.length > 0;
      
      if (hasInlineSchema) {
        pagesWithSchemasArray.push(result.url);
      } else {
        pagesWithoutInline++;
        pagesWithoutSchemasArray.push(result.url);
        const parentUrl = getParentCollectionPageUrl(result.url);
        if (parentUrl) {
          // Has parent page - check if it got inherited schema
          if (!checkedUrls.has(result.url)) {
            // This page has a parent but wasn't checked - this shouldn't happen
            console.warn(`⚠ Page ${result.url} has parent ${parentUrl} but was not checked for inheritance`);
            pagesWithParentButNotChecked++;
            missingSchemaPages.push({ url: result.url, parentUrl: parentUrl });
          } else {
            const hasInherited = inheritanceMap.get(result.url);
            if (hasInherited === undefined) {
              // Page was checked but result not in map - this is an error
              console.warn(`⚠ Page ${result.url} was checked for inheritance but result not in map`);
              missingSchemaPages.push({ url: result.url, parentUrl: parentUrl });
            } else if (!hasInherited) {
              // No inline schema and no inherited schema - missing
              pagesWithParentButNoInherited++;
              missingSchemaPages.push({ url: result.url, parentUrl: parentUrl });
            }
          }
        } else {
          // No inline schema and no parent page to check - definitely missing
          pagesWithoutParent++;
          missingSchemaPages.push({ url: result.url, parentUrl: null });
        }
      }
    });
    
    // Additional diagnostic logging
    console.log(`📊 Detailed page analysis:`);
    console.log(`  Successful pages: ${successfulPages}`);
    console.log(`  Failed pages: ${failedPages}`);
    console.log(`  Pages with schemas: ${pagesWithSchemasArray.length}`);
    console.log(`  Pages without schemas: ${pagesWithoutSchemasArray.length}`);
    if (pagesWithoutSchemasArray.length > 0 && pagesWithoutSchemasArray.length <= 10) {
      console.log(`  URLs without schemas: ${pagesWithoutSchemasArray.join(', ')}`);
    }
    
    console.log(`📊 Missing schema analysis:`);
    console.log(`  Total pages: ${totalPages}`);
    console.log(`  Pages with inline schema: ${pagesWithSchema}`);
    console.log(`  Pages without inline schema: ${pagesWithoutInline} (includes ${failedPages} failed crawls)`);
    console.log(`  Pages with inherited schema: ${pagesWithInheritedSchema}`);
    console.log(`  Pages with parent but no inherited: ${pagesWithParentButNoInherited}`);
    console.log(`  Pages with parent but not checked: ${pagesWithParentButNotChecked}`);
    console.log(`  Pages without parent page: ${pagesWithoutParent} (includes ${failedPages} failed crawls)`);
    console.log(`  Total missing schema pages: ${missingSchemaPages.length} (includes ${failedPages} failed crawls)`);
    console.log(`  Expected missing: ${totalPages - pagesWithSchema - pagesWithInheritedSchema}`);
    
    // Sanity check: missing pages should equal total - inline - inherited
    const expectedMissing = totalPages - pagesWithSchema - pagesWithInheritedSchema;
    const diagnosticInfo = {
      totalPages,
      successfulPages,
      failedPages,
      pagesWithInlineSchema: pagesWithSchema,
      pagesWithoutInlineSchema: pagesWithoutInline, // Includes failed crawls
      pagesWithInheritedSchema,
      pagesWithParentButNoInherited,
      pagesWithParentButNotChecked,
      pagesWithoutParent, // Includes failed crawls
      totalMissing: missingSchemaPages.length, // Includes failed crawls
      expectedMissing,
      urlsWithoutSchemas: pagesWithoutSchemasArray.length > 0 && pagesWithoutSchemasArray.length <= 20 
        ? pagesWithoutSchemasArray 
        : (pagesWithoutSchemasArray.length > 20 ? pagesWithoutSchemasArray.slice(0, 20) : []),
      errorTypes: Object.keys(errorTypes).length > 0 ? errorTypes : undefined,
      errorExamples: Object.keys(errorExamples).length > 0 ? errorExamples : undefined,
      note: 'Failed crawls are counted as pages without schema since schema cannot be verified'
    };
    
    if (missingSchemaPages.length !== expectedMissing) {
      console.error(`❌ MISMATCH: missingSchemaPages.length (${missingSchemaPages.length}) != expected (${expectedMissing})`);
      console.error(`  This suggests some pages are being double-counted or missed`);
      diagnosticInfo.mismatch = true;
      diagnosticInfo.mismatchDetails = `missingSchemaPages.length (${missingSchemaPages.length}) != expected (${expectedMissing})`;
    }
    
    // Calculate coverage (pages with inline schema only - inherited doesn't count for coverage)
    const coverage = totalPages > 0 ? (pagesWithSchema / totalPages) * 100 : 0;
    
    // Determine missing types (common types that should be present)
    const commonTypes = ['Organization', 'Person', 'LocalBusiness', 'WebSite', 'BreadcrumbList'];
    const missingTypes = commonTypes.filter(type => !allTypes.has(type));
    
    // Debug: Log all detected types and check for BreadcrumbList and Review
    console.log('🔍 SCHEMA TYPE DETECTION DEBUG:');
    console.log(`  Total unique types detected: ${allTypes.size}`);
    console.log(`  All types: ${Array.from(allTypes).sort().join(', ')}`);
    console.log(`  BreadcrumbList detected: ${allTypes.has('BreadcrumbList') ? 'YES' : 'NO'}`);
    console.log(`  Review detected: ${allTypes.has('Review') ? 'YES' : 'NO'}`);
    console.log(`  Product detected: ${allTypes.has('Product') ? 'YES' : 'NO'}`);
    console.log(`  ImageObject detected: ${allTypes.has('ImageObject') ? 'YES' : 'NO'}`);
    console.log(`  Organization detected: ${allTypes.has('Organization') ? 'YES' : 'NO'}`);
    console.log(`  Schema types counts:`, Object.entries(schemaTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', '));
    console.log(`  Rich result eligibility:`, Object.entries(richEligible)
      .filter(([type, eligible]) => eligible)
      .map(([type]) => type)
      .join(', '));
    console.log(`  Missing rich result types:`, RICH_RESULT_TYPES.filter(type => !richEligible[type]).join(', '));
    
    // Convert schemaTypes to array format, sorted by count (most common first)
    const schemaTypesArray = Object.entries(schemaTypes)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
    
    // Return ALL detected types as an array for accurate calculations
    const allTypesArray = Array.from(allTypes);
    
    // Build pages array with metadata (title, metaDescription) and schema types for all crawled pages
    const pages = results.map(result => ({
      url: result.url,
      title: result.title || null,
      metaDescription: result.metaDescription || null,
      hasSchema: result.success && result.schemas && result.schemas.length > 0,
      hasInheritedSchema: result.success && !result.schemas?.length && inheritanceMap.get(result.url) === true,
      schemaTypes: pageSchemaTypesMap.get(result.url) || [],
      error: result.success ? null : (result.error || null)
    }));
    
    return res.status(200).json({
      status: 'ok',
      source: 'schema-audit',
      data: {
        totalPages,
        pagesWithSchema, // Pages with inline schema
        pagesWithInheritedSchema, // Pages with inherited schema only
        coverage: Math.round(coverage * 100) / 100, // Coverage based on inline schema only
        schemaTypes: schemaTypesArray, // All types sorted by count (most common first)
        allDetectedTypes: allTypesArray, // ALL detected types for accurate calculation (same as schemaTypes but as array of strings)
        missingTypes: missingTypes.length > 0 ? missingTypes : undefined,
        missingSchemaCount: missingSchemaPages.length,
        missingSchemaPages: missingSchemaPages.length > 0 ? missingSchemaPages : undefined,
        richEligible,
        errors: errors.length > 0 ? errors : undefined,
        pages // Array of all pages with metadata (title, metaDescription)
      },
      meta: {
        generatedAt: new Date().toISOString(),
        urlsScanned: totalPages,
        urlsWithSchema: pagesWithSchema,
        urlsWithInheritedSchema: pagesWithInheritedSchema,
        diagnostic: diagnosticInfo
      }
    });
    
  } catch (error) {
    console.error('Error in schema-audit:', error);
    return res.status(500).json({
      status: 'error',
      source: 'schema-audit',
      message: error.message || 'Unknown error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

