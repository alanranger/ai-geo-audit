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

    // Get all keywords for this property and audit date
    const { data: keywords, error } = await supabase
      .from('keyword_rankings')
      .select('keyword, has_ai_overview, ai_alan_citations, best_url, best_rank_group')
      .eq('audit_date', auditDateToUse)
      .eq('property_url', property_url);

    if (error) {
      throw error;
    }

    // Filter keywords where ai_alan_citations array contains the target URL
    const citingKeywords = [];
    
    if (keywords && Array.isArray(keywords)) {
      keywords.forEach(row => {
        const citationsArray = row.ai_alan_citations || [];
        if (!Array.isArray(citationsArray) || citationsArray.length === 0) {
          return; // Skip if no citations
        }
        
        // Check if any citation matches the target URL
        let urlIsCited = false;
        citationsArray.forEach(citation => {
          const citedUrl = typeof citation === 'string' 
            ? citation 
            : (citation && typeof citation === 'object' 
                ? (citation.url || citation.URL || citation.link) 
                : null);
          
          if (!citedUrl) return;
          
          const citedUrlNormalized = normalizeUrl(citedUrl);
          if (citedUrlNormalized === targetUrlNormalized) {
            urlIsCited = true;
          }
        });
        
        if (urlIsCited) {
          citingKeywords.push({
            keyword: row.keyword,
            has_ai_overview: row.has_ai_overview === true,
            best_url: row.best_url || '',
            best_rank_group: row.best_rank_group || null
          });
        }
      });
    }

    return sendJSON(res, 200, {
      status: 'ok',
      data: citingKeywords,
      count: citingKeywords.length,
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
