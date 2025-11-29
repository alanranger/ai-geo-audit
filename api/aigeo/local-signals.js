/**
 * Local Signals API
 * 
 * Stub for Local Entity and Service Area signals.
 * 
 * v1: Returns structured placeholder data.
 * Future batches will implement:
 * - Google Business Profile API integration
 * - LocalBusiness schema scanning
 * - NAP consistency checking
 * - Knowledge panel detection
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
      source: 'local-signals',
      message: 'Method not allowed. Use GET.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    const { property } = req.query;
    
    if (!property) {
      return res.status(400).json({
        status: 'error',
        source: 'local-signals',
        message: 'Missing required parameter: property',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    // STUB: Return placeholder structure
    // This will be implemented in a later batch
    return res.status(200).json({
      status: 'ok',
      source: 'local-signals',
      params: { property },
      data: {
        localBusinessSchemaPages: 0,
        napConsistencyScore: null,  // 0–100 or null
        knowledgePanelDetected: false,
        serviceAreas: [],
        notes: 'Local signals module is stubbed; implement GBP + LocalBusiness scanning in later batch. This is placeholder data - do not use for scoring calculations.'
      },
      meta: { generatedAt: new Date().toISOString() }
    });
    
  } catch (error) {
    console.error('Error in local-signals:', error);
    return res.status(500).json({
      status: 'error',
      source: 'local-signals',
      message: error.message || 'Unknown error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

