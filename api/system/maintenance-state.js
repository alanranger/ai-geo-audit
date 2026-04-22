// /api/system/maintenance-state.js
// Read-only status endpoint used by the UI to show a "BACKUP IN PROGRESS" banner.
// Returns the current state of known maintenance jobs. Safe for public read
// because it exposes no PII — only job key, state, and timestamps.

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const STALE_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_KEYS = ['optimisation_backup'];

const need = (key) => {
  const value = process.env[key];
  if (!value || !String(value).trim()) throw new Error(`missing_env:${key}`);
  return value;
};

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

function deriveEffectiveState(row, now) {
  if (!row) return { state: 'idle', stale: false };
  if (row.state !== 'running') return { state: row.state || 'idle', stale: false };
  const started = row.started_at ? new Date(row.started_at).getTime() : 0;
  const age = started ? now - started : Infinity;
  if (age > STALE_AFTER_MS) {
    return { state: 'idle', stale: true };
  }
  return { state: 'running', stale: false };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, {});
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed. Use GET.' });
  }

  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const keysParam = typeof req.query.keys === 'string' ? req.query.keys : '';
    const keys = keysParam
      ? keysParam.split(',').map((s) => s.trim()).filter(Boolean)
      : DEFAULT_KEYS;

    const { data, error } = await supabase
      .from('system_maintenance_state')
      .select('key, state, started_at, finished_at, last_success_at, last_error, last_details, updated_at')
      .in('key', keys);

    if (error) {
      return sendJson(res, 500, { error: error.message });
    }

    const now = Date.now();
    const rows = (data || []).map((row) => {
      const effective = deriveEffectiveState(row, now);
      return {
        key: row.key,
        state: effective.state,
        stale_running_cleared: effective.stale,
        started_at: row.started_at,
        finished_at: row.finished_at,
        last_success_at: row.last_success_at,
        last_error: row.last_error,
        last_details: row.last_details,
        updated_at: row.updated_at
      };
    });

    const anyRunning = rows.some((r) => r.state === 'running');

    return sendJson(res, 200, {
      any_running: anyRunning,
      jobs: rows,
      meta: { generatedAt: new Date(now).toISOString(), stale_after_ms: STALE_AFTER_MS }
    });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || 'Internal server error' });
  }
}
