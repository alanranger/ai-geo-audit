// /api/supabase/query-keywords-citing-url.js
// Query keywords where ai_alan_citations array contains a target URL

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJSON = (res, status, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(obj));
};

// Normalize URL for comparison - handles all URL format variations
function normalizeUrl(url) {
  if (!url) return '';
  let normalized = String(url).toLowerCase().trim();
  
  // Remove protocol
  normalized = normalized.replace(/^https?:\/\//, '');
  
  // Remove www.
  normalized = normalized.replace(/^www\./, '');
  
  // Remove query params and hash
  normalized = normalized.split('?')[0].split('#')[0];
  
  // Extract path portion (everything after domain, or entire string if no domain)
  // Handle both absolute URLs (with domain) and relative paths (with/without leading slash)
  let path = normalized;
  const domainMatch = normalized.match(/^[^\/]+(\/.*)?$/);
  if (domainMatch && normalized.includes('/')) {
    // Has domain - extract path
    path = normalized.split('/').slice(1).join('/');
  } else if (normalized.startsWith('/')) {
    // Relative path with leading slash
    path = normalized.substring(1);
  }
  // If no leading slash and no domain, it's already just the path
  
  // Remove leading and trailing slashes
  path = path.replace(/^\/+/, '').replace(/\/+$/, '');
  
  return path;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return sendJSON(res, 405, { error: `Method not allowed. Expected: GET` });
  }

  try {
    const { property_url, target_url, audit_date } = req.query;
    
    if (!property_url || !target_url) {
      return sendJSON(res, 400, { error: 'property_url and target_url are required' });
    }
    
    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Normalize target URL
    const targetUrlNormalized = normalizeUrl(target_url);
    
    // Get latest audit date if not provided
    let auditDateToUse = audit_date;
    if (!auditDateToUse) {
      const { data: latestAudit, error: auditError } = await supabase
        .from('audit_results')
        .select('audit_date')
        .eq('property_url', property_url)
        .order('audit_date', { ascending: false })
        .limit(1)
        .single();
      
      if (auditError || !latestAudit) {
        return sendJSON(res, 404, { 
          status: 'error',
          error: 'No audit found for property URL' 
        });
      }
      
      auditDateToUse = latestAudit.audit_date;
    }

    // Get ranking_ai_data from audit_results table (where the data is actually stored)
    const { data: auditRecord, error: auditError } = await supabase
      .from('audit_results')
      .select('ranking_ai_data')
      .eq('property_url', property_url)
      .eq('audit_date', auditDateToUse)
      .order('audit_date', { ascending: false })
      .limit(1)
      .single();

    if (auditError || !auditRecord) {
      return sendJSON(res, 404, { 
        status: 'error',
        error: 'No audit found for property URL and audit date' 
      });
    }

    // Parse ranking_ai_data (stored as JSONB)
    let rankingAiData = auditRecord.ranking_ai_data;
    if (typeof rankingAiData === 'string') {
      try {
        rankingAiData = JSON.parse(rankingAiData);
      } catch (e) {
        console.warn('[Query Keywords Citing URL] Failed to parse ranking_ai_data JSON:', e.message);
        return sendJSON(res, 200, {
          status: 'ok',
          data: [],
          count: 0,
          target_url: target_url,
          target_url_normalized: targetUrlNormalized,
          audit_date: auditDateToUse
        });
      }
    }

    // Extract combinedRows from ranking_ai_data
    const combinedRows = rankingAiData?.combinedRows || [];
    if (!Array.isArray(combinedRows) || combinedRows.length === 0) {
      return sendJSON(res, 200, {
        status: 'ok',
        data: [],
        count: 0,
        target_url: target_url,
        target_url_normalized: targetUrlNormalized,
        audit_date: auditDateToUse
      });
    }

    // Filter keywords where ai_alan_citations array contains the target URL
    // Count TOTAL citations (not just unique keywords) - same URL can be cited multiple times from different keywords
    const citingKeywords = [];
    let totalCitationCount = 0; // Count total citations across all keywords
    
    combinedRows.forEach(row => {
      const citationsArray = row.ai_alan_citations || [];
      if (!Array.isArray(citationsArray) || citationsArray.length === 0) {
        return; // Skip if no citations
      }
      
      // Count how many citations in this keyword match the target URL
      let keywordCitationCount = 0;
      citationsArray.forEach(citation => {
        // Try multiple field names to extract citation URL
        const citedUrl = typeof citation === 'string' 
          ? citation 
          : (citation && typeof citation === 'object' 
              ? (citation.url || citation.URL || citation.link || citation.href || citation.page || citation.pageUrl || citation.target || citation.targetUrl || citation.best_url || citation.bestUrl || '') 
              : null);
        
        if (!citedUrl) return;
        
        const citedUrlNormalized = normalizeUrl(citedUrl);
        
        // Strict URL matching: exact match or same path segments (not substring matching)
        // This prevents matching "photography-workshops" when looking for "landscape-photography-workshops"
        const targetPathParts = targetUrlNormalized.split('/').filter(p => p);
        const citedPathParts = citedUrlNormalized.split('/').filter(p => p);
        
        // Exact match
        let matches = citedUrlNormalized === targetUrlNormalized;
        
        // If not exact, check if paths match (same segments, allowing query/fragment variants)
        // Only match if the citation path starts with the target path (not substring matching)
        if (!matches && targetPathParts.length > 0 && citedPathParts.length >= targetPathParts.length) {
          // Check if citation path starts with target path segments
          matches = targetPathParts.every((part, idx) => citedPathParts[idx] === part);
        }
        
        if (matches) {
          keywordCitationCount++; // Count this citation
        }
      });
      
      // If this keyword has citations for the target URL, track it
      if (keywordCitationCount > 0) {
        totalCitationCount += keywordCitationCount; // Add to total count
        citingKeywords.push({
          keyword: row.keyword || '',
          has_ai_overview: row.has_ai_overview === true || row.hasAiOverview === true,
          best_url: row.best_url || row.bestUrl || '',
          best_rank_group: row.best_rank_group || row.bestRankGroup || null,
          search_volume: row.search_volume || row.monthly_search_volume || row.volume || null,
          best_rank: row.best_rank_group || row.bestRankGroup || null,
          citation_count: keywordCitationCount // Track how many citations this keyword has for the URL
        });
      }
    });

    return sendJSON(res, 200, {
      status: 'ok',
      data: citingKeywords,
      count: totalCitationCount, // Return total citations, not unique keywords
      unique_keywords: citingKeywords.length, // Also provide unique keyword count for reference
      target_url: target_url,
      target_url_normalized: targetUrlNormalized,
      audit_date: auditDateToUse
    });

  } catch (err) {
    console.error('[Query Keywords Citing URL] Error:', err);
    return sendJSON(res, 500, { 
      status: 'error',
      error: err.message 
    });
  }
}
