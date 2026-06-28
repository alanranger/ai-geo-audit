// /api/system/db-busy.js
// Lightweight pre-flight guard so heavy jobs (the GSC & Backlink audit) can bail
// out instead of piling onto an already-saturated database. The shared Supabase
// instance runs hourly refresh cron jobs that can take 30-75s; starting an audit
// on top of that pegs the instance and returns 522s across the dashboard.
//
// busy=true when EITHER:
//   (a) a tracked maintenance job (backup / audit) is currently running, or
//   (b) a trivial read does not return within PING_TIMEOUT_MS — a reliable proxy
//       for a pegged instance (when overloaded, even a 1-row read stalls).
// Fails OPEN on config errors so a missing/misconfigured guard never blocks audits.

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const PING_TIMEOUT_MS = 4000;
const STALE_AFTER_MS = 5 * 60 * 1000;
const BUSY_KEYS = ['optimisation_backup', 'gsc_audit'];

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

const isRunning = (row, now) => (
  row.state === 'running' &&
  row.started_at &&
  (now - new Date(row.started_at).getTime()) < STALE_AFTER_MS
);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, {});
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed. Use GET.' });
  }

  let supabase;
  try {
    supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  } catch (err) {
    return sendJson(res, 200, { busy: false, db_responsive: null, reason: 'guard_unavailable', error: err.message });
  }

  const started = Date.now();
  const ping = supabase
    .from('system_maintenance_state')
    .select('key, state, started_at')
    .in('key', BUSY_KEYS);
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('db_ping_timeout')), PING_TIMEOUT_MS);
  });

  let rows;
  try {
    const { data, error } = await Promise.race([ping, timeout]);
    if (error) throw new Error(error.message);
    rows = data || [];
  } catch (err) {
    return sendJson(res, 200, {
      busy: true,
      db_responsive: false,
      reason: 'database not responding (overloaded)',
      ping_ms: Date.now() - started,
      detail: err.message
    });
  }

  const now = Date.now();
  const running = rows.find((row) => isRunning(row, now));
  if (running) {
    return sendJson(res, 200, { busy: true, db_responsive: true, reason: `${running.key} in progress` });
  }

  return sendJson(res, 200, { busy: false, db_responsive: true, ping_ms: Date.now() - started });
}
