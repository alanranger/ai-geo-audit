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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

const buildPropertyCandidates = (propertyUrl) => {
  const trimmed = String(propertyUrl || '').trim().replace(/\/$/, '');
  if (!trimmed) return [];
  const candidates = new Set([trimmed]);
  const hasProtocol = /^(https?:\/\/)/.exec(trimmed);
  const withProtocol = hasProtocol ? trimmed : `https://${trimmed}`;
  candidates.add(withProtocol);
  if (withProtocol.includes('://www.')) {
    candidates.add(withProtocol.replace('://www.', '://'));
  } else {
    candidates.add(withProtocol.replace('://', '://www.'));
  }
  return Array.from(candidates);
};

const parseRankingAiData = (value) => {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (e) {
      return null;
    }
  }
  return value;
};

const combinedRowsCount = (value) => {
  const parsed = parseRankingAiData(value);
  const rows = parsed?.combinedRows;
  return Array.isArray(rows) ? rows.length : 0;
};

const findLatestRankingAudit = async (supabase, propertyFilter) => {
  const { data, error } = await supabase
    .from('audit_results')
    .select('audit_date, ranking_ai_data')
    .in('property_url', propertyFilter)
    .not('ranking_ai_data', 'is', null)
    .order('audit_date', { ascending: false })
    .limit(5);
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const best = data.find(row => combinedRowsCount(row.ranking_ai_data) > 0);
  if (!best) return null;
  return { auditDate: best.audit_date, ranking_ai_data: best.ranking_ai_data };
};

const findLatestAuditDate = async (supabase, propertyFilter) => {
  const { data, error } = await supabase
    .from('audit_results')
    .select('audit_date')
    .in('property_url', propertyFilter)
    .order('audit_date', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return null;
  return data.audit_date;
};

const fetchAuditRecord = async (supabase, propertyFilter, auditDateToUse) => {
  const { data, error } = await supabase
    .from('audit_results')
    .select('ranking_ai_data')
    .in('property_url', propertyFilter)
    .eq('audit_date', auditDateToUse)
    .order('audit_date', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return null;
  return data;
};

// Count citations within combinedRows that point at a single (already-normalized) target URL.
// Returns { count, uniqueKeywords, citingKeywords }.
function countCitationsForTarget(combinedRows, targetUrlNormalized) {
  const targetPathParts = targetUrlNormalized.split('/').filter(p => p);
  const citingKeywords = [];
  let totalCitationCount = 0;

  combinedRows.forEach(row => {
    const citationsArray = row.ai_alan_citations || [];
    if (!Array.isArray(citationsArray) || citationsArray.length === 0) return;

    let keywordCitationCount = 0;
    citationsArray.forEach(citation => {
      const citedUrl = typeof citation === 'string'
        ? citation
        : (citation && typeof citation === 'object'
            ? (citation.url || citation.URL || citation.link || citation.href || citation.page || citation.pageUrl || citation.target || citation.targetUrl || citation.best_url || citation.bestUrl || '')
            : null);
      if (!citedUrl) return;

      const citedUrlNormalized = normalizeUrl(citedUrl);
      const citedPathParts = citedUrlNormalized.split('/').filter(p => p);

      let matches = citedUrlNormalized === targetUrlNormalized;
      if (!matches && targetPathParts.length > 0 && citedPathParts.length >= targetPathParts.length) {
        matches = targetPathParts.every((part, idx) => citedPathParts[idx] === part);
      }
      if (matches) keywordCitationCount++;
    });

    if (keywordCitationCount > 0) {
      totalCitationCount += keywordCitationCount;
      citingKeywords.push({
        keyword: row.keyword || '',
        has_ai_overview: row.has_ai_overview === true || row.hasAiOverview === true,
        best_url: row.best_url || row.bestUrl || '',
        best_rank_group: row.best_rank_group || row.bestRankGroup || null,
        search_volume: row.search_volume || row.monthly_search_volume || row.volume || null,
        best_rank: row.best_rank_group || row.bestRankGroup || null,
        citation_count: keywordCitationCount
      });
    }
  });

  return { count: totalCitationCount, uniqueKeywords: citingKeywords.length, citingKeywords };
}

// Resolve the combinedRows + audit date for a property once (shared by single + batch paths).
// Returns { combinedRows, auditDateToUse } on success, or { error: {status, body} } on failure.
async function resolveCombinedRows(supabase, property_url, audit_date) {
  const propertyCandidates = buildPropertyCandidates(property_url);
  const propertyFilter = propertyCandidates.length ? propertyCandidates : [property_url];

  let auditDateToUse = audit_date;
  let auditRecord = null;
  if (!auditDateToUse) {
    const latestRanking = await findLatestRankingAudit(supabase, propertyFilter);
    if (latestRanking) {
      auditDateToUse = latestRanking.auditDate;
      auditRecord = { ranking_ai_data: latestRanking.ranking_ai_data };
    }
  }
  if (!auditDateToUse) {
    auditDateToUse = await findLatestAuditDate(supabase, propertyFilter);
    if (!auditDateToUse) {
      return { error: { status: 404, body: { status: 'error', error: 'No audit found for property URL' } } };
    }
  }
  if (!auditRecord) {
    auditRecord = await fetchAuditRecord(supabase, propertyFilter, auditDateToUse);
    if (!auditRecord) {
      return { error: { status: 404, body: { status: 'error', error: 'No audit found for property URL and audit date' } } };
    }
  }

  let rankingAiData = parseRankingAiData(auditRecord.ranking_ai_data);
  const combinedRows = Array.isArray(rankingAiData?.combinedRows) ? rankingAiData.combinedRows : [];
  return { combinedRows, auditDateToUse };
}

// Batch path: one request resolves the ranking blob once and counts citations for many URLs.
async function handleBatch(req, res) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const property_url = body?.property_url;
  const audit_date = body?.audit_date;
  const targetUrls = Array.isArray(body?.target_urls) ? body.target_urls : [];

  if (!property_url || targetUrls.length === 0) {
    return sendJSON(res, 400, { error: 'property_url and target_urls[] are required' });
  }

  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const resolved = await resolveCombinedRows(supabase, property_url, audit_date);
  if (resolved.error) return sendJSON(res, resolved.error.status, resolved.error.body);

  const { combinedRows, auditDateToUse } = resolved;
  const counts = {};
  for (const url of targetUrls) {
    if (!url) continue;
    const { count } = combinedRows.length
      ? countCitationsForTarget(combinedRows, normalizeUrl(url))
      : { count: 0 };
    counts[url] = count;
  }

  return sendJSON(res, 200, { status: 'ok', counts, audit_date: auditDateToUse });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    try {
      return await handleBatch(req, res);
    } catch (err) {
      console.error('[Query Keywords Citing URL] Batch error:', err);
      return sendJSON(res, 500, { status: 'error', error: err.message });
    }
  }

  if (req.method !== 'GET') {
    return sendJSON(res, 405, { error: `Method not allowed. Expected: GET or POST` });
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

    const targetUrlNormalized = normalizeUrl(target_url);

    const resolved = await resolveCombinedRows(supabase, property_url, audit_date);
    if (resolved.error) return sendJSON(res, resolved.error.status, resolved.error.body);

    const { combinedRows, auditDateToUse } = resolved;
    const { count, uniqueKeywords, citingKeywords } = combinedRows.length
      ? countCitationsForTarget(combinedRows, targetUrlNormalized)
      : { count: 0, uniqueKeywords: 0, citingKeywords: [] };

    return sendJSON(res, 200, {
      status: 'ok',
      data: citingKeywords,
      count: count,
      unique_keywords: uniqueKeywords,
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
