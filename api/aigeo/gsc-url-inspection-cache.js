export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { normalizePropertyKey } from './lib/gscInspectKeys.js';

const need = (key) => {
  const value = process.env[key];
  if (!value || !String(value).trim()) throw new Error(`missing_env:${key}`);
  return value;
};

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (req.method !== 'GET') {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed.' });
  }
  try {
    const raw = String(req.query.propertyUrl || '').trim();
    const propertyKey = normalizePropertyKey(raw);
    if (!propertyKey) {
      return sendJson(res, 400, { status: 'error', message: 'propertyUrl is required.' });
    }
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const { data, error } = await supabase
      .from('gsc_url_inspection_cache')
      .select(
        'property_key,url_key,page_url,coverage_state,verdict,page_fetch_state,google_canonical,http_ok,api_error,audit_status,indexed,inspect_result_link,inspected_at,updated_at'
      )
      .eq('property_key', propertyKey);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    return sendJson(res, 200, {
      status: 'ok',
      propertyKey,
      rows,
      meta: { generatedAt: new Date().toISOString(), count: rows.length },
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('does not exist')) {
      return sendJson(res, 200, {
        status: 'ok',
        propertyKey: normalizePropertyKey(req.query?.propertyUrl),
        rows: [],
        meta: {
          generatedAt: new Date().toISOString(),
          warning: 'gsc_url_inspection_cache missing — run sql/20260328_gsc_url_inspection_cache.sql',
        },
      });
    }
    if (msg.includes('missing_env:')) {
      return sendJson(res, 500, { status: 'error', message: 'Supabase env not configured.' });
    }
    return sendJson(res, 500, { status: 'error', message: msg });
  }
}
