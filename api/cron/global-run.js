import { computeNextRunAt, shouldRunNow } from '../../lib/cron/schedule.js';

export const config = { runtime: 'nodejs' };

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

const fetchJson = async (url, options) => {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json();
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use GET.' });
  }

  const cronSecret = process.env.CRON_SECRET;
  const requestSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret && requestSecret !== cronSecret) {
    return sendJson(res, 401, {
      status: 'error',
      message: 'Unauthorized cron request',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  const propertyUrl = req.query.propertyUrl || process.env.CRON_PROPERTY_URL || 'https://www.alanranger.com';
  const fallbackBaseUrl = req.headers.host
    ? `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`
    : 'http://localhost:3000';
  const baseUrl = process.env.CRON_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || fallbackBaseUrl;
  const nowIso = new Date().toISOString();
  let schedule = { frequency: 'weekly', timeOfDay: '11:20' };

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
            global_run: {
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
      console.warn('[Global Cron] Failed to update schedule status:', err.message);
    }
  };

  try {
    const scheduleResp = await fetchJson(`${baseUrl}/api/supabase/get-cron-schedule?jobKey=global_run`);
    schedule = scheduleResp?.data?.jobs?.global_run || schedule;

    if (!shouldRunNow(schedule)) {
      return sendJson(res, 200, {
        status: 'skipped',
        message: 'Schedule not due.',
        schedule,
        meta: { generatedAt: nowIso }
      });
    }

    const headers = cronSecret
      ? { 'x-cron-secret': cronSecret }
      : undefined;

    const syncResult = await fetchJson(`${baseUrl}/api/sync-csv`, { method: 'GET', headers });

    const gscResult = await fetchJson(
      `${baseUrl}/api/cron/daily-gsc-backlink?propertyUrl=${encodeURIComponent(propertyUrl)}`,
      { method: 'GET', headers }
    );

    const rankingResult = await fetchJson(
      `${baseUrl}/api/cron/keyword-ranking-ai?propertyUrl=${encodeURIComponent(propertyUrl)}`,
      { method: 'GET', headers }
    );

    const domainStrengthResult = await fetchJson(
      `${baseUrl}/api/domain-strength/snapshot`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'run', includePending: true })
      }
    );

    const bulkHeaders = {
      'Content-Type': 'application/json',
      ...(cronSecret ? { 'x-cron-secret': cronSecret } : {})
    };
    const bulkUpdateResult = await fetchJson(
      `${baseUrl}/api/optimisation/bulk-update?propertyUrl=${encodeURIComponent(propertyUrl)}`,
      { method: 'POST', headers: bulkHeaders }
    );

    await updateScheduleStatus('ok');

    return sendJson(res, 200, {
      status: 'ok',
      message: 'Global audit run complete.',
      results: {
        sync_csv: syncResult?.status || 'ok',
        gsc_backlinks: gscResult?.status || 'ok',
        ranking_ai: rankingResult?.status || 'ok',
        domain_strength: domainStrengthResult?.status || 'ok',
        task_updates: bulkUpdateResult?.status || 'ok'
      },
      meta: { generatedAt: nowIso }
    });
  } catch (err) {
    await updateScheduleStatus('error', err.message);
    console.error('[Global Cron] Error:', err.message);
    return sendJson(res, 500, { status: 'error', message: err.message });
  }
}
