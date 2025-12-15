/**
 * Minimal test endpoint to verify Vercel function execution
 */

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
      message: 'Method not allowed. Use GET.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    console.log('[test-endpoint] Function invoked successfully');
    
    return res.status(200).json({
      status: 'ok',
      message: 'Test endpoint working',
      timestamp: new Date().toISOString(),
      meta: { generatedAt: new Date().toISOString() }
    });
  } catch (error) {
    console.error('[test-endpoint] Error:', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      details: error.message,
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}



