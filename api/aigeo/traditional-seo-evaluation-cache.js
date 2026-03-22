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

async function handlePost(req, res, supabase) {
  const body = req.body || {};
  const raw = String(body?.propertyUrl || '').trim();
  const key = normalizePropertyKey(raw);
  const rows = Array.isArray(body?.evaluationRows) ? body.evaluationRows : [];
  if (!key) {
    return sendJson(res, 400, { status: 'error', message: 'propertyUrl is required.' });
  }
  if (!rows.length) {
    return sendJson(res, 400, { status: 'error', message: 'evaluationRows must be a non-empty array.' });
  }
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
