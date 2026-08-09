/**
 * Manual working-state for Keyword & config rows (Option B).
 * Keyed by stable CANN-/CFG- finding ids. Display/workflow only — no scoring.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { createClient } from '@supabase/supabase-js';

const PROGRESS = new Set(['none', 'in_progress', 'done', 'parked']);
const DECISION_TYPES = new Set(['none', 'accept', 'keep_specialist', 'parked']);

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

async function ensureTable(sb) {
  const { error } = await sb.from('config_integrity_finding_state').select('finding_key').limit(1);
  if (error && /does not exist|schema cache/i.test(error.message || '')) {
    const e = new Error('missing_table:config_integrity_finding_state');
    e.code = 'MISSING_TABLE';
    throw e;
  }
  if (error) throw error;
}

function rowOut(r) {
  if (!r) return null;
  const dt = String(r.decision_type || 'none').toLowerCase();
  return {
    finding_key: r.finding_key,
    property_url: r.property_url,
    progress: r.progress || 'none',
    note: r.note || '',
    decision_type: DECISION_TYPES.has(dt) ? dt : 'none',
    worked_at: r.worked_at || null,
    updated_at: r.updated_at || null,
    cleared_at: r.cleared_at || null,
    last_seen_at: r.last_seen_at || null,
    index_requested_at: r.index_requested_at || null
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  try {
    const sb = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false }
    });
    const propertyUrl = String(
      req.query?.propertyUrl || req.body?.propertyUrl || 'https://www.alanranger.com'
    ).trim();

    if (req.method === 'GET') {
      await ensureTable(sb);
      const keys = String(req.query?.keys || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      let q = sb
        .from('config_integrity_finding_state')
        .select('*')
        .eq('property_url', propertyUrl)
        .order('worked_at', { ascending: false, nullsFirst: false });
      if (keys.length) q = q.in('finding_key', keys.slice(0, 200));
      else q = q.limit(500);
      const { data, error } = await q;
      if (error) throw error;
      return sendJson(res, 200, {
        status: 'ok',
        results: (data || []).map(rowOut),
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    if (req.method !== 'POST') {
      return sendJson(res, 405, { status: 'error', message: 'Use GET or POST.' });
    }

    await ensureTable(sb);
    const body = req.body || {};

    // Stamp GSC indexing request time on many findings (after bulk URL Inspection / Sheet tool)
    if (body.action === 'stamp_index_requested') {
      const keys = Array.isArray(body.findingKeys || body.keys)
        ? (body.findingKeys || body.keys).map((k) => String(k || '').trim()).filter(Boolean).slice(0, 200)
        : [];
      if (!keys.length) {
        return sendJson(res, 400, { status: 'error', message: 'findingKeys required.' });
      }
      const stamp = body.at ? new Date(String(body.at)) : new Date();
      if (Number.isNaN(stamp.getTime())) {
        return sendJson(res, 400, { status: 'error', message: 'Invalid at timestamp.' });
      }
      const now = new Date().toISOString();
      const index_requested_at = stamp.toISOString();
      const { data: existing, error: exErr } = await sb
        .from('config_integrity_finding_state')
        .select('*')
        .eq('property_url', propertyUrl)
        .in('finding_key', keys);
      if (exErr) throw exErr;
      const byKey = new Map((existing || []).map((r) => [r.finding_key, r]));
      const rows = keys.map((finding_key) => {
        const prev = byKey.get(finding_key) || {};
        return {
          finding_key,
          property_url: propertyUrl,
          progress: prev.progress || 'in_progress',
          note: prev.note || '',
          decision_type: prev.decision_type || null,
          worked_at: prev.worked_at || now,
          updated_at: now,
          last_seen_at: now,
          cleared_at: prev.cleared_at || null,
          index_requested_at
        };
      });
      const { error } = await sb.from('config_integrity_finding_state').upsert(rows, {
        onConflict: 'finding_key'
      });
      if (error) throw error;
      const { data, error: rErr } = await sb
        .from('config_integrity_finding_state')
        .select('*')
        .in('finding_key', keys);
      if (rErr) throw rErr;
      return sendJson(res, 200, {
        status: 'ok',
        results: (data || []).map(rowOut),
        meta: { action: 'stamp_index_requested', stamped: (data || []).length, index_requested_at }
      });
    }

    // Sync which findings are currently active: set last_seen / clear flags
    if (body.action === 'sync_active') {
      const activeKeys = Array.isArray(body.activeKeys)
        ? body.activeKeys.map((k) => String(k || '').trim()).filter(Boolean).slice(0, 200)
        : [];
      const now = new Date().toISOString();
      const { data: all, error: listErr } = await sb
        .from('config_integrity_finding_state')
        .select('finding_key, cleared_at')
        .eq('property_url', propertyUrl)
        .limit(500);
      if (listErr) throw listErr;
      const active = new Set(activeKeys);
      for (const row of all || []) {
        if (active.has(row.finding_key)) {
          // Keep cleared_at until Alan next Saves — UI uses it as "reappeared" flag.
          const { error } = await sb
            .from('config_integrity_finding_state')
            .update({ last_seen_at: now, updated_at: now })
            .eq('finding_key', row.finding_key);
          if (error) throw error;
        } else if (!row.cleared_at) {
          const { error } = await sb
            .from('config_integrity_finding_state')
            .update({ cleared_at: now, updated_at: now })
            .eq('finding_key', row.finding_key);
          if (error) throw error;
        }
      }
      return sendJson(res, 200, {
        status: 'ok',
        meta: { action: 'sync_active', active: activeKeys.length, tracked: (all || []).length }
      });
    }

    const items = Array.isArray(body.items) ? body.items : [body];
    if (!items.length) {
      return sendJson(res, 400, { status: 'error', message: 'items or findingKey required.' });
    }
    if (items.length > 80) {
      return sendJson(res, 400, { status: 'error', message: 'Max 80 items.' });
    }

    const now = new Date().toISOString();
    const rows = [];
    for (const it of items) {
      const findingKey = String(it.findingKey || it.finding_key || '').trim();
      if (!findingKey) continue;
      const progressRaw = String(it.progress ?? 'none').trim().toLowerCase();
      const progress = PROGRESS.has(progressRaw) ? progressRaw : 'none';
      const note = String(it.note ?? '').slice(0, 500);
      let decisionRaw = String(it.decision_type ?? it.decisionType ?? 'none')
        .trim()
        .toLowerCase();
      if (progress === 'parked') decisionRaw = 'parked';
      const decision_type = DECISION_TYPES.has(decisionRaw) ? decisionRaw : 'none';
      const row = {
        finding_key: findingKey,
        property_url: propertyUrl,
        progress,
        note,
        decision_type: decision_type === 'none' ? null : decision_type,
        worked_at: now,
        updated_at: now,
        last_seen_at: now,
        cleared_at: null
      };
      if (it.index_requested_at || it.indexRequestedAt) {
        const d = new Date(String(it.index_requested_at || it.indexRequestedAt));
        if (!Number.isNaN(d.getTime())) row.index_requested_at = d.toISOString();
      }
      rows.push(row);
    }

    if (!rows.length) {
      return sendJson(res, 400, { status: 'error', message: 'No valid finding keys.' });
    }

    const { error } = await sb.from('config_integrity_finding_state').upsert(rows, {
      onConflict: 'finding_key'
    });
    if (error) throw error;

    const keys = rows.map((r) => r.finding_key);
    const { data, error: rErr } = await sb
      .from('config_integrity_finding_state')
      .select('*')
      .in('finding_key', keys);
    if (rErr) throw rErr;

    return sendJson(res, 200, {
      status: 'ok',
      results: (data || []).map(rowOut),
      meta: { generatedAt: now, saved: (data || []).length }
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('missing_env:')) {
      return sendJson(res, 500, { status: 'error', message: 'Supabase env not configured.' });
    }
    if (msg.includes('missing_table') || err?.code === 'MISSING_TABLE') {
      return sendJson(res, 500, {
        status: 'error',
        message: 'Apply migration config_integrity_finding_state first.'
      });
    }
    return sendJson(res, 500, { status: 'error', message: msg });
  }
}
