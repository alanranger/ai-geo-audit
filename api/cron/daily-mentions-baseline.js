import { computeNextRunAt, shouldRunNow } from '../../lib/cron/schedule.js';
import { logCronEvent } from '../../lib/cron/logCron.js';

export const config = { runtime: 'nodejs', maxDuration: 300 };

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-cron-secret');
  res.status(status).send(JSON.stringify(body));
};

const fetchJson = async (url, options) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (err) {
    console.warn('[Mentions Cron] Failed to parse JSON response:', err.message);
    json = null;
  }
  if (!response.ok) {
    throw new Error(json?.message || text || `HTTP ${response.status}`);
  }
  return json;
};

const resolveBaseUrl = (req) => {
  const fallback = req.headers.host
    ? `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`
    : 'http://localhost:3000';
  const raw = process.env.CRON_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || fallback;
  return String(raw || '').replace(/\/+$/, '');
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (req.method !== 'GET') {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use GET.' });
  }

  const cronSecret = process.env.CRON_SECRET;
  const requestSecret = req.headers['x-cron-secret'] || req.query.secret;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  if (cronSecret && !isVercelCron && requestSecret !== cronSecret) {
    return sendJson(res, 401, {
      status: 'error',
      message: 'Unauthorized cron request',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  const forceRun = req.query.force === '1' || req.query.force === 'true';
  const baseUrl = resolveBaseUrl(req);
  const nowIso = new Date().toISOString();
  const startedAt = Date.now();
  let schedule = { frequency: 'daily', timeOfDay: '12:00' };

  const updateScheduleStatus = async (status, errorMessage = null) => {
    try {
      const nextRunAt = computeNextRunAt({
        frequency: schedule.frequency,
        timeOfDay: schedule.timeOfDay,
        lastRunAt: nowIso
      });
      await fetchJson(`${baseUrl}/api/supabase/save-cron-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobs: {
            mentions_baseline: {
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
      console.warn('[Mentions Cron] Failed to update schedule status:', err.message);
    }
  };

  try {
    const scheduleResp = await fetchJson(`${baseUrl}/api/supabase/get-cron-schedule?jobKey=mentions_baseline`);
    schedule = scheduleResp?.data?.jobs?.mentions_baseline || schedule;

    if (!forceRun && !shouldRunNow(schedule)) {
      return sendJson(res, 200, {
        status: 'skipped',
        message: 'Schedule not due.',
        schedule,
        meta: { generatedAt: nowIso }
      });
    }

    const ingestion = await fetchJson(`${baseUrl}/api/aigeo/mentions-ingestion?persist=1&maxKeywords=30&perQueryLimit=3`, {
      method: 'GET',
      headers: cronSecret ? { 'x-cron-secret': cronSecret } : {}
    });

    await updateScheduleStatus('ok');
    await logCronEvent({
      jobKey: 'mentions_baseline',
      status: 'success',
      durationMs: Date.now() - startedAt,
      details: `mentions=${ingestion?.data?.mentionsFound ?? 0}, alerts=${ingestion?.data?.alertsCount ?? 0}`
    });

    return sendJson(res, 200, {
      status: 'ok',
      message: 'Daily mentions baseline completed',
      data: ingestion?.data || null,
      meta: { generatedAt: new Date().toISOString() }
    });
  } catch (error) {
    await updateScheduleStatus('error', error.message);
    await logCronEvent({
      jobKey: 'mentions_baseline',
      status: 'error',
      durationMs: Date.now() - startedAt,
      details: error.message
    });
    return sendJson(res, 500, {
      status: 'error',
      message: 'Daily mentions baseline failed',
      details: error.message,
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}
