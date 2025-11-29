/**
 * CSV Sync API Endpoint
 * 
 * Triggers CSV sync from alan-shared-resources to verify CSV is accessible.
 * In a serverless environment, this verifies the CSV can be fetched from the source.
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
    // Verify the hosted CSV is accessible
    const CSV_URL = process.env.CSV_URL || "https://schema-tools-six.vercel.app/06-site-urls.csv";
    
    console.log("🔄 Verifying CSV sync - checking hosted CSV:", CSV_URL);
    
    const response = await fetch(CSV_URL);
    
    if (!response.ok) {
      return res.status(500).json({
        status: 'error',
        message: `Hosted CSV not accessible: HTTP ${response.status}`,
        csvUrl: CSV_URL,
        suggestion: 'Please ensure the CSV has been synced to the hosted location.',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    const csvText = await response.text();
    const lines = csvText.split('\n').filter(line => line.trim());
    const urlCount = Math.max(0, lines.length - 1); // Subtract header row
    
    return res.status(200).json({
      status: 'ok',
      message: 'CSV sync verified successfully',
      csvUrl: CSV_URL,
      data: {
        totalUrls: urlCount,
        csvSize: csvText.length,
        lastVerified: new Date().toISOString()
      },
      meta: { generatedAt: new Date().toISOString() }
    });
    
  } catch (error) {
    console.error('Error verifying CSV sync:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to verify CSV sync',
      suggestion: 'Please run "npm run sync:csv" locally to sync the CSV, or ensure CSV_URL environment variable is set correctly.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

