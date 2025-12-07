/**
 * Local test script for backlink CSV parsing
 * Run with: node test-backlink-parsing.js <path-to-csv-file>
 */

import fs from 'fs';
import path from 'path';

// Copy the parsing functions from backlink-metrics.js
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

function extractUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  
  // Find first http(s) substring
  const match = raw.match(/https?:\/\/\S+/);
  if (!match) return null;
  
  // Trim trailing ) or ] or other closing brackets
  return match[0].replace(/[)\]]+$/, '');
}

function findColumn(rows, patterns) {
  if (!rows || rows.length === 0) return null;
  
  const columns = Object.keys(rows[0]);
  console.log('Available columns:', columns);
  console.log('Patterns to match:', patterns);
  
  for (const pattern of patterns) {
    const normalizedPattern = pattern.toLowerCase()
      .replace(/[+\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const patternWords = normalizedPattern.split(/\s+/).filter(w => w.length > 0);
    
    for (const col of columns) {
      const normalizedCol = col.toLowerCase()
        .replace(/[+\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      const matches = patternWords.every(word => normalizedCol.includes(word));
      console.log(`  Checking "${col}" (normalized: "${normalizedCol}") against pattern "${pattern}" (normalized: "${normalizedPattern}"): ${matches}`);
      
      if (matches) {
        console.log(`  ✓ Found matching column: "${col}" for pattern "${pattern}"`);
        return col;
      }
    }
  }
  
  console.log('  ✗ No matching column found');
  return null;
}

function isFollow(linkTypeRaw) {
  if (!linkTypeRaw || typeof linkTypeRaw !== 'string') return false;
  
  const t = linkTypeRaw.toLowerCase().replace(/\s+/g, '');
  return t.includes('follow') && !t.includes('no');
}

// Main test function
function testCsvParsing(csvPath) {
  console.log(`\n=== Testing CSV Parsing: ${csvPath} ===\n`);
  
  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }
  
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  console.log(`CSV file size: ${csvContent.length} bytes`);
  console.log(`First 500 chars:\n${csvContent.substring(0, 500)}\n`);
  
  // Parse CSV - handle multi-line quoted fields properly
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
  
  console.log(`Total logical lines: ${lines.length}`);
  
  if (lines.length === 0) {
    console.error('CSV is empty');
    process.exit(1);
  }
  
  // Parse header
  const headerLine = lines[0];
  const headers = parseCsvLine(headerLine).map(h => h.trim().replace(/^"|"$/g, ''));
  console.log(`\nHeaders (${headers.length}):`, headers);
  console.log(`Header line: "${headerLine}"\n`);
  
  // Parse first few data rows
  const rows = [];
  const maxRows = Math.min(5, lines.length - 1);
  for (let i = 1; i <= maxRows; i++) {
    const line = lines[i];
    if (!line) continue;
    
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
    
    console.log(`Row ${i}:`, JSON.stringify(row, null, 2).substring(0, 500));
  }
  
  if (rows.length === 0) {
    console.error('No data rows parsed');
    process.exit(1);
  }
  
  // Test column finding
  console.log('\n=== Testing Column Matching ===\n');
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
  
  const linkTypeColumn = findColumn(rows, [
    'Link Type',
    'LinkType',
    'Type',
    'Follow Type',
    'FollowType',
    'Follow'
  ]);
  
  console.log(`\nURL Column: ${urlColumn || 'NOT FOUND'}`);
  console.log(`Link Type Column: ${linkTypeColumn || 'NOT FOUND'}\n`);
  
  if (!urlColumn || !linkTypeColumn) {
    console.error('Required columns not found!');
    process.exit(1);
  }
  
  // Test URL extraction and processing
  console.log('=== Testing URL Extraction ===\n');
  const domains = new Set();
  let total = 0;
  let followCount = 0;
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const urlField = row[urlColumn];
    
    console.log(`Row ${i}:`);
    console.log(`  URL Field: "${urlField?.substring(0, 100)}"`);
    
    if (!urlField) {
      console.log(`  ✗ No URL field`);
      continue;
    }
    
    const url = extractUrl(urlField);
    console.log(`  Extracted URL: ${url || 'NOT FOUND'}`);
    
    if (!url) {
      console.log(`  ✗ Could not extract URL`);
      continue;
    }
    
    let hostname = null;
    try {
      hostname = new URL(url).hostname;
      console.log(`  Hostname: ${hostname}`);
    } catch (e) {
      console.log(`  ✗ Invalid URL: ${e.message}`);
      continue;
    }
    
    domains.add(hostname);
    total += 1;
    
    const linkType = row[linkTypeColumn];
    const isFollowLink = isFollow(linkType);
    console.log(`  Link Type: "${linkType}", isFollow: ${isFollowLink}`);
    
    if (isFollowLink) {
      followCount += 1;
    }
    console.log('');
  }
  
  console.log(`\n=== Results ===`);
  console.log(`Total valid backlinks: ${total}`);
  console.log(`Unique domains: ${domains.size}`);
  console.log(`Follow links: ${followCount}`);
  console.log(`Follow ratio: ${total > 0 ? (followCount / total).toFixed(2) : 0}`);
  console.log(`Domains:`, Array.from(domains));
}

// Run test
const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node test-backlink-parsing.js <path-to-csv-file>');
  process.exit(1);
}

testCsvParsing(csvPath);

