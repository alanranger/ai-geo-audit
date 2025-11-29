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
 */
function normalizeSchemaTypes(schemaObject) {
  const types = [];
  const typeValue = schemaObject['@type'];
  
  if (typeValue) {
    if (Array.isArray(typeValue)) {
      types.push(...typeValue.filter(t => t && typeof t === 'string'));
    } else if (typeof typeValue === 'string') {
      types.push(typeValue);
    }
  }
  
  return types;
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
  
  // Parse CSV - extract URLs from first column (skip header)
  const lines = csvContent.split('\n').filter(line => line.trim());
  const urls = [];
  
  for (let i = 1; i < lines.length; i++) { // Skip header row
    const line = lines[i].trim();
    if (!line) continue; // Skip empty rows
    
    // Parse CSV line (handle quoted values)
    const match = line.match(/^"?(https?:\/\/[^,"]+)"?/);
    if (match) {
      urls.push(match[1].replace(/^"|"$/g, ''));
    } else {
      // Fallback: split by comma and take first column
      const columns = line.split(',');
      const url = columns[0]?.trim().replace(/^"|"$/g, '');
      if (url && url.startsWith('http')) {
        urls.push(url);
      }
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      source: 'schema-audit',
      message: 'Method not allowed. Use GET.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    // Parse CSV and get URLs
    const urls = await parseCsvUrls();
    
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
    
    // Aggregate results
    const totalPages = results.length;
    let pagesWithSchema = 0;
    const schemaTypes = {};
    const allTypes = new Set();
    const errors = [];
    const richEligible = {};
    
    // Initialize rich eligible map
    RICH_RESULT_TYPES.forEach(type => {
      richEligible[type] = false;
    });
    
    results.forEach(result => {
      if (!result.success) {
        errors.push({
          url: result.url,
          error: result.error
        });
        return;
      }
      
      if (result.schemas.length === 0) {
        return; // No schema on this page
      }
      
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
    });
    
    // Calculate coverage
    const coverage = totalPages > 0 ? (pagesWithSchema / totalPages) * 100 : 0;
    
    // Determine missing types (common types that should be present)
    const commonTypes = ['Organization', 'Person', 'LocalBusiness', 'WebSite', 'BreadcrumbList'];
    const missingTypes = commonTypes.filter(type => !allTypes.has(type));
    
    // Convert schemaTypes to array format
    const schemaTypesArray = Object.entries(schemaTypes)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
    
    return res.status(200).json({
      status: 'ok',
      source: 'schema-audit',
      data: {
        totalPages,
        pagesWithSchema,
        coverage: Math.round(coverage * 100) / 100,
        schemaTypes: schemaTypesArray,
        missingTypes: missingTypes.length > 0 ? missingTypes : undefined,
        richEligible,
        errors: errors.length > 0 ? errors : undefined
      },
      meta: {
        generatedAt: new Date().toISOString(),
        urlsScanned: totalPages,
        urlsWithSchema: pagesWithSchema
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

