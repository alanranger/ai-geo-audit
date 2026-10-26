export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const SNAPSHOT_KEYS = new Set([
  'tech',
  'local',
  'service',
  'qa',
  'extractability',
  'citation',
  'mentions'
]);

const SNAPSHOT_MODES = new Set(['sample', 'full']);

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

const normalizePropertyUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return 'https://www.alanranger.com';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '') || parsed.origin;
  } catch (err) {
    return raw;
  }
};

const normalizeSnapshotKey = (value) => String(value || '').trim().toLowerCase();
const normalizeMode = (value) => {
  const mode = String(value || '').trim().toLowerCase();
  return SNAPSHOT_MODES.has(mode) ? mode : 'full';
};

const parseBody = (req) => {
  if (!req?.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (err) {
      return {};
    }
  }
  if (typeof req.body === 'object') return req.body;
  return {};
};

const deriveGeneratedAt = (payload) => {
  const candidates = [
    payload?.meta?.generatedAt,
    payload?.generatedAt,
    payload?.generated_at,
    payload?.meta?.selection?.generatedAt,
    payload?.data?.generatedAt
  ];
  for (const value of candidates) {
    const ts = Date.parse(String(value || ''));
    if (Number.isFinite(ts) && ts > 0) return new Date(ts).toISOString();
  }
  return null;
};

const toSnapshotMap = (rows) => {
  const grouped = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = normalizeSnapshotKey(row?.snapshot_key);
    const mode = normalizeMode(row?.mode);
    if (!SNAPSHOT_KEYS.has(key)) return;
    if (!grouped[key]) grouped[key] = {};
    grouped[key][mode] = {
      payload: row?.payload || null,
      updatedAt: row?.updated_at || null,
      generatedAt: row?.generated_at || null
    };
  });
  return grouped;
};

const handleGet = async (supabase, req, res) => {
  const propertyUrl = normalizePropertyUrl(req.query.propertyUrl);
  const { data, error } = await supabase
    .from('impl_audit_snapshots')
    .select('snapshot_key,mode,payload,generated_at,updated_at')
    .eq('property_url', propertyUrl)
    .in('snapshot_key', [...SNAPSHOT_KEYS])
    .order('updated_at', { ascending: false });

  if (error) {
    if (String(error.message || '').includes('does not exist')) {
      return sendJson(res, 200, {
        status: 'ok',
        data: { propertyUrl, snapshots: {} },
        meta: {
          generatedAt: new Date().toISOString(),
          warning: 'impl_audit_snapshots table not found (apply migration 20260319_impl_audit_snapshots.sql)'
        }
      });
    }
    throw error;
  }

  return sendJson(res, 200, {
    status: 'ok',
    data: {
      propertyUrl,
      snapshots: toSnapshotMap(data)
    },
    meta: { generatedAt: new Date().toISOString() }
  });
};

const rowUrlKey = (url) => {
  try {
    const u = new URL(String(url || '').trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return `${host}${u.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch (err) {
    return String(url || '').trim().toLowerCase();
  }
};

/**
 * Per-page save (mergeRows): replace only the posted rows (matched by URL) inside the
 * stored payload's data.rows, so a single-page re-audit never overwrites the site set.
 */
export function mergePayloadRowsByUrl(stored, payload) {
  const freshRows = Array.isArray(payload?.data?.rows) ? payload.data.rows : [];
  const storedRows = Array.isArray(stored?.data?.rows) ? stored.data.rows : null;
  if (!storedRows) return payload;
  const freshByKey = new Map(freshRows.map((r) => [rowUrlKey(r?.url), r]));
  const rows = storedRows.map((r) => {
    const k = rowUrlKey(r?.url);
    if (!freshByKey.has(k)) return r;
    const fresh = freshByKey.get(k);
    freshByKey.delete(k);
    return fresh;
  });
  freshByKey.forEach((r) => rows.push(r));
  return {
    ...stored,
    data: { ...(stored.data || {}), rows },
    meta: { ...(stored.meta || {}), lastRowMergeAt: new Date().toISOString() },
  };
}

const mergeIntoStoredPayload = async (supabase, propertyUrl, snapshotKey, mode, payload) => {
  const { data, error } = await supabase
    .from('impl_audit_snapshots')
    .select('payload')
    .eq('property_url', propertyUrl)
    .eq('snapshot_key', snapshotKey)
    .eq('mode', mode)
    .maybeSingle();
  if (error) throw error;
  return mergePayloadRowsByUrl(data?.payload, payload);
};

const handlePost = async (supabase, req, res) => {
  const body = parseBody(req);
  const propertyUrl = normalizePropertyUrl(body.propertyUrl);
  const snapshotKey = normalizeSnapshotKey(body.snapshotKey);
  const mode = normalizeMode(body.mode);
  let payload = body.payload && typeof body.payload === 'object' ? body.payload : null;

  if (!SNAPSHOT_KEYS.has(snapshotKey)) {
    return sendJson(res, 400, { status: 'error', message: `Invalid snapshotKey: ${snapshotKey || 'missing'}` });
  }
  if (!payload) {
    return sendJson(res, 400, { status: 'error', message: 'Missing payload object.' });
  }
  if (body.mergeRows === true) {
    payload = await mergeIntoStoredPayload(supabase, propertyUrl, snapshotKey, mode, payload);
  }

  const generatedAtIso = deriveGeneratedAt(payload);
  const upsertRow = {
    property_url: propertyUrl,
    snapshot_key: snapshotKey,
    mode,
    payload,
    generated_at: generatedAtIso,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('impl_audit_snapshots')
    .upsert(upsertRow, { onConflict: 'property_url,snapshot_key,mode' });

  if (error) {
    if (String(error.message || '').includes('does not exist')) {
      return sendJson(res, 200, {
        status: 'ok',
        data: { saved: false, propertyUrl, snapshotKey, mode },
        meta: {
          generatedAt: new Date().toISOString(),
          warning: 'impl_audit_snapshots table not found (apply migration 20260319_impl_audit_snapshots.sql)'
        }
      });
    }
    throw error;
  }

  return sendJson(res, 200, {
    status: 'ok',
    data: { saved: true, propertyUrl, snapshotKey, mode },
    meta: { generatedAt: new Date().toISOString() }
  });
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use GET or POST.' });
  }

  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    if (req.method === 'GET') return await handleGet(supabase, req, res);
    return await handlePost(supabase, req, res);
  } catch (error) {
    return sendJson(res, 500, {
      status: 'error',
      message: error.message,
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}
