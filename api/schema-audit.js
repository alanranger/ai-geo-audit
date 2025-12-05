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
  'Recipe'
];

/**
 * Extract all JSON-LD blocks from HTML
 */
function extractJsonLd(htmlString) {
  const jsonLdBlocks = [];
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
  const matches = [...htmlString.matchAll(jsonLdRegex)];
  
  for (const match of matches) {
    const jsonText = match[1].trim();
    const parsed = safeJsonParse(jsonText);
    if (parsed) {
      // Handle both single objects and arrays
      if (Array.isArray(parsed)) {
        jsonLdBlocks.push(...parsed);
      } else {
        jsonLdBlocks.push(parsed);
      }
    }
  }
  
  return jsonLdBlocks;
}

/**
 * Normalize schema types from a schema object
 * Returns array of @type values
 * Walks @graph and common nested properties to detect all types
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

  function walk(node) {
    if (!node || typeof node !== 'object') return;

    // 1) Top-level @type for this node
    addType(node['@type']);

    // 2) Any items in @graph
    if (Array.isArray(node['@graph'])) {
      node['@graph'].forEach(child => walk(child));
    }

    // 3) Common nested properties that often contain Person/Organization
    const nestedKeys = ['author', 'creator', 'publisher', 'provider', 'performer', 'brand'];

    nestedKeys.forEach(key => {
      const value = node[key];

      if (!value) return;

      if (Array.isArray(value)) value.forEach(v => walk(v));
      else walk(value);
    });
  }

  walk(schemaObject);

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
    const schemas = extractJsonLd(html);
    
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
 * Crawl a single URL with concurrency control
 */
async function crawlUrl(url, semaphore) {
  await semaphore.acquire();
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AI-GEO-Audit/1.0; +https://ai-geo-audit.vercel.app)'
      },
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    
    if (!response.ok) {
      return {
        url,
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        schemas: []
      };
    }
    
    const html = await response.text();
    const schemas = extractJsonLd(html);
    
    return {
      url,
      success: true,
      schemas
    };
  } catch (error) {
    return {
      url,
      success: false,
      error: error.message || 'Unknown error',
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
    
    // Crawl URLs with concurrency limit of 4
    const semaphore = new Semaphore(4);
    const crawlPromises = urls.map(url => crawlUrl(url, semaphore));
    const results = await Promise.all(crawlPromises);
    
    // Aggregate results - first pass: check inline schema
    const totalPages = results.length;
    let pagesWithSchema = 0;
    let pagesWithInheritedSchema = 0;
    const schemaTypes = {};
    const allTypes = new Set();
    const errors = [];
    const richEligible = {};
    const pagesNeedingInheritanceCheck = []; // URLs without inline schema
    
    console.log(`📊 Starting schema audit aggregation:`);
    console.log(`  Total pages crawled: ${totalPages}`);
    console.log(`  Successful crawls: ${results.filter(r => r.success).length}`);
    console.log(`  Failed crawls: ${results.filter(r => !r.success).length}`);
    
    // Initialize rich eligible map
    RICH_RESULT_TYPES.forEach(type => {
      richEligible[type] = false;
    });
    
    // First pass: check for inline schema
    results.forEach(result => {
      if (!result.success) {
        errors.push({
          url: result.url,
          error: result.error
        });
        return;
      }
      
      const hasInlineSchema = result.schemas.length > 0;
      
      if (hasInlineSchema) {
        pagesWithSchema++;
        
        // Collect all types from this page
        const pageTypes = new Set();
        result.schemas.forEach(schema => {
          const types = normalizeSchemaTypes(schema);
          types.forEach(type => {
            pageTypes.add(type);
            allTypes.add(type);
            schemaTypes[type] = (schemaTypes[type] || 0) + 1;
          });
        });
        
        // Check rich result eligibility
        const pageTypesArray = Array.from(pageTypes);
        const pageEligible = detectRichResultEligibility(pageTypesArray);
        RICH_RESULT_TYPES.forEach(type => {
          if (pageEligible[type]) {
            richEligible[type] = true;
          }
        });
      } else {
        // No inline schema - check if we should look for inherited schema
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
    
    results.forEach(result => {
      if (!result.success) return;
      const hasInlineSchema = result.schemas.length > 0;
      if (!hasInlineSchema) {
        pagesWithoutInline++;
        const parentUrl = getParentCollectionPageUrl(result.url);
        if (parentUrl) {
          // Has parent page - check if it got inherited schema
          const hasInherited = inheritanceMap.get(result.url);
          if (hasInherited === undefined) {
            // Page was in pagesNeedingInheritanceCheck but result not in map - this is an error
            console.warn(`⚠ Page ${result.url} was checked for inheritance but result not in map`);
            missingSchemaPages.push({ url: result.url, parentUrl: parentUrl });
          } else if (!hasInherited) {
            // No inline schema and no inherited schema - missing
            pagesWithParentButNoInherited++;
            missingSchemaPages.push({ url: result.url, parentUrl: parentUrl });
          }
        } else {
          // No inline schema and no parent page to check - definitely missing
          pagesWithoutParent++;
          missingSchemaPages.push({ url: result.url, parentUrl: null });
        }
      }
    });
    
    console.log(`📊 Missing schema analysis:`);
    console.log(`  Total pages: ${totalPages}`);
    console.log(`  Pages with inline schema: ${pagesWithSchema}`);
    console.log(`  Pages without inline schema: ${pagesWithoutInline}`);
    console.log(`  Pages with inherited schema: ${pagesWithInheritedSchema}`);
    console.log(`  Pages with parent but no inherited: ${pagesWithParentButNoInherited}`);
    console.log(`  Pages without parent page: ${pagesWithoutParent}`);
    console.log(`  Total missing schema pages: ${missingSchemaPages.length}`);
    console.log(`  Expected missing: ${totalPages - pagesWithSchema - pagesWithInheritedSchema}`);
    
    // Sanity check: missing pages should equal total - inline - inherited
    const expectedMissing = totalPages - pagesWithSchema - pagesWithInheritedSchema;
    if (missingSchemaPages.length !== expectedMissing) {
      console.error(`❌ MISMATCH: missingSchemaPages.length (${missingSchemaPages.length}) != expected (${expectedMissing})`);
      console.error(`  This suggests some pages are being double-counted or missed`);
    }
    
    // Calculate coverage (pages with inline schema only - inherited doesn't count for coverage)
    const coverage = totalPages > 0 ? (pagesWithSchema / totalPages) * 100 : 0;
    
    // Determine missing types (common types that should be present)
    const commonTypes = ['Organization', 'Person', 'LocalBusiness', 'WebSite', 'BreadcrumbList'];
    const missingTypes = commonTypes.filter(type => !allTypes.has(type));
    
    // Convert schemaTypes to array format, limit to top 10
    const schemaTypesArray = Object.entries(schemaTypes)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    return res.status(200).json({
      status: 'ok',
      source: 'schema-audit',
      data: {
        totalPages,
        pagesWithSchema, // Pages with inline schema
        pagesWithInheritedSchema, // Pages with inherited schema only
        coverage: Math.round(coverage * 100) / 100, // Coverage based on inline schema only
        schemaTypes: schemaTypesArray,
        missingTypes: missingTypes.length > 0 ? missingTypes : undefined,
        missingSchemaCount: missingSchemaPages.length,
        missingSchemaPages: missingSchemaPages.length > 0 ? missingSchemaPages : undefined,
        richEligible,
        errors: errors.length > 0 ? errors : undefined
      },
      meta: {
        generatedAt: new Date().toISOString(),
        urlsScanned: totalPages,
        urlsWithSchema: pagesWithSchema,
        urlsWithInheritedSchema: pagesWithInheritedSchema
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

