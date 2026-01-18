import { computeNextRunAt, shouldRunNow } from '../../lib/cron/schedule.js';
import { runFullAudit } from '../../lib/audit/fullAudit.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Cron-Secret');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed. Use GET.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  const cronSecret = process.env.CRON_SECRET;
  const requestSecret = req.headers['x-cron-secret'];
  if (cronSecret && requestSecret !== cronSecret) {
    return res.status(401).json({
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

  const fetchJson = async (url, options) => {
    const response = await fetch(url, options);
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (err) {
      console.warn('[Daily Cron] Failed to parse JSON response:', err.message);
      json = null;
    }
    if (!response.ok) {
      const errorMessage = json?.message || text || `HTTP ${response.status}`;
      throw new Error(errorMessage);
    }
    return json;
  };

  const nowIso = new Date().toISOString();
  let schedule = { frequency: 'daily', timeOfDay: '11:00' };
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
            gsc_backlinks: {
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
      console.warn('[Daily Cron] Failed to update schedule status:', err.message);
    }
  };

  try {
    const scheduleResp = await fetchJson(`${baseUrl}/api/supabase/get-cron-schedule?jobKey=gsc_backlinks`);
    schedule = scheduleResp?.data?.jobs?.gsc_backlinks || schedule;

    if (!shouldRunNow(schedule)) {
      return res.status(200).json({
        status: 'skipped',
        message: 'Schedule not due.',
        schedule,
        meta: { generatedAt: nowIso }
      });
    }

    const audit = await runFullAudit({
      baseUrl,
      propertyUrl,
      dateRangeDays: 28
    });

    const payload = {
      propertyUrl,
      auditDate: new Date().toISOString().split('T')[0],
      searchData: audit.searchData,
      scores: audit.scores,
      snippetReadiness: audit.snippetReadiness,
      schemaAudit: audit.schemaAudit,
      localSignals: audit.localSignals,
      backlinkMetrics: audit.backlinkMetrics || null,
      moneyPagesSummary: audit.moneyPagesSummary,
      moneySegmentMetrics: audit.moneySegmentMetrics,
      moneyPagePriorityData: audit.moneyPagePriorityData
    };

    const saveResult = await fetchJson(`${baseUrl}/api/supabase/save-audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    await updateScheduleStatus('ok');

    return res.status(200).json({
      status: 'ok',
      message: 'Daily GSC + Backlink audit completed',
      data: {
        propertyUrl,
        gsc: 'ok',
        backlinks: 'ok',
        localSignals: 'ok',
        save: saveResult?.status || 'ok'
      },
      meta: { generatedAt: new Date().toISOString() }
    });
  } catch (error) {
    await updateScheduleStatus('error', error.message);
    return res.status(500).json({
      status: 'error',
      message: 'Daily audit failed',
      details: error.message,
      meta: { generatedAt: new Date().toISOString(), propertyUrl }
    });
  }
}
