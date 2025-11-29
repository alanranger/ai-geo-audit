/**
 * Entity Extract API
 * 
 * Future entity and topic extraction endpoint.
 * 
 * v1: Scaffold only - returns placeholder result.
 * Future batches will implement:
 * - NLP entity extraction (Google Cloud Natural Language API, etc.)
 * - Topic modeling
 * - Keyword extraction
 * - Salience scoring
 */

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Only allow POST requests (text content in body)
  if (req.method !== 'POST') {
    return res.status(405).json({
      status: 'error',
      source: 'entity-extract',
      message: 'Method not allowed. Use POST.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    const { text } = req.body;
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({
        status: 'error',
        source: 'entity-extract',
        message: 'Missing or invalid parameter: text (string required in POST body)',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    // STUB: Return placeholder structure
    // This will be implemented in a later batch with actual NLP
    return res.status(200).json({
      status: 'ok',
      source: 'entity-extract',
      data: {
        entities: [
          { name: 'Alan Ranger', type: 'Person', salience: 0.95 },
          { name: 'landscape photography', type: 'Topic', salience: 0.88 }
        ],
        keywords: ['landscape photography', 'workshops', 'lessons'],
        notes: 'Entity extraction not yet implemented. This is static sample output. Do not use for production calculations.'
      },
      meta: { generatedAt: new Date().toISOString() }
    });
    
  } catch (error) {
    console.error('Error in entity-extract:', error);
    return res.status(500).json({
      status: 'error',
      source: 'entity-extract',
      message: error.message || 'Unknown error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

