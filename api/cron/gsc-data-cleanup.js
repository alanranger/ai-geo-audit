export const config = { runtime: 'nodejs', maxDuration: 300 };

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { computeNextRunAt, shouldRunNow } from '../../lib/cron/schedule.js';
import { logCronEvent } from '../../lib/cron/logCron.js';

const JOB_KEY = 'gsc_cleanup';
const DEFAULT_SCHEDULE = { frequency: 'monthly', timeOfDay: '02:30' };

const need = (key) => {
  const value = process.env[key];
  if (!value || !String(value).trim()) {
    throw new Error(`missing_env:${key}`);
  }
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

const getSupabaseClient = () =>
  createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));

const calculateCutoffDate = (now = new Date()) => {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 18);
  cutoff.setUTCDate(cutoff.getUTCDate() - 15);
  return {
    cutoffDate: cutoff.toISOString().slice(0, 10),
    cutoffIso: cutoff.toISOString()
  };
};

const buildDatabaseUrl = () => {
  let dbUrl = process.env.SUPABASE_DB_URL;
  if (dbUrl?.includes('[YOUR_PASSWORD]')) {
    dbUrl = null;
  }
  if (dbUrl) return dbUrl;

  const password = (process.env.SUPABASE_DB_PASSWORD || process.env.PGPASSWORD || '').trim();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!password || !supabaseUrl) {
    throw new Error('missing_db_env:SUPABASE_DB_PASSWORD or SUPABASE_URL');
  }
  const match = /https?:\/\/([^.]+)\.supabase\.co/.exec(supabaseUrl);
  if (!match) {
    throw new Error('invalid_supabase_url');
  }
  const projectRef = match[1];
  const encodedPassword = encodeURIComponent(password);
  return `postgresql://postgres:${encodedPassword}@db.${projectRef}.supabase.co:5432/postgres`;
};

const runVacuum = async (tables) => {
  const { Client } = pg;
  const connectionString = buildDatabaseUrl();
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  const results = { success: [], errors: [] };

  await client.connect();
  try {
    for (const table of tables) {
      try {
        const escaped = `"${String(table).replaceAll('"', '""')}"`;
        await client.query(`VACUUM (ANALYZE) ${escaped}`);
        results.success.push(table);
      } catch (err) {
        results.errors.push(`Failed to vacuum ${table}: ${err.message}`);
      }
    }
  } finally {
    await client.end();
  }

  return results;
};

const deleteOldRows = async (supabase, cutoffDate, propertyUrl) => {
  const tables = [
    { table: 'gsc_timeseries', dateColumn: 'date', propertyColumn: 'property_url' },
    { table: 'gsc_page_metrics_28d', dateColumn: 'date_end', propertyColumn: 'site_url' },
    { table: 'portfolio_segment_metrics_28d', dateColumn: 'date_end', propertyColumn: 'site_url' }
  ];

  const results = [];

  for (const item of tables) {
    let query = supabase
      .from(item.table)
      .delete({ count: 'exact' })
      .lt(item.dateColumn, cutoffDate);
    if (propertyUrl) {
      query = query.eq(item.propertyColumn, propertyUrl);
    }
    const { count, error } = await query;
    results.push({
      table: item.table,
      deleted: count || 0,
      error: error ? error.message : null
    });
  }

  return results;
};

const updateScheduleStatus = async (baseUrl, schedule, nowIso, status, errorMessage = null) => {
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
    console.warn('[GSC Cleanup] Failed to update schedule status:', err.message);
  }
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, {});
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use GET.' });
  }

  const cronSecret = process.env.CRON_SECRET;
  const requestSecret = req.headers['x-cron-secret'] || req.query.secret;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  if (cronSecret && !isVercelCron && requestSecret !== cronSecret) {
    return sendJson(res, 401, { status: 'error', message: 'Unauthorized cron request' });
  }

  const baseUrl = resolveBaseUrl(req);
  const nowIso = new Date().toISOString();
  const startedAt = Date.now();
  const forceRun = req.query.force === '1' || req.query.force === 'true';
  const propertyUrl = req.query.propertyUrl || null;
  let schedule = { ...DEFAULT_SCHEDULE };

  try {
    const scheduleResp = await fetch(`${baseUrl}/api/supabase/get-cron-schedule?jobKey=${JOB_KEY}`);
    const scheduleJson = await scheduleResp.json().catch(() => null);
    schedule = scheduleJson?.data?.jobs?.[JOB_KEY] || schedule;
  } catch (err) {
    console.warn('[GSC Cleanup] Failed to load schedule, using default:', err.message);
  }

  if (!forceRun && !shouldRunNow(schedule)) {
    return sendJson(res, 200, {
      status: 'skipped',
      message: 'Schedule not due.',
      schedule,
      meta: { generatedAt: nowIso }
    });
  }

  try {
    const supabase = getSupabaseClient();
    const { cutoffDate, cutoffIso } = calculateCutoffDate();
    const deleteResults = await deleteOldRows(supabase, cutoffDate, propertyUrl);
    const deleteErrors = deleteResults.filter((item) => item.error);
    if (deleteErrors.length) {
      throw new Error(`delete_failed:${deleteErrors.map((item) => item.table).join(',')}`);
    }

    const vacuumTargets = deleteResults.map((item) => item.table);
    const vacuumResults = vacuumTargets.length ? await runVacuum(vacuumTargets) : { success: [], errors: [] };
    if (vacuumResults.errors.length) {
      throw new Error(`vacuum_failed:${vacuumResults.errors.join('; ')}`);
    }

    await updateScheduleStatus(baseUrl, schedule, nowIso, 'success');
    await logCronEvent({
      jobKey: 'gsc_cleanup',
      status: 'success',
      propertyUrl,
      durationMs: Date.now() - startedAt
    });

    return sendJson(res, 200, {
      status: 'ok',
      cutoffDate,
      cutoffIso,
      propertyUrl,
      deleted: deleteResults,
      vacuum: vacuumResults,
      meta: { generatedAt: nowIso }
    });
  } catch (err) {
    await updateScheduleStatus(baseUrl, schedule, nowIso, 'error', err.message);
    await logCronEvent({
      jobKey: 'gsc_cleanup',
      status: 'error',
      propertyUrl,
      durationMs: Date.now() - startedAt,
      details: err.message
    });
    return sendJson(res, 500, { status: 'error', message: err.message, meta: { generatedAt: nowIso } });
  }
}
