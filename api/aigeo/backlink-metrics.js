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
 * Handles special characters like +, -, etc.
 */
function findColumn(rows, patterns) {
  if (!rows || rows.length === 0) return null;
  
  // Get all column names from first row
  const columns = Object.keys(rows[0]);
  console.log('Available columns for matching:', columns);
  console.log('Patterns to match:', patterns);
  
  // Try to find a column that matches any of the patterns
  for (const pattern of patterns) {
    // Normalize pattern: lowercase, replace special chars with spaces, then split
    const normalizedPattern = pattern.toLowerCase()
      .replace(/[+\-]/g, ' ')  // Replace + and - with spaces
      .replace(/\s+/g, ' ')     // Normalize multiple spaces
      .trim();
    const patternWords = normalizedPattern.split(/\s+/).filter(w => w.length > 0);
    
    for (const col of columns) {
      // Normalize column name the same way
      const normalizedCol = col.toLowerCase()
        .replace(/[+\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Check if column contains all words from pattern (order doesn't matter)
      const matches = patternWords.every(word => normalizedCol.includes(word));
      console.log(`  Checking "${col}" (normalized: "${normalizedCol}") against pattern "${pattern}" (normalized: "${normalizedPattern}"): ${matches}`);
      
      if (matches) {
        console.log(`  ✓ Found matching column: "${col}" for pattern "${pattern}"`);
        return col;
      }
    }
  }
  
  console.log('  ✗ No matching column found for patterns:', patterns);
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
  // Note: "Linking Page + URL" has a plus sign, so we need flexible matching
  const urlColumn = findColumn(rows, [
    'Linking Page + URL',
    'Linking Page +URL',
    'Linking Page+ URL',
    'Linking Page+URL',
    'Linking Page',
    'URL',
    'Source URL',
    'Linking URL',
    'Page URL',
    'Linking Page URL'
  ]);
  
  // Find the link type column (try various possible names)
  const linkTypeColumn = findColumn(rows, [
    'Link Type',
    'LinkType',
    'Type',
    'Follow Type',
    'FollowType',
    'Follow'
  ]);

  console.log('Found columns:', Object.keys(rows[0]));
  console.log('All column names (exact):', JSON.stringify(Object.keys(rows[0])));
  console.log('URL column:', urlColumn);
  console.log('Link Type column:', linkTypeColumn);

  if (!urlColumn) {
    const availableCols = Object.keys(rows[0]);
    throw new Error(`Could not find URL column. Available columns: ${availableCols.join(', ')}. Looking for columns containing "linking" and "url" or just "url".`);
  }

  if (!linkTypeColumn) {
    const availableCols = Object.keys(rows[0]);
    throw new Error(`Could not find Link Type column. Available columns: ${availableCols.join(', ')}. The Link Type column is required to calculate the follow ratio for the Authority score. Looking for columns containing "link" and "type" or just "type".`);
  }

  const domains = new Set();
  let total = 0;
  let followCount = 0;
  let skippedNoUrl = 0;
  let skippedInvalidUrl = 0;

  console.log(`Processing ${rows.length} rows...`);
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const urlField = row[urlColumn];
    
    if (!urlField) {
      skippedNoUrl++;
      if (i < 3) console.log(`Row ${i}: No URL field value`);
      continue;
    }
    
    const url = extractUrl(urlField);
    
    if (!url) {
      skippedNoUrl++;
      if (i < 3) console.log(`Row ${i}: Could not extract URL from: "${urlField.substring(0, 100)}"`);
      continue; // Skip rows without valid URLs
    }

    let hostname = null;
    try {
      hostname = new URL(url).hostname;
      if (i < 3) console.log(`Row ${i}: Extracted URL: ${url}, hostname: ${hostname}`);
    } catch (e) {
      skippedInvalidUrl++;
      if (i < 3) console.log(`Row ${i}: Invalid URL format: ${url}, error: ${e.message}`);
      // Invalid URL, skip
      continue;
    }

    domains.add(hostname);
    total += 1;

    // Link Type column is required - check it
    const linkType = row[linkTypeColumn];
    const isFollowLink = isFollow(linkType);
    if (isFollowLink) {
      followCount += 1;
    }
    if (i < 3) console.log(`Row ${i}: Link type: "${linkType}", isFollow: ${isFollowLink}`);
  }
  
  console.log(`Processing complete: ${total} valid backlinks, ${domains.size} unique domains, ${followCount} follow links`);
  console.log(`Skipped: ${skippedNoUrl} no URL, ${skippedInvalidUrl} invalid URL`);

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
    // Try to read from /tmp first (Vercel writable location), then fallback to original path
    let content = null;
    try {
      const tmpFile = path.join('/tmp', 'backlink-metrics.json');
      content = await fs.readFile(tmpFile, 'utf8');
    } catch (tmpError) {
      try {
        content = await fs.readFile(METRICS_FILE, 'utf8');
      } catch (fileError) {
        // File doesn't exist or can't be read - this is expected if no CSV uploaded yet
        // Return null silently (no error log) - caller will handle with default values
        return null;
      }
    }
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
    // Vercel serverless functions have read-only filesystem (except /tmp)
    // Store in /tmp instead, or skip file write and return data directly
    // For now, skip file write - data is returned in response and can be stored client-side
    try {
      const tmpFile = path.join('/tmp', 'backlink-metrics.json');
      await fs.writeFile(tmpFile, JSON.stringify(metrics, null, 2), 'utf8');
      console.log(`[Backlink Metrics] Saved to ${tmpFile}`);
    } catch (writeError) {
      // File write is optional - data is still returned in response
      console.warn(`[Backlink Metrics] Could not write to file (read-only filesystem): ${writeError.message}`);
      console.log(`[Backlink Metrics] Data returned in response - can be stored client-side`);
    }
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
        // CSV body - can be sent as JSON (preferred) or raw text/csv
        // Vercel automatically parses JSON bodies, but not text/csv
        if (req.headers['content-type']?.includes('application/json')) {
          // JSON body - extract CSV from 'csv' field
          csvContent = req.body?.csv || req.body?.data || req.body?.body || '';
          console.log('Extracted CSV from JSON body, length:', csvContent.length);
        } else {
          // Raw CSV body (text/csv or text/plain) - Vercel might not parse this
          csvContent = req.body;
          
          if (typeof csvContent === 'string') {
            console.log('Body is already a string, length:', csvContent.length);
          } else if (Buffer.isBuffer(csvContent)) {
            csvContent = csvContent.toString('utf8');
            console.log('Converted Buffer to string, length:', csvContent.length);
          } else if (typeof csvContent === 'object' && csvContent !== null) {
            csvContent = csvContent.csv || csvContent.data || csvContent.body || '';
            console.log('Extracted from object, length:', typeof csvContent === 'string' ? csvContent.length : 'not string');
          } else {
            csvContent = String(csvContent || '');
            console.log('Converted to string, length:', csvContent.length);
          }
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
      
      // Strip UTF-8 BOM if present at start
      if (csvContent.charCodeAt(0) === 0xFEFF) {
        csvContent = csvContent.slice(1);
        console.log('Stripped UTF-8 BOM from CSV content');
      }

      // Parse CSV - handle multi-line quoted fields properly
      let rows = [];
      try {
        // First, we need to properly handle multi-line quoted fields
        // Split by lines but respect quoted fields that span multiple lines
        const lines = [];
        let currentLine = '';
        let inQuotes = false;
        
        for (let i = 0; i < csvContent.length; i++) {
          const char = csvContent[i];
          const nextChar = csvContent[i + 1];
          
          if (char === '"') {
            if (inQuotes && nextChar === '"') {
              // Escaped quote
              currentLine += '"';
              i++; // Skip next quote
            } else {
              // Toggle quote state
              inQuotes = !inQuotes;
              currentLine += char;
            }
          } else if (char === '\n' && !inQuotes) {
            // End of line (and not inside quotes)
            if (currentLine.trim()) {
              lines.push(currentLine.trim());
            }
            currentLine = '';
          } else {
            currentLine += char;
          }
        }
        
        // Add last line if any
        if (currentLine.trim()) {
          lines.push(currentLine.trim());
        }
        
        if (lines.length === 0) {
          throw new Error('CSV is empty');
        }
        
        // Parse header row
        const headerLine = lines[0];
        const headers = parseCsvLine(headerLine).map(h => h.trim().replace(/^"|"$/g, ''));
        if (headers.length > 0) {
          headers[0] = headers[0].replace(/^\uFEFF/, '');
        }
        
        console.log('CSV headers:', headers);
        console.log('Total lines in CSV:', lines.length);
        
        // Parse data rows
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          
          try {
            const columns = parseCsvLine(line);
            
            // Ensure we have the right number of columns
            if (columns.length !== headers.length) {
              console.warn(`Row ${i}: Column count mismatch. Expected ${headers.length}, got ${columns.length}`);
              // Pad or truncate as needed
              while (columns.length < headers.length) {
                columns.push('');
              }
              if (columns.length > headers.length) {
                columns = columns.slice(0, headers.length);
              }
            }
            
            const row = {};
            headers.forEach((header, index) => {
              row[header] = columns[index] ? columns[index].trim().replace(/^"|"$/g, '') : '';
            });
            
            rows.push(row);
            
            // Log first few rows for debugging
            if (i <= 3) {
              console.log(`Row ${i}:`, JSON.stringify(row).substring(0, 300));
            }
          } catch (e) {
            console.warn(`Error parsing line ${i}:`, e.message);
            // Continue with next line
          }
        }
        
        console.log(`Parsed ${rows.length} rows from CSV`);
        if (rows.length > 0) {
          console.log('First row keys:', Object.keys(rows[0]));
          console.log('First row sample:', JSON.stringify(rows[0]).substring(0, 400));
        } else {
          console.error('WARNING: No rows parsed from CSV!');
          console.error('CSV content length:', csvContent.length);
          console.error('CSV first 500 chars:', csvContent.substring(0, 500));
          console.error('Number of logical lines:', lines.length);
          
          // Return debug info in response
          return res.status(400).json({
            status: 'error',
            source: 'backlink-metrics',
            message: 'No rows parsed from CSV',
            debug: {
              csvLength: csvContent.length,
              logicalLines: lines.length,
              firstChars: csvContent.substring(0, 500),
              headers: headers || []
            },
            meta: { generatedAt: new Date().toISOString() }
          });
        }
      } catch (parseError) {
        console.error('CSV parse error:', parseError);
        console.error('Error stack:', parseError.stack);
        return res.status(400).json({
          status: 'error',
          source: 'backlink-metrics',
          message: `CSV parsing failed: ${parseError.message}`,
          debug: {
            csvLength: csvContent.length,
            firstChars: csvContent.substring(0, 200),
            error: parseError.message
          },
          meta: { generatedAt: new Date().toISOString() }
        });
      }

      if (!rows || rows.length === 0) {
        // This should not happen if parsing succeeded, but handle it anyway
        console.error('ERROR: Rows array is empty after parsing!');
        return res.status(400).json({
          status: 'error',
          source: 'backlink-metrics',
          message: 'No rows parsed from CSV. Check CSV format.',
          debug: {
            csvLength: csvContent.length,
            firstChars: csvContent.substring(0, 500)
          },
          meta: { generatedAt: new Date().toISOString() }
        });
      }

      // Compute metrics
      let metrics;
      try {
        metrics = computeBacklinkMetrics(rows);
        console.log('Computed metrics:', JSON.stringify(metrics));
      } catch (computeError) {
        console.error('Error computing backlink metrics:', computeError);
        return res.status(400).json({
          status: 'error',
          source: 'backlink-metrics',
          message: `Failed to compute metrics: ${computeError.message}`,
          debug: {
            rowCount: rows.length,
            firstRowKeys: rows.length > 0 ? Object.keys(rows[0]) : [],
            error: computeError.message
          },
          meta: { generatedAt: new Date().toISOString() }
        });
      }

      // Note: Vercel serverless functions have read-only filesystem
      // We can't write to files, so we'll store metrics in Supabase or return them directly
      // For now, just return the metrics - they'll be recalculated on each audit
      // TODO: Store in Supabase for persistence across deployments
      
      // Try to write to file (will fail in Vercel, but that's OK - we still return the metrics)
      try {
        await writeBacklinkMetrics(metrics);
        console.log('Metrics written to file (local dev only)');
      } catch (writeError) {
        console.warn('Could not write metrics to file (expected in Vercel):', writeError.message);
        // Continue anyway - metrics are still returned
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
