/**
 * CSV Sync API Endpoint
 * 
 * Fetches CSV directly from GitHub (alan-shared-resources repository).
 * This provides the latest CSV without requiring local sync steps.
 */

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow GET and POST requests
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed. Use GET or POST.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    // Fetch CSV directly from GitHub
    // Try different possible branch names (main, master, or default branch)
    const GITHUB_CSV_URL = process.env.GITHUB_CSV_URL || 
      "https://raw.githubusercontent.com/alanranger/alan-shared-resources/main/csv/06-site-urls.csv";
    
    // Alternative URLs to try if main fails
    const GITHUB_CSV_URL_MASTER = "https://raw.githubusercontent.com/alanranger/alan-shared-resources/master/csv/06-site-urls.csv";
    
    // Fallback to hosted CSV if GitHub fetch fails
    const FALLBACK_CSV_URL = process.env.CSV_URL || 
      "https://schema-tools-six.vercel.app/06-site-urls.csv";
    
    console.log("🔄 Fetching CSV from GitHub:", GITHUB_CSV_URL);
    
    let csvText = '';
    let csvUrl = GITHUB_CSV_URL;
    let source = 'github';
    const githubAttempts = [];
    
    // Try GitHub first (source of truth) - try main branch, then master
    let githubFetchError = null;
    const githubUrls = [GITHUB_CSV_URL, GITHUB_CSV_URL_MASTER];
    
    for (const githubUrl of githubUrls) {
      try {
        console.log(`Attempting to fetch from: ${githubUrl}`);
        const response = await fetch(githubUrl, {
          headers: {
            'Accept': 'text/csv',
            'User-Agent': 'AI-GEO-Audit/1.0',
            'Cache-Control': 'no-cache'
          }
        });
        
        console.log(`GitHub response status: ${response.status} ${response.statusText}`);
        
        if (response.ok) {
          csvText = await response.text();
          githubAttempts.push({ url: githubUrl, status: response.status, ok: true });
          const lineCount = csvText.split('\n').filter(l => l.trim()).length;
          console.log(`✓ CSV fetched from GitHub successfully (${csvText.length} bytes, ${lineCount} lines)`);
          
          // Verify it's the right file - should have ~434 lines
          if (lineCount < 100) {
            console.warn(`⚠ Warning: GitHub CSV has only ${lineCount} lines, expected ~434. File may be incorrect.`);
          } else if (lineCount > 500) {
            console.warn(`⚠ Warning: GitHub CSV has ${lineCount} lines, expected ~434. File may be incorrect.`);
          }
          
          // Success - break out of loop
          break;
        } else if (response.status === 404) {
          // 404 could mean: file doesn't exist, wrong branch, or repository is private
          const errorText = await response.text().catch(() => '');
          githubAttempts.push({ url: githubUrl, status: response.status, ok: false, error: errorText.substring(0, 120) });
          console.warn(`GitHub fetch 404 for ${githubUrl} - file not found or repository may be private`);
          if (errorText.includes('Not Found') || errorText.includes('404')) {
            githubFetchError = new Error(`GitHub repository may be private or file path incorrect. HTTP 404 - Cannot access raw.githubusercontent.com for private repositories.`);
          } else {
            githubFetchError = new Error(`GitHub fetch failed: HTTP 404 - ${errorText.substring(0, 100)}`);
          }
          // Continue to next URL
          continue;
        } else {
          const errorText = await response.text().catch(() => '');
          githubAttempts.push({ url: githubUrl, status: response.status, ok: false, error: errorText.substring(0, 120) });
          console.warn(`GitHub fetch failed for ${githubUrl}: HTTP ${response.status}`);
          if (errorText) {
            console.warn(`Response: ${errorText.substring(0, 200)}`);
          }
          githubFetchError = new Error(`GitHub fetch failed: HTTP ${response.status} - ${errorText.substring(0, 100)}`);
          // Continue to next URL
          continue;
        }
      } catch (error) {
        console.warn(`GitHub fetch error for ${githubUrl}:`, error.message);
        githubAttempts.push({ url: githubUrl, status: 'fetch_error', ok: false, error: error.message });
        githubFetchError = error;
        // Continue to next URL
        continue;
      }
    }
    
    // If all GitHub URLs failed, try fallback
    if (!csvText) {
      console.error("❌ All GitHub fetch attempts failed");
      if (githubFetchError) {
        console.error("❌ Last error:", githubFetchError.message);
        console.error("❌ Error details:", githubFetchError.stack);
      }
      console.warn("⚠ Trying fallback hosted CSV (may be outdated/corrupted)");
      
      // Fallback to hosted CSV
      try {
        const fallbackResponse = await fetch(FALLBACK_CSV_URL);
        if (fallbackResponse.ok) {
          csvText = await fallbackResponse.text();
          csvUrl = FALLBACK_CSV_URL;
          source = 'hosted';
          console.log("✓ CSV fetched from fallback location");
        } else {
          throw new Error(`Fallback fetch failed: HTTP ${fallbackResponse.status}`);
        }
      } catch (fallbackError) {
        return res.status(500).json({
          status: 'error',
          message: 'Failed to fetch CSV from both GitHub and fallback location',
          details: {
            githubError: githubFetchError ? githubFetchError.message : 'Unknown GitHub error',
            githubAttempts,
            fallbackError: fallbackError.message
          },
          suggestion: 'Please ensure the CSV exists in the GitHub repository or the hosted location is accessible.',
          meta: { generatedAt: new Date().toISOString() }
        });
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
    
    // Helper to split CSV into logical lines (handles quoted newlines)
    function splitCsvLines(csvContent) {
      const lines = [];
      let currentLine = '';
      let inQuotes = false;
      
      for (let i = 0; i < csvContent.length; i++) {
        const char = csvContent[i];
        const nextChar = csvContent[i + 1];
        
        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            currentLine += '"';
            i++; // Skip escaped quote
          } else {
            inQuotes = !inQuotes;
            currentLine += char;
          }
        } else if (char === '\n' && !inQuotes) {
          if (currentLine.trim()) {
            lines.push(currentLine.trim());
          }
          currentLine = '';
        } else {
          currentLine += char;
        }
      }
      
      if (currentLine.trim()) {
        lines.push(currentLine.trim());
      }
      
      return lines;
    }
    
    // Parse CSV and count URLs
    const lines = csvText.split('\n').filter(line => line.trim());
    console.log(`📊 CSV has ${lines.length} total lines`);
    
    // Parse header row to find URL column index
    let urlColumnIndex = 0; // Default to first column
    let headers = [];
    if (lines.length > 0) {
      const headerLine = lines[0].trim();
      headers = parseCsvLine(headerLine);
      // Strip UTF-8 BOM if present on first header
      if (headers.length > 0) {
        headers[0] = headers[0].replace(/^\uFEFF/, '');
      }
      console.log(`📋 CSV headers: ${headers.join(', ')}`);
      const urlHeaderIndex = headers.findIndex(h => h.toLowerCase() === 'url');
      if (urlHeaderIndex !== -1) {
        urlColumnIndex = urlHeaderIndex;
        console.log(`✓ Found 'url' column at index ${urlColumnIndex}`);
      } else {
        console.log(`⚠ 'url' column not found in headers, using first column (index 0)`);
        // Try to find any column that might contain URLs
        for (let i = 0; i < headers.length; i++) {
          const header = headers[i].toLowerCase();
          if (header.includes('url') || header.includes('link') || header.includes('href')) {
            urlColumnIndex = i;
            console.log(`✓ Using column '${headers[i]}' at index ${i} as URL column`);
            break;
          }
        }
      }
    }
    
    let urlCount = 0;
    let sampleUrls = [];
    let skippedCount = 0;
    let errorCount = 0;
    
    // Count URLs (skip header row)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      try {
        const columns = parseCsvLine(line);
        
        // Debug first few lines
        if (i <= 3) {
          console.log(`Line ${i}: ${columns.length} columns, column[${urlColumnIndex}]: "${columns[urlColumnIndex]?.substring(0, 60)}"`);
        }
        
        if (columns[urlColumnIndex] !== undefined && columns[urlColumnIndex] !== null) {
          const url = columns[urlColumnIndex].trim().replace(/^"|"$/g, '');
          if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
            urlCount++;
            if (sampleUrls.length < 3) {
              sampleUrls.push(url);
            }
          } else if (url && url.length > 0) {
            // Log first few non-URL values to debug
            if (skippedCount < 5) {
              console.log(`⚠ Line ${i}: Skipped non-URL value in column ${urlColumnIndex}: "${url.substring(0, 80)}"`);
              skippedCount++;
            }
          }
        } else {
          // Column doesn't exist or is empty
          if (errorCount < 3) {
            console.log(`⚠ Line ${i}: Column ${urlColumnIndex} is missing or empty. Total columns: ${columns.length}`);
            errorCount++;
          }
        }
      } catch (e) {
        // Skip malformed lines
        if (errorCount < 3) {
          console.log(`⚠ Error parsing line ${i}: ${e.message}`);
          errorCount++;
        }
        continue;
      }
    }
    
    console.log(`✓ Found ${urlCount} URLs out of ${lines.length - 1} data lines`);
    if (sampleUrls.length > 0) {
      console.log(`  Sample URLs: ${sampleUrls.join(', ')}`);
    }
    
    // Guard: if fallback hosted CSV yields too few URLs, treat as invalid
    if (source === 'hosted' && urlCount < 100) {
      console.error(`❌ Hosted CSV appears invalid: only ${urlCount} URLs found (expected ~500).`);
      return res.status(500).json({
        status: 'error',
        message: 'Hosted CSV looks invalid (too few URLs found).',
        details: {
          source,
          csvUrl,
          totalUrls: urlCount,
          linesProcessed: lines.length - 1,
          githubError: githubFetchError ? githubFetchError.message : 'Unknown GitHub error',
          githubAttempts
        },
        suggestion: 'Use GitHub CSV or upload manually. Hosted CSV may contain non-URL data.',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    console.log(`✓ CSV parsed: ${urlCount} URLs found from ${source}`);
    
    // Attempt to fetch backlink CSV from GitHub and compute unique domains
    let backlinkDomains = null;
    let backlinkRows = null;
    let backlinkSource = null;
    let backlinkError = null;
    try {
      const BACKLINK_CSV_URL = process.env.GITHUB_BACKLINK_CSV_URL ||
        "https://raw.githubusercontent.com/alanranger/alan-shared-resources/main/csv/alanranger.com_-backlink-data%20(2).csv";
      const BACKLINK_CSV_URL_MASTER =
        "https://raw.githubusercontent.com/alanranger/alan-shared-resources/master/csv/alanranger.com_-backlink-data%20(2).csv";
      
      const backlinkUrls = [BACKLINK_CSV_URL, BACKLINK_CSV_URL_MASTER];
      let backlinkCsvText = '';
      for (const backlinkUrl of backlinkUrls) {
        const backlinkResponse = await fetch(backlinkUrl, {
          headers: {
            'Accept': 'text/csv',
            'User-Agent': 'AI-GEO-Audit/1.0',
            'Cache-Control': 'no-cache'
          }
        });
        if (backlinkResponse.ok) {
          backlinkCsvText = await backlinkResponse.text();
          backlinkSource = backlinkUrl;
          break;
        }
      }
      
      if (backlinkCsvText) {
        const backlinkLines = splitCsvLines(backlinkCsvText);
        if (backlinkLines.length > 1) {
          const backlinkHeaders = parseCsvLine(backlinkLines[0]).map(h => h.trim().replace(/^"|"$/g, ''));
          let linkColIndex = 0;
          const linkHeaderIndex = backlinkHeaders.findIndex(h => h.toLowerCase().includes('linking page'));
          if (linkHeaderIndex !== -1) {
            linkColIndex = linkHeaderIndex;
          }
          
          const domains = new Set();
          for (let i = 1; i < backlinkLines.length; i++) {
            const cols = parseCsvLine(backlinkLines[i]);
            const cell = cols[linkColIndex] ? cols[linkColIndex].trim().replace(/^"|"$/g, '') : '';
            if (!cell) continue;
            const matches = cell.match(/https?:\/\/[^\s"]+/g) || [];
            for (const urlStr of matches) {
              try {
                const hostname = new URL(urlStr).hostname.replace(/^www\./, '');
                if (hostname) domains.add(hostname);
              } catch (e) {
                // Ignore invalid URLs
              }
            }
          }
          
          backlinkDomains = domains.size;
          backlinkRows = backlinkLines.length - 1;
        }
      } else {
        backlinkError = 'Backlink CSV not available from GitHub.';
      }
    } catch (e) {
      backlinkError = e.message || String(e);
    }
    
    return res.status(200).json({
      status: 'ok',
      message: `CSV fetched successfully from ${source}`,
      csvUrl,
      source,
      data: {
        totalUrls: urlCount,
        csvSize: csvText.length,
        linesProcessed: lines.length - 1, // Exclude header
        fetchedAt: new Date().toISOString(),
        backlinkDomains,
        backlinkRows,
        backlinkSource,
        backlinkError
      },
      meta: { generatedAt: new Date().toISOString() }
    });
    
  } catch (error) {
    console.error('Error fetching CSV:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to fetch CSV',
      suggestion: 'Please check that the CSV exists in the GitHub repository.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

