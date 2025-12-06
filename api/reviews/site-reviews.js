/**
 * Site Reviews API
 * 
 * Returns on-site review metrics (from testimonials/Trustpilot).
 * Currently reads from a static JSON file, but can be extended to fetch from a database or external API.
 */

import fs from 'fs';
import path from 'path';

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
    // Read the static JSON file
    // In Vercel serverless, we need to use process.cwd() or __dirname equivalent
    const filePath = path.join(process.cwd(), 'data', 'site-reviews.json');
    
    let siteReviews;
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      siteReviews = JSON.parse(fileContent);
    } catch (fileError) {
      // If file doesn't exist, return default values
      console.warn('[Site Reviews] Could not read site-reviews.json, using defaults:', fileError.message);
      siteReviews = {
        siteRating: 0,
        siteReviewCount: 0,
        lastUpdated: new Date().toISOString().split('T')[0],
        notes: 'Default values - site-reviews.json not found'
      };
    }

    return res.status(200).json({
      status: 'ok',
      data: {
        siteRating: siteReviews.siteRating || 0,
        siteReviewCount: siteReviews.siteReviewCount || 0,
        lastUpdated: siteReviews.lastUpdated || null,
        notes: siteReviews.notes || null
      },
      meta: { generatedAt: new Date().toISOString() }
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

