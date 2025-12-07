/**
 * Backlink Metrics API
 * 
 * Accepts CSV uploads of backlink data, computes metrics, and stores them as JSON.
 * 
 * GET: Returns stored backlink metrics from data/backlink-metrics.json
 * POST: Accepts CSV body, parses it, computes metrics, and stores them
 * 
 * CSV Format:
 * - "Linking Page + URL" column: Contains page title and URL (extract first http(s):// URL)
 * - "Link Type" column: Values like DoFollow, Dofollow, Follow, Nofollow (case-insensitive)
 */

import fs from 'fs/promises';
import path from 'path';
// Use custom CSV parser (same as schema-audit.js) to avoid dependency issues

const METRICS_FILE = path.join(process.cwd(), 'data', 'backlink-metrics.json');

/**
 * Parse CSV line with proper quote handling (same as schema-audit.js)
 */
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

/**
 * Extract URL from "Linking Page + URL" field (or similar column names)
 * Finds first http(s):// substring and trims trailing brackets/parentheses
 * Handles various column name variations
 */
function extractUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  
  // Find first http(s) substring
  const match = raw.match(/https?:\/\/\S+/);
  if (!match) return null;
  
  // Trim trailing ) or ] or other closing brackets
  return match[0].replace(/[)\]]+$/, '');
}

/**
 * Check if link type is a follow link (not nofollow)
 * Handles various formats: DoFollow, Dofollow, Follow, Nofollow, etc.
 */
function isFollow(linkTypeRaw) {
  if (!linkTypeRaw || typeof linkTypeRaw !== 'string') return false;
  
  const t = linkTypeRaw.toLowerCase().replace(/\s+/g, '');
  // Must contain "follow" but not "no"
  return t.includes('follow') && !t.includes('no');
}

/**
 * Find column name that matches the pattern (case-insensitive, flexible matching)
 */
function findColumn(rows, patterns) {
  if (!rows || rows.length === 0) return null;
  
  // Get all column names from first row
  const columns = Object.keys(rows[0]);
  
  // Try to find a column that matches any of the patterns
  for (const pattern of patterns) {
    const lowerPattern = pattern.toLowerCase();
    for (const col of columns) {
      const lowerCol = col.toLowerCase();
      // Check if column contains all words from pattern
      const patternWords = lowerPattern.split(/\s+/);
      if (patternWords.every(word => lowerCol.includes(word))) {
        return col;
      }
    }
  }
  
  return null;
}

/**
 * Compute backlink metrics from CSV rows
 */
function computeBacklinkMetrics(rows) {
  if (!rows || rows.length === 0) {
    return {
      referringDomains: 0,
      totalBacklinks: 0,
      followRatio: 0, // No data = 0, not 0.5
      generatedAt: new Date().toISOString()
    };
  }

  // Find the URL column (try various possible names)
  const urlColumn = findColumn(rows, [
    'Linking Page + URL',
    'Linking Page',
    'URL',
    'Source URL',
    'Linking URL',
    'Page URL'
  ]);
  
  // Find the link type column (try various possible names)
  const linkTypeColumn = findColumn(rows, [
    'Link Type',
    'Type',
    'Follow Type',
    'Link Type',
    'Follow'
  ]);

  console.log('Found columns:', Object.keys(rows[0]));
  console.log('URL column:', urlColumn);
  console.log('Link Type column:', linkTypeColumn);

  if (!urlColumn) {
    throw new Error(`Could not find URL column. Available columns: ${Object.keys(rows[0]).join(', ')}`);
  }

  if (!linkTypeColumn) {
    throw new Error(`Could not find Link Type column. Available columns: ${Object.keys(rows[0]).join(', ')}. The Link Type column is required to calculate the follow ratio for the Authority score.`);
  }

  const domains = new Set();
  let total = 0;
  let followCount = 0;

  for (const row of rows) {
    const urlField = row[urlColumn];
    const url = extractUrl(urlField);
    
    if (!url) continue; // Skip rows without valid URLs

    let hostname = null;
    try {
      hostname = new URL(url).hostname;
    } catch (e) {
      // Invalid URL, skip
      continue;
    }

    domains.add(hostname);
    total += 1;

    // Link Type column is required - check it
    const linkType = row[linkTypeColumn];
    if (isFollow(linkType)) {
      followCount += 1;
    }
  }

  const referringDomains = domains.size;
  const totalBacklinks = total;
  // Calculate follow ratio only if we have backlinks
  // If no backlinks, followRatio is 0 (not 0.5) since there's no data to calculate from
  const followRatio = totalBacklinks > 0 ? followCount / totalBacklinks : 0;

  return {
    referringDomains,
    totalBacklinks,
    followRatio,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Read backlink metrics from file, return default if missing
 */
async function readBacklinkMetrics() {
  try {
    const content = await fs.readFile(METRICS_FILE, 'utf8');
    const metrics = JSON.parse(content);
    return metrics;
  } catch (error) {
    // File doesn't exist or invalid - return safe default (no data = 0)
    // This is for when no CSV has been uploaded yet
    return {
      referringDomains: 0,
      totalBacklinks: 0,
      followRatio: 0, // No data = 0, not 0.5
      generatedAt: null
    };
  }
}

/**
 * Write backlink metrics to file
 */
async function writeBacklinkMetrics(metrics) {
  try {
    // Ensure data directory exists
    const dataDir = path.dirname(METRICS_FILE);
    await fs.mkdir(dataDir, { recursive: true });
    
    // Write metrics
    await fs.writeFile(METRICS_FILE, JSON.stringify(metrics, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error writing backlink metrics:', error);
    return false;
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

  // GET: Return stored metrics
  if (req.method === 'GET') {
    try {
      const metrics = await readBacklinkMetrics();
      return res.status(200).json({
        status: 'ok',
        source: 'backlink-metrics',
        data: metrics,
        meta: { generatedAt: new Date().toISOString() }
      });
    } catch (error) {
      console.error('Error reading backlink metrics:', error);
      return res.status(500).json({
        status: 'error',
        source: 'backlink-metrics',
        message: error.message || 'Unknown error',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
  }

  // POST: Accept CSV and compute metrics
  if (req.method === 'POST') {
    try {
      // Get CSV content from request body
      let csvContent;
      
      console.log('POST request received');
      console.log('Content-Type:', req.headers['content-type']);
      console.log('Body type:', typeof req.body);
      console.log('Body is Buffer:', Buffer.isBuffer(req.body));
      console.log('Body length:', req.body ? (typeof req.body === 'string' ? req.body.length : 'not string') : 'null/undefined');
      
      if (req.headers['content-type']?.includes('multipart/form-data')) {
        // Handle multipart form data (file upload)
        // This is a simplified version - in production you might want to use a library like multer
        return res.status(400).json({
          status: 'error',
          source: 'backlink-metrics',
          message: 'Multipart form data not yet supported. Send CSV as raw text/csv body.',
          meta: { generatedAt: new Date().toISOString() }
        });
      } else {
        // Raw CSV body (text/csv or text/plain)
        // In Vercel, req.body might be a string or buffer for text/csv
        csvContent = req.body;
        
        // If body is a Buffer, convert to string
        if (Buffer.isBuffer(csvContent)) {
          csvContent = csvContent.toString('utf8');
          console.log('Converted Buffer to string, length:', csvContent.length);
        }
        
        // If body is an object, try to get the CSV from a field
        if (typeof csvContent === 'object' && csvContent !== null && !Buffer.isBuffer(csvContent)) {
          csvContent = csvContent.csv || csvContent.data || csvContent.body || '';
          console.log('Extracted from object, length:', typeof csvContent === 'string' ? csvContent.length : 'not string');
        }
        
        // Convert to string if needed
        if (typeof csvContent !== 'string') {
          csvContent = String(csvContent);
          console.log('Converted to string, length:', csvContent.length);
        }
      }

      if (!csvContent || csvContent.trim().length === 0) {
        console.error('CSV content is empty or missing');
        return res.status(400).json({
          status: 'error',
          source: 'backlink-metrics',
          message: 'Missing CSV content in request body',
          meta: { generatedAt: new Date().toISOString() }
        });
      }
      
      console.log('CSV content received, length:', csvContent.length);
      console.log('First 200 chars:', csvContent.substring(0, 200));

      // Parse CSV using custom parser (same approach as schema-audit.js)
      let rows = [];
      try {
        const lines = csvContent.split('\n').filter(line => line.trim());
        if (lines.length === 0) {
          throw new Error('CSV is empty');
        }
        
        // Parse header row
        const headerLine = lines[0].trim();
        const headers = parseCsvLine(headerLine).map(h => h.trim().replace(/^"|"$/g, ''));
        
        console.log('CSV headers:', headers);
        
        // Parse data rows
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          const columns = parseCsvLine(line);
          const row = {};
          
          headers.forEach((header, index) => {
            row[header] = columns[index] ? columns[index].trim().replace(/^"|"$/g, '') : '';
          });
          
          rows.push(row);
        }
        
        console.log(`Parsed ${rows.length} rows from CSV`);
      } catch (parseError) {
        console.error('CSV parse error:', parseError);
        return res.status(400).json({
          status: 'error',
          source: 'backlink-metrics',
          message: `CSV parsing failed: ${parseError.message}`,
          meta: { generatedAt: new Date().toISOString() }
        });
      }

      if (!rows || rows.length === 0) {
        // Empty CSV - return default metrics (no data = 0)
        const defaultMetrics = {
          referringDomains: 0,
          totalBacklinks: 0,
          followRatio: 0, // No data = 0, not 0.5
          generatedAt: new Date().toISOString()
        };
        
        await writeBacklinkMetrics(defaultMetrics);
        
        return res.status(200).json({
          status: 'ok',
          source: 'backlink-metrics',
          data: defaultMetrics,
          meta: { generatedAt: new Date().toISOString() }
        });
      }

      // Compute metrics
      const metrics = computeBacklinkMetrics(rows);

      // Write to file
      const writeSuccess = await writeBacklinkMetrics(metrics);
      
      if (!writeSuccess) {
        return res.status(500).json({
          status: 'error',
          source: 'backlink-metrics',
          message: 'Failed to write metrics to file',
          meta: { generatedAt: new Date().toISOString() }
        });
      }

      return res.status(200).json({
        status: 'ok',
        source: 'backlink-metrics',
        data: metrics,
        meta: { generatedAt: new Date().toISOString() }
      });

    } catch (error) {
      console.error('Error in backlink-metrics POST:', error);
      return res.status(500).json({
        status: 'error',
        source: 'backlink-metrics',
        message: error.message || 'Unknown error',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
  }

  // Method not allowed
  return res.status(405).json({
    status: 'error',
    source: 'backlink-metrics',
    message: 'Method not allowed. Use GET or POST.',
    meta: { generatedAt: new Date().toISOString() }
  });
}
