/**
 * Patch traditional_seo_evaluation_cache schema_qa_gate_page rows from
 * impl_audit_snapshots (snapshot_key=qa). Used by Monday Full Refresh after
 * Schema QA so overnight cron matches the UI Trad SEO modal without a browser.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { createClient } from '@supabase/supabase-js';

const need = (key) => {
  const value = process.env[key];
  if (!value || !String(value).trim()) throw new Error(`missing_env:${key}`);
  return value;
};

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

const normalizeUrlKey = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = String(u.pathname || '/').replace(/\/+$/, '') || '/';
    return `https://${host}${path}`;
  } catch {
    return s.toLowerCase().replace(/\/+$/, '');
  }
};

const propertyKeyCandidates = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return [];
  const out = new Set([s, s.toLowerCase()]);
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    out.add(`https://${host}/`);
    out.add(`https://www.${host}/`);
    out.add(`https://${host}`);
    out.add(`https://www.${host}`);
  } catch {
    /* ignore */
  }
  return [...out];
};

const statusFromQa = (qaStatus) => {
  const st = String(qaStatus || '').toLowerCase();
  if (st === 'block_deploy') return 'fail';
  if (st === 'warning' || st === 'warn') return 'warn';
  if (st === 'pass') return 'pass';
  return 'warn';
};

async function loadQaSnapshot(supabase, propertyUrl) {
  for (const key of propertyKeyCandidates(propertyUrl)) {
    const { data, error } = await supabase
      .from('impl_audit_snapshots')
      .select('property_url,payload,generated_at,updated_at')
      .eq('property_url', key)
      .eq('snapshot_key', 'qa')
      .eq('mode', 'full')
      .maybeSingle();
    if (error) throw error;
    if (data?.payload) return data;
  }
  return null;
}

async function loadEvalCache(supabase, propertyUrl) {
  for (const key of propertyKeyCandidates(propertyUrl)) {
    const { data, error } = await supabase
      .from('traditional_seo_evaluation_cache')
      .select('property_url,last_property_url,evaluation_rows')
      .eq('property_url', key)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (req.method !== 'POST') {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use POST.' });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const propertyUrl = String(body.propertyUrl || 'https://www.alanranger.com').trim();
    if (!propertyUrl) {
      return sendJson(res, 400, { status: 'error', message: 'propertyUrl is required.' });
    }

    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const qaSnap = await loadQaSnapshot(supabase, propertyUrl);
    const qaRows = Array.isArray(qaSnap?.payload?.data?.qaGate?.rows)
      ? qaSnap.payload.data.qaGate.rows
      : [];
    if (!qaRows.length) {
      return sendJson(res, 200, {
        status: 'ok',
        propertyUrl,
        patched: 0,
        skipped: 'no_qa_rows',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const qaByUrl = new Map();
    qaRows.forEach((row) => {
      const uk = normalizeUrlKey(row?.url);
      if (uk) qaByUrl.set(uk, row);
    });

    const cache = await loadEvalCache(supabase, propertyUrl);
    const rows = Array.isArray(cache?.evaluation_rows) ? cache.evaluation_rows : [];
    if (!rows.length) {
      return sendJson(res, 200, {
        status: 'ok',
        propertyUrl,
        patched: 0,
        skipped: 'no_evaluation_cache',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    let patched = 0;
    const next = rows.map((row) => {
      if (String(row?.rule_key || '') !== 'schema_qa_gate_page') return row;
      const uk = normalizeUrlKey(row?.url || row?.page_url);
      const qa = qaByUrl.get(uk);
      if (!qa) return row;
      const status = statusFromQa(qa.status);
      if (row.status === status) return row;
      patched += 1;
      return { ...row, status };
    });

    if (!patched) {
      return sendJson(res, 200, {
        status: 'ok',
        propertyUrl: cache.property_url,
        patched: 0,
        qaRows: qaRows.length,
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const now = new Date().toISOString();
    const { error: upErr } = await supabase.from('traditional_seo_evaluation_cache').upsert({
      property_url: cache.property_url,
      last_property_url: cache.last_property_url || propertyUrl,
      last_evaluation_at: now,
      evaluation_rows: next,
      updated_at: now
    }, { onConflict: 'property_url' });
    if (upErr) throw upErr;

    return sendJson(res, 200, {
      status: 'ok',
      propertyUrl: cache.property_url,
      patched,
      qaRows: qaRows.length,
      meta: { generatedAt: now }
    });
  } catch (error) {
    return sendJson(res, 500, {
      status: 'error',
      message: String(error?.message || error),
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}
