/**
 * Backlink Metrics API
 * 
 * Stub for future backlink/Authority integration.
 * 
 * v1: Returns placeholder structure.
 * Future batches will implement:
 * - Ahrefs API integration
 * - Semrush API integration
 * - Moz API integration
 * - Domain rating calculations
 * - Referring domain analysis
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
      source: 'backlink-metrics',
      message: 'Method not allowed. Use GET.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    const { property } = req.query;
    
    if (!property) {
      return res.status(400).json({
        status: 'error',
        source: 'backlink-metrics',
        message: 'Missing required parameter: property',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    // STUB: Return placeholder structure
    // This will be implemented in a later batch with actual backlink APIs
    return res.status(200).json({
      status: 'ok',
      source: 'backlink-metrics',
      params: { property },
      data: {
        totalReferringDomains: null,
        totalBacklinks: null,
        avgDomainRating: null,
        notes: 'Backlink metrics API not connected yet; this is a stub. Do not use placeholder values for Authority pillar scoring.'
      },
      meta: { generatedAt: new Date().toISOString() }
    });
    
  } catch (error) {
    console.error('Error in backlink-metrics:', error);
    return res.status(500).json({
      status: 'error',
      source: 'backlink-metrics',
      message: error.message || 'Unknown error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

