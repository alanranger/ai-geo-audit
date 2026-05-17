// Revenue snapshot manager.
//
// GET    ?propertyUrl=...            -> latest snapshot + last 12 entries
// POST   { propertyUrl, period_start, period_end, revenue_amount, currency?, source?, transactions?, notes? }
//        -> upsert one snapshot
// DELETE ?id=...                     -> remove a snapshot
//
// `source` accepts: 'manual' | 'squarespace_csv' | 'squarespace_api' | 'other'.
// `squarespace_csv` is reserved for the future CSV import flow.

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';
const ALLOWED_SOURCES = ['manual', 'squarespace_csv', 'squarespace_api', 'other'];

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
};

const need = (key) => {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
};

function parseBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  if (req.body && typeof req.body === 'object') return req.body;
  return {};
}

function validateRow(body) {
  const errs = [];
  const propertyUrl = String(body.propertyUrl || DEFAULT_PROPERTY).trim();
  const periodStart = String(body.period_start || '').trim();
  const periodEnd = String(body.period_end || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) errs.push('period_start must be YYYY-MM-DD');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) errs.push('period_end must be YYYY-MM-DD');
  const amount = Number(body.revenue_amount);
  if (!Number.isFinite(amount) || amount < 0) errs.push('revenue_amount must be a non-negative number');
  const source = String(body.source || 'manual').trim();
  if (!ALLOWED_SOURCES.includes(source)) errs.push(`source must be one of ${ALLOWED_SOURCES.join(', ')}`);
  return {
    errs,
    row: {
      property_url: propertyUrl,
      period_start: periodStart,
      period_end: periodEnd,
      revenue_amount: amount,
      currency: String(body.currency || 'GBP').trim().toUpperCase(),
      source,
      transactions: Number.isFinite(Number(body.transactions)) ? Number(body.transactions) : null,
      notes: typeof body.notes === 'string' ? body.notes : null
    }
  };
}

async function listSnapshots(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('revenue_snapshots')
    .select('*')
    .eq('property_url', propertyUrl)
    .order('period_end', { ascending: false })
    .limit(12);
  if (error) throw error;
  return data || [];
}

async function upsertSnapshot(supabase, row) {
  const { data, error } = await supabase
    .from('revenue_snapshots')
    .upsert(row, { onConflict: 'property_url,period_start,period_end,source' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteSnapshot(supabase, id) {
  const { error } = await supabase.from('revenue_snapshots').delete().eq('id', id);
  if (error) throw error;
  return { ok: true, id };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    if (req.method === 'GET') {
      const propertyUrl = String(req.query?.propertyUrl || DEFAULT_PROPERTY).trim();
      const rows = await listSnapshots(supabase, propertyUrl);
      return send(res, 200, { snapshots: rows, latest: rows[0] || null });
    }
    if (req.method === 'POST') {
      const body = parseBody(req);
      const { errs, row } = validateRow(body);
      if (errs.length) return send(res, 400, { error: 'validation_failed', issues: errs });
      const saved = await upsertSnapshot(supabase, row);
      return send(res, 200, { snapshot: saved });
    }
    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '').trim();
      if (!id) return send(res, 400, { error: 'id_required' });
      const result = await deleteSnapshot(supabase, id);
      return send(res, 200, result);
    }
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    return send(res, 500, { error: 'revenue_snapshot_failed', message: err?.message || String(err) });
  }
}
