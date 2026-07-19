/**
 * POST /api/keywords/save-csv
 * Body: { csv: string, replaceAll?: boolean, writeFiles?: boolean, version?: 'v3'|'v4'|'v5' }
 *
 * Accepts full 5-column locked CSV or bare keyword list (backward compatible).
 */

import { detectAndParseTrackingCsv } from '../../lib/keyword-ranking/parse-tracking-csv.js';
import {
  censusFromByKeyword,
  upsertTrackingRows,
} from '../../lib/keyword-ranking/locked-config-merge.js';
import {
  fetchSupabaseLockedOverride,
  loadExistingLockedByKeyword,
  persistLockedToSupabase,
  writeLockedConfigFiles,
} from '../../lib/keyword-ranking/locked-config-persist.js';
import { filterTrackedKeywords, resolveTrackedSegment } from '../../lib/keyword-ranking/tracked-set-v3.js';

export const config = { maxDuration: 30 };

function propertyUrlFromEnv() {
  const raw = process.env.GSC_PROPERTY_URL
    || process.env.NEXT_PUBLIC_SITE_DOMAIN
    || process.env.SITE_DOMAIN
    || 'https://www.alanranger.com';
  const v = String(raw || '').trim();
  if (/^https?:\/\//i.test(v)) return v.replace(/\/+$/, '');
  return `https://${v.replace(/^www\./, '')}`.replace(/\/+$/, '');
}

async function upsertKeywordRankings({
  supabaseUrl,
  supabaseKey,
  propertyUrl,
  auditDate,
  byKeyword,
  addedKeywords,
}) {
  if (!addedKeywords.length) return { inserted: 0 };
  const insertRows = addedKeywords.map((keyword) => {
    const key = keyword.toLowerCase().replace(/\s+/g, ' ');
    const cfg = byKeyword[key] || {};
    const keywordClass = cfg.keyword_class || null;
    const segment = resolveTrackedSegment(keyword, keywordClass, null);
    return {
      property_url: propertyUrl,
      audit_date: auditDate,
      keyword,
      keyword_class: keywordClass,
      class_unmapped: !keywordClass,
      location_name: cfg.location_name_dfs || null,
      location_unmapped: !cfg.location_name_dfs,
      segment,
      segment_source: 'manual',
      page_type: 'Landing',
      best_rank_group: null,
      best_rank_absolute: null,
      best_url: null,
      best_title: keyword,
      search_volume: null,
      has_ai_overview: false,
      ai_total_citations: 0,
      ai_alan_citations_count: 0,
    };
  });

  const insertUrl = `${supabaseUrl}/rest/v1/keyword_rankings`;
  const insertResp = await fetch(insertUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(insertRows),
  });
  if (!insertResp.ok) {
    const text = await insertResp.text();
    throw new Error(`keyword_rankings insert failed: ${text.slice(0, 300)}`);
  }
  return { inserted: insertRows.length };
}

async function patchExistingKeywordMeta({
  supabaseUrl,
  supabaseKey,
  propertyUrl,
  auditDate,
  byKeyword,
  updatedKeywords,
}) {
  let patched = 0;
  for (const keyword of updatedKeywords) {
    const key = keyword.toLowerCase().replace(/\s+/g, ' ');
    const cfg = byKeyword[key];
    if (!cfg?.keyword_class && !cfg?.location_name_dfs) continue;
    const patchUrl = `${supabaseUrl}/rest/v1/keyword_rankings?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.${auditDate}&keyword=eq.${encodeURIComponent(keyword)}`;
    const body = {
      keyword_class: cfg.keyword_class || null,
      class_unmapped: !cfg.keyword_class,
      location_name: cfg.location_name_dfs || null,
      location_unmapped: !cfg.location_name_dfs,
      segment: resolveTrackedSegment(keyword, cfg.keyword_class, null),
      segment_source: 'manual',
    };
    const resp = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    });
    if (resp.ok) patched += 1;
  }
  return { patched };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed. Use POST.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ status: 'error', message: 'Supabase not configured.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { csv, replaceAll = false, writeFiles = false, version = 'v3' } = body || {};
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ status: 'error', message: 'csv field is required' });
    }

    const parsed = detectAndParseTrackingCsv(csv);
    if (!parsed.rows.length) {
      return res.status(400).json({ status: 'error', message: 'No keywords found in CSV' });
    }

    const propertyUrl = propertyUrlFromEnv();
    const existing = loadExistingLockedByKeyword();
    const override = await fetchSupabaseLockedOverride(supabaseUrl, supabaseKey, propertyUrl);
    const base = override?.by_keyword ? { ...existing, ...override.by_keyword } : existing;
    const merged = upsertTrackingRows(base, parsed.rows, { replaceAll });
    const keywords = filterTrackedKeywords(
      Object.values(merged.byKeyword).map((r) => r.keyword)
    );

    const sourceName = `keyword-tracking-locations-and-class-LOCKED-${version}.csv`;
    let filesWritten = null;
    if (writeFiles) {
      filesWritten = writeLockedConfigFiles(merged.byKeyword, version);
    }

    await persistLockedToSupabase({
      supabaseUrl,
      supabaseKey,
      propertyUrl,
      byKeyword: merged.byKeyword,
      census: merged.census,
      sourceName,
    });

    // Prefer the latest ranked keyword_rankings snapshot (not an empty stub date).
    const rankedUrl = `${supabaseUrl}/rest/v1/keyword_rankings?property_url=eq.${encodeURIComponent(propertyUrl)}&best_rank_absolute=not.is.null&select=audit_date&order=audit_date.desc&limit=1`;
    const rankedResp = await fetch(rankedUrl, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    const rankedRows = rankedResp.ok ? await rankedResp.json() : [];
    let auditDate = rankedRows?.[0]?.audit_date || null;
    if (!auditDate) {
      const auditUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&order=audit_date.desc&limit=1&select=audit_date`;
      const auditResp = await fetch(auditUrl, {
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
      });
      const auditRows = auditResp.ok ? await auditResp.json() : [];
      auditDate = auditRows?.[0]?.audit_date || new Date().toISOString().slice(0, 10);
    }

    const existingKwUrl = `${supabaseUrl}/rest/v1/keyword_rankings?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.${auditDate}&select=keyword`;
    const existingKwResp = await fetch(existingKwUrl, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    const existingKeywords = existingKwResp.ok
      ? (await existingKwResp.json()).map((r) => r.keyword).filter(Boolean)
      : [];
    const existingLower = new Set(existingKeywords.map((k) => String(k).toLowerCase()));

    const incomingKeywords = parsed.rows.map((r) => r.keyword).filter(Boolean);
    const addedKeywords = incomingKeywords.filter((k) => !existingLower.has(String(k).toLowerCase()));
    const updatedKeywords = incomingKeywords.filter((k) => existingLower.has(String(k).toLowerCase()));

    const insertResult = await upsertKeywordRankings({
      supabaseUrl,
      supabaseKey,
      propertyUrl,
      auditDate,
      byKeyword: merged.byKeyword,
      addedKeywords,
    });
    const patchResult = await patchExistingKeywordMeta({
      supabaseUrl,
      supabaseKey,
      propertyUrl,
      auditDate,
      byKeyword: merged.byKeyword,
      updatedKeywords,
    });

    return res.status(200).json({
      status: 'ok',
      format: parsed.format,
      message: 'Keyword tracking config updated',
      count: keywords.length,
      added: merged.added,
      updated: merged.updated,
      unmapped: merged.unmapped,
      census: merged.census,
      keywordRowsInserted: insertResult.inserted,
      keywordRowsPatched: patchResult.patched,
      filesWritten,
      lockedConfig: {
        source: sourceName,
        count: Object.keys(merged.byKeyword).length,
        by_keyword: merged.byKeyword,
      },
      meta: { generatedAt: new Date().toISOString() },
    });
  } catch (e) {
    console.error('[Save CSV] Error:', e);
    return res.status(500).json({
      status: 'error',
      message: e.message || 'Internal server error',
      meta: { generatedAt: new Date().toISOString() },
    });
  }
}
