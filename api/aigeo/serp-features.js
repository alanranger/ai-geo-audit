/**
 * SERP Features API
 * 
 * Higher-level SERP feature summary built from GSC searchAppearance data.
 * Transforms raw GSC appearance data into structured feature summaries.
 * 
 * Fetches GSC data directly and transforms searchAppearance dimension.
 */

import { getGSCAccessToken, normalizePropertyUrl, parseDateRange } from './utils.js';

// Map GSC searchAppearance values to simpler keys
const APPEARANCE_MAP = {
  'WEB_RESULTS': 'web_results',
  'RICH_RESULTS': 'rich_result',
  'FEATURED_SNIPPET': 'featured_snippet',
  'IMAGE_RESULTS': 'image_results',
  'VIDEO_RESULTS': 'video_results',
  'NEWS_RESULTS': 'news_results',
  'DISCOVER': 'discover',
  'GOOGLE_NEWS': 'google_news'
};

function normalizeAppearanceKey(rawKey) {
  // Try direct mapping first
  if (APPEARANCE_MAP[rawKey]) {
    return APPEARANCE_MAP[rawKey];
  }
  
  // Convert to lowercase with underscores
  return rawKey.toLowerCase().replace(/\s+/g, '_');
}

function getAppearanceLabel(key) {
  const labels = {
    'web_results': 'Web Results',
    'rich_result': 'Rich Result',
    'featured_snippet': 'Featured Snippet',
    'image_results': 'Image Results',
    'video_results': 'Video Results',
    'news_results': 'News Results',
    'discover': 'Discover',
    'google_news': 'Google News',
    'ai_overview': 'AI Overview',
    'local_pack': 'Local Pack'
  };
  
  return labels[key] || key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

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
      source: 'serp-features',
      message: 'Method not allowed. Use GET.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    const { property, startDate: startDateParam, endDate: endDateParam } = req.query;
    
    if (!property) {
      return res.status(400).json({
        status: 'error',
        source: 'serp-features',
        message: 'Missing required parameter: property',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    // Parse date range
    const { startDate, endDate } = parseDateRange(req);
    
    // Normalize property URL
    const siteUrl = normalizePropertyUrl(property);
    
    // Get access token
    const accessToken = await getGSCAccessToken();
    const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    
    // Get overview totals
    const overviewResponse = await fetch(searchConsoleUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate,
        endDate,
        // No dimensions = aggregate totals
      }),
    });
    
    if (!overviewResponse.ok) {
      const errorText = await overviewResponse.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        errorData = { error: { message: errorText } };
      }
      
      if (overviewResponse.status === 403) {
        return res.status(403).json({
          status: 'error',
          source: 'serp-features',
          message: 'Permission denied',
          details: errorData.error?.message || 'User does not have access to this Search Console property',
          meta: { generatedAt: new Date().toISOString() }
        });
      }
      
      return res.status(overviewResponse.status).json({
        status: 'error',
        source: 'serp-features',
        message: 'Failed to fetch Search Console data',
        details: errorData,
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    const overviewData = await overviewResponse.json();
    const overviewRow = overviewData.rows?.[0] || {};
    const totalImpressions = overviewRow.impressions || 0;
    const totalClicks = overviewRow.clicks || 0;
    
    // Get search appearance data
    const appearanceResponse = await fetch(searchConsoleUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ['searchAppearance'],
        rowLimit: 100,
      }),
    });
    
    const searchAppearance = [];
    if (appearanceResponse.ok) {
      const appearanceData = await appearanceResponse.json();
      if (appearanceData.rows && Array.isArray(appearanceData.rows)) {
        appearanceData.rows.forEach(row => {
          searchAppearance.push({
            appearance: row.keys[0],
            clicks: row.clicks || 0,
            impressions: row.impressions || 0,
            ctr: row.ctr ? row.ctr * 100 : 0,
            position: row.position || 0
          });
        });
      }
    }
    
    const appearances = searchAppearance.map(item => {
      const rawKey = item.appearance;
      const key = normalizeAppearanceKey(rawKey);
      const label = getAppearanceLabel(key);
      const impressions = item.impressions || 0;
      const clicks = item.clicks || 0;
      const ctr = item.ctr || 0;
      const shareOfTotalImpressions = totalImpressions > 0 
        ? (impressions / totalImpressions) * 100 
        : 0;
      
      return {
        key,
        label,
        impressions,
        clicks,
        ctr: Math.round(ctr * 100) / 100,
        shareOfTotalImpressions: Math.round(shareOfTotalImpressions * 100) / 100
      };
    });
    
    // Sort by impressions descending
    appearances.sort((a, b) => b.impressions - a.impressions);
    
    return res.status(200).json({
      status: 'ok',
      source: 'serp-features',
      params: { property, startDate, endDate },
      data: {
        totalImpressions,
        totalClicks,
        appearances
      },
      meta: { generatedAt: new Date().toISOString() }
    });
    
  } catch (error) {
    console.error('Error in serp-features:', error);
    return res.status(500).json({
      status: 'error',
      source: 'serp-features',
      message: error.message || 'Unknown error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

