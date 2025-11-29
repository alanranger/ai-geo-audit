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
    const GITHUB_CSV_URL = process.env.GITHUB_CSV_URL || 
      "https://raw.githubusercontent.com/alanranger/alan-shared-resources/main/csv/06-site-urls.csv";
    
    // Fallback to hosted CSV if GitHub fetch fails
    const FALLBACK_CSV_URL = process.env.CSV_URL || 
      "https://schema-tools-six.vercel.app/06-site-urls.csv";
    
    console.log("🔄 Fetching CSV from GitHub:", GITHUB_CSV_URL);
    
    let csvText = '';
    let csvUrl = GITHUB_CSV_URL;
    let source = 'github';
    
    // Try GitHub first
    try {
      const response = await fetch(GITHUB_CSV_URL);
      
      if (response.ok) {
        csvText = await response.text();
        console.log("✓ CSV fetched from GitHub successfully");
      } else {
        throw new Error(`GitHub fetch failed: HTTP ${response.status}`);
      }
    } catch (githubError) {
      console.warn("⚠ GitHub fetch failed, trying fallback:", githubError.message);
      
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
            githubError: githubError.message,
            fallbackError: fallbackError.message
          },
          suggestion: 'Please ensure the CSV exists in the GitHub repository or the hosted location is accessible.',
          meta: { generatedAt: new Date().toISOString() }
        });
      }
    }
    
    // Parse CSV and count URLs
    const lines = csvText.split('\n').filter(line => line.trim());
    let urlCount = 0;
    
    // Count URLs (skip header row, count lines with valid URLs)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Check if line contains a URL
      const match = line.match(/^"?(https?:\/\/[^,"]+)"?/);
      if (match) {
        urlCount++;
      } else {
        // Fallback: check first column for URL
        const columns = line.split(',');
        const url = columns[0]?.trim().replace(/^"|"$/g, '');
        if (url && url.startsWith('http')) {
          urlCount++;
        }
      }
    }
    
    console.log(`✓ CSV parsed: ${urlCount} URLs found from ${source}`);
    
    return res.status(200).json({
      status: 'ok',
      message: `CSV fetched successfully from ${source}`,
      csvUrl,
      source,
      data: {
        totalUrls: urlCount,
        csvSize: csvText.length,
        linesProcessed: lines.length - 1, // Exclude header
        fetchedAt: new Date().toISOString()
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

