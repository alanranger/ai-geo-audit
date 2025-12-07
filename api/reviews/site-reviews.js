/**
 * Site Reviews API
 * 
 * Returns Trustpilot review snapshot metrics for Authority score calculation.
 * Uses a fixed snapshot (rating 4.6, count 610) instead of dynamic data.
 * 
 * This is a hard-coded snapshot. Update the values below when Trustpilot metrics change significantly.
 */

// Trustpilot Snapshot Configuration
const TRUSTPILOT_SNAPSHOT = {
  rating: 4.6,   // Trustpilot current average
  count: 610,     // Total Trustpilot reviews at snapshot time
  snapshotDate: '2025-12-07', // Date when this snapshot was taken
  notes: 'Fixed Trustpilot snapshot for Authority score calculation. Update manually when Trustpilot metrics change significantly.'
};

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
    // Return Trustpilot snapshot (hard-coded values)
    return res.status(200).json({
      status: 'ok',
      data: {
        siteRating: TRUSTPILOT_SNAPSHOT.rating,
        siteReviewCount: TRUSTPILOT_SNAPSHOT.count,
        lastUpdated: TRUSTPILOT_SNAPSHOT.snapshotDate,
        notes: TRUSTPILOT_SNAPSHOT.notes
      },
      meta: { 
        generatedAt: new Date().toISOString(),
        source: 'trustpilot-snapshot'
      }
    });

  } catch (error) {
    console.error('[Site Reviews] Error:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unknown error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

