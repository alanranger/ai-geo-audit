export const config = { runtime: 'nodejs', maxDuration: 300 };

import { createClient } from '@supabase/supabase-js';
import { computeNextRunAt, shouldRunNow } from '../../lib/cron/schedule.js';
import { logCronEvent } from '../../lib/cron/logCron.js';

const JOB_KEY = 'optimisation_backup';
const DEFAULT_SCHEDULE = { frequency: 'daily', timeOfDay: '19:00' };
const MAINTENANCE_KEY = 'optimisation_backup';
const BUCKET = 'optimisation-backups';
const TABLES = [
  'optimisation_tasks',
  'optimisation_task_cycles',
  'optimisation_task_events',
  'optimisation_tasks_delete_audit',
  'optimisation_task_cycles_delete_audit',
  'optimisation_task_events_delete_audit'
];
const RETENTION_DAYS = 30;
const PAGE_SIZE = 1000;

const need = (key) => {
  const value = process.env[key];
  if (!value || !String(value).trim()) throw new Error(`missing_env:${key}`);
  return value;
};

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Cron-Secret');
  res.status(status).send(JSON.stringify(body));
};

const normalizeBaseUrl = (value) => {
  if (!value) return '';
  return value.replace(/\/+$/, '');
};

const resolveBaseUrl = (req) => {
  const fallback = req.headers.host
    ? `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`
    : 'http://localhost:3000';
  return normalizeBaseUrl(process.env.CRON_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || fallback);
};

const getSupabase = () => createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));

async function fetchAllRows(supabase, table) {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetch_${table}_failed:${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function uploadBackup(supabase, path, ndjsonBuffer) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, ndjsonBuffer, {
      upsert: true,
      contentType: 'application/x-ndjson'
    });
  if (error) throw new Error(`upload_${path}_failed:${error.message}`);
}

async function backupTable(supabase, table, dayStamp) {
  const rows = await fetchAllRows(supabase, table);
  const ndjson = rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  const buf = Buffer.from(ndjson, 'utf-8');
  const dayPath = `${dayStamp}/${table}.ndjson`;
  const latestPath = `latest/${table}.ndjson`;
  await uploadBackup(supabase, dayPath, buf);
  await uploadBackup(supabase, latestPath, buf);
  return { table, rows: rows.length, bytes: buf.length, day_path: dayPath };
}

async function pruneOldBackups(supabase) {
  const { data, error } = await supabase.storage.from(BUCKET).list('', { limit: 1000 });
  if (error) throw new Error(`list_backups_failed:${error.message}`);
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  const cutoffStamp = cutoff.toISOString().slice(0, 10);
  const dayDirs = (data || [])
    .map((entry) => entry.name)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name) && name < cutoffStamp);

  const removed = [];
  for (const dir of dayDirs) {
    const { data: files } = await supabase.storage.from(BUCKET).list(dir);
    if (!files || files.length === 0) continue;
    const paths = files.map((f) => `${dir}/${f.name}`);
    await supabase.storage.from(BUCKET).remove(paths);
    removed.push(dir);
  }
  return removed;
}

async function updateScheduleStatus(baseUrl, schedule, nowIso, status, errorMessage = null) {
  try {
    const nextRunAt = computeNextRunAt({
      frequency: schedule.frequency,
      timeOfDay: schedule.timeOfDay,
      lastRunAt: nowIso
    });
    await fetch(`${baseUrl}/api/supabase/save-cron-schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobs: {
          [JOB_KEY]: {
            frequency: schedule.frequency,
            timeOfDay: schedule.timeOfDay,
            lastRunAt: nowIso,
            nextRunAt,
            lastStatus: status,
            lastError: errorMessage
          }
        }
      })
    });
  } catch (err) {
    console.warn('[Optimisation Backup] Failed to update schedule status:', err.message);
  }
}

function isAuthorized(req) {
  const cronSecret = process.env.CRON_SECRET;
  const requestSecret = req.headers['x-cron-secret'] || req.query.secret;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  return !cronSecret || isVercelCron || requestSecret === cronSecret;
}

async function loadSchedule(baseUrl) {
  try {
    const resp = await fetch(`${baseUrl}/api/supabase/get-cron-schedule?jobKey=${JOB_KEY}`);
    const json = await resp.json().catch(() => null);
    return json?.data?.jobs?.[JOB_KEY] || { ...DEFAULT_SCHEDULE };
  } catch (err) {
    console.warn('[Optimisation Backup] schedule load failed:', err.message);
    return { ...DEFAULT_SCHEDULE };
  }
}

async function runBackup(supabase, dayStamp) {
  const results = [];
  for (const table of TABLES) {
    results.push(await backupTable(supabase, table, dayStamp));
  }
  const pruned = await pruneOldBackups(supabase);
  return { results, pruned };
}

async function setMaintenanceState(supabase, patch) {
  try {
    await supabase
      .from('system_maintenance_state')
      .upsert({ key: MAINTENANCE_KEY, updated_at: new Date().toISOString(), ...patch }, { onConflict: 'key' });
  } catch (err) {
    console.warn('[Optimisation Backup] Failed to update maintenance state:', err.message);
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, {});
  if (req.method !== 'GET') {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use GET.' });
  }
  if (!isAuthorized(req)) {
    return sendJson(res, 401, { status: 'error', message: 'Unauthorized cron request' });
  }

  const baseUrl = resolveBaseUrl(req);
  const nowIso = new Date().toISOString();
  const startedAt = Date.now();
  const forceRun = req.query.force === '1' || req.query.force === 'true';
  const schedule = await loadSchedule(baseUrl);

  if (!forceRun && !shouldRunNow(schedule)) {
    return sendJson(res, 200, {
      status: 'skipped',
      message: 'Schedule not due.',
      schedule,
      meta: { generatedAt: nowIso }
    });
  }

  const supabase = getSupabase();
  const dayStamp = nowIso.slice(0, 10);

  await setMaintenanceState(supabase, {
    state: 'running',
    started_at: nowIso,
    finished_at: null,
    last_error: null
  });

  try {
    const { results, pruned } = await runBackup(supabase, dayStamp);
    const finishedAt = new Date().toISOString();

    await setMaintenanceState(supabase, {
      state: 'idle',
      finished_at: finishedAt,
      last_success_at: finishedAt,
      last_error: null,
      last_details: { tables: results.length, pruned_days: pruned.length, dayStamp }
    });
    await updateScheduleStatus(baseUrl, schedule, nowIso, 'success');
    await logCronEvent({
      jobKey: JOB_KEY,
      status: 'success',
      durationMs: Date.now() - startedAt,
      details: JSON.stringify({ tables: results.length, pruned_days: pruned.length })
    });

    return sendJson(res, 200, {
      status: 'ok',
      dayStamp,
      bucket: BUCKET,
      backed_up: results,
      pruned_days: pruned,
      retention_days: RETENTION_DAYS,
      meta: { generatedAt: nowIso }
    });
  } catch (err) {
    await setMaintenanceState(supabase, {
      state: 'idle',
      finished_at: new Date().toISOString(),
      last_error: err.message
    });
    await updateScheduleStatus(baseUrl, schedule, nowIso, 'error', err.message);
    await logCronEvent({
      jobKey: JOB_KEY,
      status: 'error',
      durationMs: Date.now() - startedAt,
      details: err.message
    });
    return sendJson(res, 500, { status: 'error', message: err.message, meta: { generatedAt: nowIso } });
  }
}
