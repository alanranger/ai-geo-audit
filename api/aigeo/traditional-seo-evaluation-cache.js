export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const need = (key) => {
  const value = process.env[key];
  if (!value || !String(value).trim()) throw new Error(`missing_env:${key}`);
  return value;
};

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

const normalizePropertyKey = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  const low = s.toLowerCase();
  if (low.startsWith('sc-domain:')) return low.replace(/\s+/g, '');
  try {
    if (typeof URL !== 'undefined' && URL.canParse(s)) {
      const u = new URL(s);
      const host = u.hostname.toLowerCase().replace(/^www\./, '');
      const path = String(u.pathname || '/').replace(/\/+$/, '') || '/';
      return `${u.protocol.toLowerCase()}//${host}${path}`;
    }
  } catch (e) {
    /* ignore */
  }
  return low;
};

async function handleGet(req, res, supabase) {
  const raw = String(req.query.propertyUrl || '').trim();
  const key = normalizePropertyKey(raw);
  if (!key) {
    return sendJson(res, 400, { status: 'error', message: 'propertyUrl is required.' });
  }
  const { data, error } = await supabase
    .from('traditional_seo_evaluation_cache')
    .select('property_url,last_property_url,last_evaluation_at,evaluation_rows,updated_at')
    .eq('property_url', key)
    .maybeSingle();
  if (error) throw error;
  const rows = Array.isArray(data?.evaluation_rows) ? data.evaluation_rows : [];
  return sendJson(res, 200, {
    status: 'ok',
    propertyUrl: data?.property_url || key,
    lastPropertyUrl: data?.last_property_url || null,
    lastEvaluationAt: data?.last_evaluation_at || null,
    evaluationRows: rows,
    updatedAt: data?.updated_at || null,
    meta: { generatedAt: new Date().toISOString() }
  });
}

/** Squarespace serves the homepage at both / and /home. */
const pagePath = (pathname) => {
  const p = String(pathname || '/').replace(/\/+$/, '');
  return !p || p.toLowerCase() === '/home' ? '/' : p;
};

/** Same page whether stored as www / bare host, with a trailing slash, or /home vs /. */
const pageKey = (url) => {
  const s = String(url || '').trim();
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return `${host}${pagePath(u.pathname).toLowerCase()}`;
  } catch (e) {
    return s.toLowerCase();
  }
};

/** One stored form per page (www host, no trailing slash) so every save path agrees. */
function canonicalRowUrl(url, propertyKey) {
  const s = String(url || '').trim();
  try {
    const u = new URL(s);
    const siteHost = new URL(propertyKey).hostname.replace(/^www\./, '');
    if (u.hostname.toLowerCase().replace(/^www\./, '') !== siteHost) return s;
    return `https://www.${siteHost}${pagePath(u.pathname)}`;
  } catch (e) {
    return s;
  }
}

/**
 * Every save: canonical URL per row, then one row per (page, rule, site-wide flag) — the
 * last occurrence wins, which is the freshest (re-audited rows are appended at the end).
 */
export function normalizeEvaluationRows(rows, propertyKey) {
  const seen = new Set();
  const out = [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const r = rows[i];
    const sitewide = String(r?.tier || '').toLowerCase() === 'sitewide';
    const url = canonicalRowUrl(r?.url, propertyKey);
    const k = `${sitewide ? 'S' : 'P'}|${pageKey(url)}|${String(r?.rule_key || '')}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(url === r?.url ? r : { ...r, url });
  }
  return out.reverse();
}

/**
 * Single-page save: replace every stored row for the pages in mergeUrls (and the posted
 * rows' own pages), keep everything else. Stops a stale tab overwriting the whole-site set.
 * Returns null when there is no stored set yet (caller then falls back to a full save).
 */
export function mergeEvaluationRows(stored, mergeUrls, rows) {
  if (!Array.isArray(stored) || !stored.length) return null;
  const drop = new Set(
    [...(mergeUrls || []), ...(rows || []).map((r) => r?.url)].filter(Boolean).map(pageKey)
  );
  const kept = stored.filter((r) => String(r?.tier || '').toLowerCase() === 'sitewide' || !drop.has(pageKey(r?.url)));
  return kept.concat(rows);
}

async function mergeRowsIntoStored(supabase, key, mergeUrls, rows) {
  const { data, error } = await supabase
    .from('traditional_seo_evaluation_cache')
    .select('evaluation_rows')
    .eq('property_url', key)
    .maybeSingle();
  if (error) throw error;
  return mergeEvaluationRows(data?.evaluation_rows, mergeUrls, rows);
}

async function handlePost(req, res, supabase) {
  const body = req.body || {};
  const raw = String(body?.propertyUrl || '').trim();
  const key = normalizePropertyKey(raw);
  let rows = Array.isArray(body?.evaluationRows) ? body.evaluationRows : [];
  const mergeUrls = Array.isArray(body?.mergeUrls) ? body.mergeUrls : null;
  if (!key) {
    return sendJson(res, 400, { status: 'error', message: 'propertyUrl is required.' });
  }
  if (!rows.length) {
    return sendJson(res, 400, { status: 'error', message: 'evaluationRows must be a non-empty array.' });
  }
  if (mergeUrls) {
    const merged = await mergeRowsIntoStored(supabase, key, mergeUrls, rows);
    if (!merged) {
      return sendJson(res, 409, { status: 'error', message: 'no_stored_rows — send a full save.' });
    }
    rows = merged;
  }
  rows = normalizeEvaluationRows(rows, key);
  const now = new Date().toISOString();
  const row = {
    property_url: key,
    last_property_url: String(body?.lastPropertyUrl || raw).trim() || raw,
    last_evaluation_at: body?.lastEvaluationAt || now,
    evaluation_rows: rows,
    updated_at: now
  };
  const { error } = await supabase.from('traditional_seo_evaluation_cache').upsert(row, { onConflict: 'property_url' });
  if (error) throw error;
  return sendJson(res, 200, {
    status: 'ok',
    propertyUrl: key,
    rowCount: rows.length,
    merged: !!mergeUrls,
    meta: { generatedAt: now }
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (!['GET', 'POST'].includes(req.method)) {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed.' });
  }
  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    if (req.method === 'GET') return await handleGet(req, res, supabase);
    return await handlePost(req, res, supabase);
  } catch (error) {
    const msg = String(error?.message || '');
    if (msg.includes('does not exist')) {
      return sendJson(res, 200, {
        status: 'ok',
        propertyUrl: null,
        lastPropertyUrl: null,
        lastEvaluationAt: null,
        evaluationRows: [],
        meta: {
          generatedAt: new Date().toISOString(),
          warning: 'traditional_seo_evaluation_cache missing — run sql/20260325_traditional_seo_evaluation_cache.sql'
        }
      });
    }
    return sendJson(res, 500, { status: 'error', message: msg, meta: { generatedAt: new Date().toISOString() } });
  }
}
