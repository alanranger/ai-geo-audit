/**
 * Schema Coverage API
 * 
 * Basic schema coverage scanner for the domain.
 * Scans specified URLs for JSON-LD schema markup and returns coverage statistics.
 * 
 * v1: Simple detection and counting - no heavy validation.
 */

import { safeJsonParse } from './utils.js';

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
      source: 'schema-coverage',
      message: 'Method not allowed. Use GET.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    const { property, urls } = req.query;
    
    if (!property) {
      return res.status(400).json({
        status: 'error',
        source: 'schema-coverage',
        message: 'Missing required parameter: property',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    // Parse URLs - either from query param or use default key pages
    let urlList = [];
    
    if (urls) {
      // Comma-separated list from query param
      urlList = urls.split(',').map(u => u.trim()).filter(u => u);
    } else {
      // Default: key pages based on property domain
      const domain = property.replace(/^https?:\/\//, '').replace(/\/$/, '');
      urlList = [
        `${domain}/`,
        `${domain}/blog`,
        `${domain}/lessons`,
        `${domain}/workshops`,
        `${domain}/about`
      ];
    }
    
    if (urlList.length === 0) {
      return res.status(400).json({
        status: 'error',
        source: 'schema-coverage',
        message: 'No URLs to scan. Provide urls query param or ensure default URLs are valid.',
        meta: { generatedAt: new Date().toISOString() }
      });
    }
    
    // Normalize URLs - ensure they have protocol
    urlList = urlList.map(url => {
      if (!url.match(/^https?:\/\//)) {
        return `https://${url}`;
      }
      return url;
    });
    
    const pagesScanned = urlList.length;
    let pagesWithSchema = 0;
    const typeCounts = {};
    const errors = [];
    
    // Scan each URL
    for (const url of urlList) {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; AI-GEO-Audit/1.0; +https://ai-geo-audit.vercel.app)'
          },
          // Timeout after 10 seconds
          signal: AbortSignal.timeout(10000)
        });
        
        if (!response.ok) {
          errors.push({
            url,
            errorType: 'http-error',
            message: `HTTP ${response.status}: ${response.statusText}`
          });
          continue;
        }
        
        const html = await response.text();
        
        // Extract all JSON-LD script blocks
        const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
        const matches = [...html.matchAll(jsonLdRegex)];
        
        if (matches.length === 0) {
          // No schema found on this page
          continue;
        }
        
        pagesWithSchema++;
        
        // Parse each JSON-LD block
        for (const match of matches) {
          const jsonText = match[1].trim();
          const parsed = safeJsonParse(jsonText);
          
          if (!parsed) {
            errors.push({
              url,
              errorType: 'json-parse',
              message: 'Failed to parse JSON-LD block'
            });
            continue;
          }
          
          // Handle both single objects and arrays
          const schemas = Array.isArray(parsed) ? parsed : [parsed];
          
          for (const schema of schemas) {
            // Extract @type (can be string or array)
            const types = Array.isArray(schema['@type']) ? schema['@type'] : [schema['@type']];
            
            for (const type of types) {
              if (type && typeof type === 'string') {
                typeCounts[type] = (typeCounts[type] || 0) + 1;
              }
            }
          }
        }
        
      } catch (error) {
        errors.push({
          url,
          errorType: error.name === 'TimeoutError' ? 'timeout' : 'fetch-error',
          message: error.message || 'Unknown error fetching URL'
        });
      }
    }
    
    // Convert type counts to array format
    const types = Object.entries(typeCounts)
      .map(([type, pages]) => ({ type, pages }))
      .sort((a, b) => b.pages - a.pages);
    
    const coveragePercent = pagesScanned > 0 ? Math.round((pagesWithSchema / pagesScanned) * 100 * 100) / 100 : 0;
    
    return res.status(200).json({
      status: 'ok',
      source: 'schema-coverage',
      params: { property, urls: urlList },
      data: {
        pagesScanned,
        pagesWithSchema,
        coveragePercent: Math.round(coveragePercent * 100) / 100,
        types,
        errors: errors.length > 0 ? errors : undefined
      },
      meta: { generatedAt: new Date().toISOString() }
    });
    
  } catch (error) {
    console.error('Error in schema-coverage:', error);
    return res.status(500).json({
      status: 'error',
      source: 'schema-coverage',
      message: error.message || 'Unknown error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

