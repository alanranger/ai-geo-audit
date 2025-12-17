/**
 * GSC Page-Only Totals API
 * 
 * Fetches true page-only totals from GSC (dimensions: ['page'], filtered to specific page URL)
 * Used for scorecard "Target page totals" tile
 */

import { getGSCAccessToken, normalizePropertyUrl, parseDateRange, getGscDateRange } from './utils.js';

/**
 * Normalize page URL for matching - strips query params, fragments, ensures canonical format
 * Must match the normalization used in audit-dashboard.html
 * This is used for client-side matching after fetching all pages from GSC
 */
function normalizeGscPageUrl(url) {
  if (!url || typeof url !== 'string') return '';
  
  let cleanUrl = url.trim();
  
  // Strip query parameters (srsltid, utm_*, gclid, fbclid, etc.) and fragments
  cleanUrl = cleanUrl.split('?')[0].split('#')[0];
  
  try {
    // Handle relative URLs by adding base URL
    let urlToParse = cleanUrl;
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      // Try to infer domain from common patterns, but this is a fallback
      // In practice, pageUrl should be absolute
      urlToParse = 'https://www.alanranger.com' + (cleanUrl.startsWith('/') ? cleanUrl : '/' + cleanUrl);
    }
    const urlObj = new URL(urlToParse);
    // Use pathname (automatically excludes query params and hash)
    let normalized = urlObj.pathname.toLowerCase().replace(/\/$/, '').trim();
    // If pathname is empty or just '/', treat as homepage
    if (!normalized || normalized === '/') {
      normalized = '/';
    }
    return normalized;
  } catch (e) {
    // If URL parsing fails, use manually cleaned URL
    return cleanUrl.toLowerCase().replace(/\/$/, '').trim() || '/';
  }
}

/**
 * Simple in-memory cache for page totals (10 minute TTL)
 * Key: `${property}:${normalizedPageUrl}:${startDate}:${endDate}`
 */
const pageTotalsCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getCacheKey(property, normalizedPageUrl, startDate, endDate) {
  return `${property}:${normalizedPageUrl}:${startDate}:${endDate}`;
}

function getCachedResult(cacheKey) {
  const cached = pageTotalsCache.get(cacheKey);
  if (!cached) return null;
  
  const age = Date.now() - cached.timestamp;
  if (age > CACHE_TTL_MS) {
    pageTotalsCache.delete(cacheKey);
    return null;
  }
  
  return cached.data;
}

function setCachedResult(cacheKey, data) {
  pageTotalsCache.set(cacheKey, {
    data,
    timestamp: Date.now()
  });
  
  // Clean up old entries periodically (keep cache size reasonable)
  if (pageTotalsCache.size > 1000) {
    const now = Date.now();
    for (const [key, value] of pageTotalsCache.entries()) {
      if (now - value.timestamp > CACHE_TTL_MS) {
        pageTotalsCache.delete(key);
      }
    }
  }
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
      source: 'gsc-page-totals',
      message: 'Method not allowed. Use GET.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    // Parse parameters
    const { property, pageUrl, startDate: startDateParam, endDate: endDateParam } = req.query;
    
    if (!property) {
      return res.status(400).json({
        status: 'error',
        source: 'gsc-page-totals',
        message: 'Missing required parameter: property',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    if (!pageUrl) {
      return res.status(400).json({
        status: 'error',
        source: 'gsc-page-totals',
        message: 'Missing required parameter: pageUrl',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    // Use standardized 28-day window (matching GSC UI)
    // If explicit dates provided, use them; otherwise use 28-day window ending yesterday
    let { startDate, endDate } = startDateParam && endDateParam 
      ? parseDateRange(req) 
      : getGscDateRange({ daysBack: 28, endOffsetDays: 1 });
    
    // Normalize property URL
    const siteUrl = normalizePropertyUrl(property);
    
    // Normalize page URL for matching (client-side comparison)
    const normalizedPageUrl = normalizeGscPageUrl(pageUrl);
    
    // Check cache first
    const cacheKey = getCacheKey(siteUrl, normalizedPageUrl, startDate, endDate);
    const cached = getCachedResult(cacheKey);
    if (cached) {
      return res.status(200).json({
        status: 'ok',
        source: 'gsc-page-totals',
        params: { property: siteUrl, pageUrl, normalizedPageUrl, startDate, endDate },
        data: cached.result,
        debug: cached.debug,
        meta: {
          generatedAt: new Date().toISOString(),
          cached: true
        }
      });
    }
    
    // Get access token
    const accessToken = await getGSCAccessToken();
    const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    
    // OPTION 1: Fetch ALL pages without filter, then match client-side
    // This is more reliable than trying to match exact URLs in the filter
    // GSC may store URLs with different formats (www vs non-www, trailing slash, etc.)
    const pageResponse = await fetch(searchConsoleUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ['page'],
        rowLimit: 5000, // Fetch up to 5000 pages, then match client-side
      }),
    });
    
    if (!pageResponse.ok) {
      const errorData = await pageResponse.json();
      return res.status(pageResponse.status).json({
        status: 'error',
        source: 'gsc-page-totals',
        message: errorData.error?.message || 'Failed to fetch page totals from GSC',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    const pageData = await pageResponse.json();
    
    // Find matching page by comparing normalized URLs
    let matchedRow = null;
    let matchedRowPage = null;
    
    if (pageData.rows && Array.isArray(pageData.rows)) {
      for (const row of pageData.rows) {
        const rowPage = row.keys[0] || '';
        const normalizedRowPage = normalizeGscPageUrl(rowPage);
        
        // Match using normalized paths
        if (normalizedRowPage === normalizedPageUrl) {
          matchedRow = row;
          matchedRowPage = rowPage;
          break;
        }
      }
    }
    
    // Extract metrics from matched row
    let result = {
      page: normalizedPageUrl,
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: 0
    };
    
    if (matchedRow) {
      result = {
        page: matchedRowPage || normalizedPageUrl,
        clicks: matchedRow.clicks || 0,
        impressions: matchedRow.impressions || 0,
        ctr: matchedRow.ctr ? matchedRow.ctr * 100 : 0, // Convert to percentage
        position: matchedRow.position || 0
      };
    }
    
    // Debug info
    const debug = {
      propertyUsed: siteUrl,
      requestedPage: pageUrl,
      normalizedRequestedPage: normalizedPageUrl,
      matchedRowPage: matchedRowPage || null,
      totalPagesFetched: pageData.rows?.length || 0,
      matchFound: !!matchedRow
    };
    
    // Cache the result
    setCachedResult(cacheKey, { result, debug });
    
    return res.status(200).json({
      status: 'ok',
      source: 'gsc-page-totals',
      params: { property: siteUrl, pageUrl, normalizedPageUrl, startDate, endDate },
      data: result,
      debug,
      meta: {
        generatedAt: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Error in gsc-page-totals:', error);
    return res.status(500).json({
      status: 'error',
      source: 'gsc-page-totals',
      message: error.message || 'Unknown error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

