// Revenue Funnel priorities CRUD
//
// One endpoint covers the four operations the dashboard needs:
//   GET    ?propertyUrl=...               -> list (also embedded in summary)
//   POST   { propertyUrl, ...fields }     -> create priority
//   PATCH  { id, ...fields }              -> update fields (title/status/etc.)
//   DELETE ?id=...                        -> remove a priority

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';
const ALLOWED_STATUS = new Set(['not_started', 'in_progress', 'done', 'paused', 'cancelled']);
const ALLOWED_DIRECTION = new Set(['up', 'down']);

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
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

// Per-field coercion rules so pickAllowedFields stays under the cognitive
// complexity limit. Each entry: { field: (value) => { keep: boolean, value?: any } }
const STRING_OR_NULL = (v) => (typeof v === 'string' || v === null ? { keep: true, value: v } : { keep: false });
const ARRAY_FIELD = (v) => (Array.isArray(v) ? { keep: true, value: v.map(String) } : { keep: false });
const TITLE_FIELD = (v) => (typeof v === 'string' ? { keep: true, value: v.trim() } : { keep: false });
const NULL_OR_NUMBER = (v) => {
  if (v === null) return { keep: true, value: null };
  const n = Number(v);
  return Number.isFinite(n) ? { keep: true, value: n } : { keep: false };
};
const FINITE_NUMBER = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? { keep: true, value: n } : { keep: false };
};
const ENUM = (allowedSet) => (v) => (typeof v === 'string' && allowedSet.has(v) ? { keep: true, value: v } : { keep: false });

const FIELD_RULES = {
  title: TITLE_FIELD,
  description: STRING_OR_NULL,
  pages_affected: ARRAY_FIELD,
  primary_kpi: STRING_OR_NULL,
  kpi_target_value: NULL_OR_NUMBER,
  kpi_target_direction: ENUM(ALLOWED_DIRECTION),
  kpi_baseline_value: NULL_OR_NUMBER,
  estimated_lift: STRING_OR_NULL,
  notes: STRING_OR_NULL,
  sort_order: FINITE_NUMBER,
  status: ENUM(ALLOWED_STATUS)
};

function pickAllowedFields(body) {
  const out = {};
  const keys = Object.keys(FIELD_RULES);
  for (const key of keys) {
    if (!Object.hasOwn(body, key)) continue;
    const decision = FIELD_RULES[key](body[key]);
    if (decision.keep) out[key] = decision.value;
  }
  return out;
}

async function listPriorities(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('revenue_funnel_priorities')
    .select('*')
    .eq('property_url', propertyUrl)
    .order('sort_order');
  if (error) throw error;
  return data || [];
}

async function createPriority(supabase, body) {
  const propertyUrl = String(body.propertyUrl || DEFAULT_PROPERTY).trim();
  const fields = pickAllowedFields(body);
  if (!fields.title) {
    const err = new Error('title is required');
    err.statusCode = 400;
    throw err;
  }
  const row = {
    property_url: propertyUrl,
    title: fields.title,
    description: fields.description ?? null,
    pages_affected: fields.pages_affected ?? [],
    primary_kpi: fields.primary_kpi ?? null,
    kpi_target_value: fields.kpi_target_value ?? null,
    kpi_target_direction: fields.kpi_target_direction ?? 'up',
    kpi_baseline_value: fields.kpi_baseline_value ?? null,
    estimated_lift: fields.estimated_lift ?? null,
    notes: fields.notes ?? null,
    sort_order: fields.sort_order ?? 1000,
    status: fields.status ?? 'not_started',
    is_seeded: false
  };
  const { data, error } = await supabase
    .from('revenue_funnel_priorities')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updatePriority(supabase, id, body) {
  const fields = pickAllowedFields(body);
  if (!Object.keys(fields).length) {
    const err = new Error('no fields to update');
    err.statusCode = 400;
    throw err;
  }
  const { data, error } = await supabase
    .from('revenue_funnel_priorities')
    .update(fields)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deletePriority(supabase, id) {
  const { error } = await supabase
    .from('revenue_funnel_priorities')
    .delete()
    .eq('id', id);
  if (error) throw error;
  return { ok: true, id };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    if (req.method === 'GET') {
      const propertyUrl = String(req.query?.propertyUrl || DEFAULT_PROPERTY).trim();
      const rows = await listPriorities(supabase, propertyUrl);
      return send(res, 200, { priorities: rows });
    }
    if (req.method === 'POST') {
      const body = parseBody(req);
      const row = await createPriority(supabase, body);
      return send(res, 200, { priority: row });
    }
    if (req.method === 'PATCH') {
      const body = parseBody(req);
      const id = String(body.id || req.query?.id || '').trim();
      if (!id) return send(res, 400, { error: 'id_required' });
      const row = await updatePriority(supabase, id, body);
      return send(res, 200, { priority: row });
    }
    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '').trim();
      if (!id) return send(res, 400, { error: 'id_required' });
      const result = await deletePriority(supabase, id);
      return send(res, 200, result);
    }
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    const status = err?.statusCode || 500;
    return send(res, status, { error: 'priorities_failed', message: err?.message || String(err) });
  }
}
