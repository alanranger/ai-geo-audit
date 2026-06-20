/**
 * Get the canonical tracked keyword list for Ranking & AI scans.
 *
 * Source priority:
 *   1. audit_results.ranking_ai_data.targetKeywords (Edit Keywords / CSV upload)
 *   2. Largest keyword_rankings snapshot by row count (not merely latest date)
 *   3. Bundled public/tracked-keywords-fallback.json (when Supabase is down)
 *
 * GET /api/keywords/get
 */

import { readFileSync } from 'fs';
import { join } from 'path';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const DEFAULT_PROPERTY = 'https://www.alanranger.com';
const SB_HEADERS = (supabaseKey) => ({
  'Content-Type': 'application/json',
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
});

function resolvePropertyUrl() {
  const raw = process.env.GSC_PROPERTY_URL
    || process.env.NEXT_PUBLIC_SITE_DOMAIN
    || process.env.SITE_DOMAIN
    || DEFAULT_PROPERTY;
  const v = String(raw || '').trim();
  if (!v) return DEFAULT_PROPERTY;
  if (/^https?:\/\//i.test(v)) return v.replace(/\/+$/, '');
  return `https://${v.replace(/^www\./, '')}`.replace(/\/+$/, '');
}

function dedupeSortKeywords(keywords) {
  return [...new Set(
    (keywords || [])
      .map((kw) => String(kw || '').trim())
      .filter((kw) => kw.length > 0)
  )].sort((a, b) => a.localeCompare(b));
}

async function sbFetch(url, supabaseKey, timeoutMs = 8000) {
  return fetch(url, {
    method: 'GET',
    headers: SB_HEADERS(supabaseKey),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function loadBundledKeywordsFallback() {
  try {
    const filePath = join(process.cwd(), 'public/tracked-keywords-fallback.json');
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    const keywords = dedupeSortKeywords(parsed?.keywords);
    if (!keywords.length) return null;
    return {
      keywords,
      auditDate: parsed.auditDate || null,
      source: 'bundled_fallback',
    };
  } catch (_e) {
    return null;
  }
}

async function loadTargetKeywordsFromAudit(supabaseUrl, supabaseKey, propertyUrl) {
  const auditUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&order=audit_date.desc&limit=1&select=audit_date,ranking_ai_data`;
  const auditResp = await sbFetch(auditUrl, supabaseKey);
  if (!auditResp.ok) return null;

  const rows = await auditResp.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  const target = row?.ranking_ai_data?.targetKeywords;
  if (!Array.isArray(target) || target.length === 0) return null;

  return {
    keywords: dedupeSortKeywords(target),
    auditDate: row.audit_date || null,
    source: 'target_keywords',
  };
}

async function loadLargestKeywordSnapshot(supabaseUrl, supabaseKey, propertyUrl) {
  // Single round-trip: group keywords by audit_date in memory (avoids 20 sequential queries).
  const url = `${supabaseUrl}/rest/v1/keyword_rankings?property_url=eq.${encodeURIComponent(propertyUrl)}&select=audit_date,keyword&limit=10000`;
  const resp = await sbFetch(url, supabaseKey, 8000);
  if (!resp.ok) return null;

  const rows = await resp.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const byDate = new Map();
  for (const row of rows) {
    const auditDate = row?.audit_date;
    const keyword = String(row?.keyword || '').trim();
    if (!auditDate || !keyword) continue;
    if (!byDate.has(auditDate)) byDate.set(auditDate, new Set());
    byDate.get(auditDate).add(keyword);
  }

  let bestDate = null;
  let bestKeywords = [];
  for (const [auditDate, keywordSet] of byDate) {
    if (keywordSet.size > bestKeywords.length) {
      bestDate = auditDate;
      bestKeywords = dedupeSortKeywords([...keywordSet]);
    }
  }

  if (bestKeywords.length === 0) return null;
  return { auditDate: bestDate, keywords: bestKeywords, source: 'largest_snapshot' };
}

async function handleProbe(supabaseUrl, supabaseKey, res) {
  try {
    const pingUrl = `${supabaseUrl}/rest/v1/audit_results?select=audit_date&limit=1`;
    const ping = await sbFetch(pingUrl, supabaseKey, 6000);
    if (!ping.ok) {
      return res.status(503).json({ status: 'error', probe: true, message: 'Supabase unavailable' });
    }
    return res.status(200).json({ status: 'ok', probe: true });
  } catch (e) {
    return res.status(503).json({ status: 'error', probe: true, message: 'Supabase unavailable' });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed. Use GET.',
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      status: 'error',
      message: 'Supabase not configured.',
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  // Lightweight health probe: the UI calls this on every page load purely to
  // detect a Supabase outage (503). Doing a tiny ping here avoids pulling the
  // full keyword set (up to 10k rows / several seconds) just for a liveness check.
  if (req.query && (req.query.probe === '1' || req.query.probe === 'true')) {
    return handleProbe(supabaseUrl, supabaseKey, res);
  }

  try {
    const propertyUrl = resolvePropertyUrl();

    let result = await loadTargetKeywordsFromAudit(supabaseUrl, supabaseKey, propertyUrl);
    if (!result) {
      result = await loadLargestKeywordSnapshot(supabaseUrl, supabaseKey, propertyUrl);
    }

    if (!result) {
      result = loadBundledKeywordsFallback();
    }

    if (!result) {
      return res.status(200).json({
        status: 'ok',
        keywords: [],
        meta: { generatedAt: new Date().toISOString(), reason: 'no_audit_rows' },
      });
    }

    return res.status(200).json({
      status: 'ok',
      keywords: result.keywords,
      auditDate: result.auditDate,
      propertyUrl,
      meta: {
        generatedAt: new Date().toISOString(),
        source: result.source,
        debug: `Found ${result.keywords.length} keywords (${result.source}${result.auditDate ? `, audit_date: ${result.auditDate}` : ''})`,
      },
    });
  } catch (e) {
    console.error('[Get Keywords] Error:', e);
    const isTimeout = e?.name === 'TimeoutError' || String(e?.message || '').includes('timeout');
    const bundled = loadBundledKeywordsFallback();
    if (isTimeout && bundled) {
      return res.status(200).json({
        status: 'ok',
        keywords: bundled.keywords,
        auditDate: bundled.auditDate,
        propertyUrl: resolvePropertyUrl(),
        meta: {
          generatedAt: new Date().toISOString(),
          source: bundled.source,
          reason: 'supabase_unavailable_bundled_fallback',
        },
      });
    }
    if (isTimeout) {
      return res.status(503).json({
        status: 'error',
        message: 'Supabase unavailable',
        keywords: [],
        meta: { generatedAt: new Date().toISOString(), reason: 'supabase_unavailable' },
      });
    }
    return res.status(500).json({
      status: 'error',
      message: e.message || 'Internal server error',
      meta: { generatedAt: new Date().toISOString() },
    });
  }
}
