import { computeNextRunAt, shouldRunNow } from '../../lib/cron/schedule.js';
import { runFullAudit } from '../../lib/audit/fullAudit.js';
import { logCronEvent } from '../../lib/cron/logCron.js';

const normalizeUrl = (url) => {
  if (!url) return '';
  let normalized = String(url).toLowerCase().trim();
  normalized = normalized.replace(/^https?:\/\//, '');
  normalized = normalized.replace(/^www\./, '');
  normalized = normalized.split('?')[0].split('#')[0];
  const parts = normalized.split('/');
  if (parts.length > 1) {
    normalized = parts.slice(1).join('/');
  }
  return normalized.replace(/^\/+/, '').replace(/\/+$/, '');
};

const buildRollingDateRange = (daysBack = 28) => {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(daysBack - 1, 0));
  start.setHours(0, 0, 0, 0);
  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0]
  };
};

const buildDateSeries = (endDate, days) => {
  const list = [];
  const end = new Date(`${endDate}T00:00:00Z`);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    list.push(d.toISOString().split('T')[0]);
  }
  return list;
};

const buildMoneyPageGridRows = ({ propertyUrl, moneyPages, timeseries, days }) => {
  const pageSet = new Set(moneyPages.map((row) => normalizeUrl(row?.url || row)).filter(Boolean));
  if (pageSet.size === 0) return [];
  const { endDate } = buildRollingDateRange(days);
  const dateSeries = buildDateSeries(endDate, days);
  const pageMap = new Map();
  (timeseries || []).forEach((row) => {
    const pageKey = normalizeUrl(row.page || row.url || '');
    if (!pageKey) return;
    if (!pageMap.has(pageKey)) pageMap.set(pageKey, new Map());
    pageMap.get(pageKey).set(row.date, row);
  });
  const records = [];
  pageSet.forEach((pageKey) => {
    const perDate = pageMap.get(pageKey) || new Map();
    dateSeries.forEach((date) => {
      const existing = perDate.get(date);
      records.push({
        propertyUrl,
        page: pageKey,
        date,
        clicks: Number(existing?.clicks || 0),
        impressions: Number(existing?.impressions || 0),
        ctr: Number(existing?.ctr || 0),
        position: existing?.position ?? null
      });
    });
  });
  return records;
};

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
  const requestSecret = req.headers['x-cron-secret'] || req.query.secret;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  if (cronSecret && !isVercelCron && requestSecret !== cronSecret) {
    return res.status(401).json({
      status: 'error',
      message: 'Unauthorized cron request',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  const propertyUrl = req.query.propertyUrl || process.env.CRON_PROPERTY_URL || 'https://www.alanranger.com';
  const forceRun = req.query.force === '1' || req.query.force === 'true';
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
  const startedAt = Date.now();
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

    if (!forceRun && !shouldRunNow(schedule)) {
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
      moneyPagesMetrics: audit.moneyPagesMetrics || null,
      moneyPagesSummary: audit.moneyPagesSummary,
      moneySegmentMetrics: audit.moneySegmentMetrics,
      moneyPagePriorityData: audit.moneyPagePriorityData
    };

    const saveResult = await fetchJson(`${baseUrl}/api/supabase/save-audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    let pageTimeseriesSave = null;
    try {
      const moneyPages = Array.isArray(audit.moneyPagesMetrics?.rows)
        ? audit.moneyPagesMetrics.rows
        : [];
      const gridRows = buildMoneyPageGridRows({
        propertyUrl,
        moneyPages,
        timeseries: audit.moneyPagesTimeseries,
        days: 28
      });
      if (gridRows.length > 0) {
        pageTimeseriesSave = await fetchJson(`${baseUrl}/api/supabase/save-gsc-page-timeseries`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            propertyUrl,
            rows: gridRows
          })
        });
      }
    } catch (err) {
      pageTimeseriesSave = { status: 'error', message: err.message };
    }

    await updateScheduleStatus('ok');
    await logCronEvent({
      jobKey: 'gsc_backlinks',
      status: 'success',
      propertyUrl,
      durationMs: Date.now() - startedAt
    });

    return res.status(200).json({
      status: 'ok',
      message: 'Daily GSC + Backlink audit completed',
      data: {
        propertyUrl,
        gsc: 'ok',
        backlinks: 'ok',
        localSignals: 'ok',
        save: saveResult?.status || 'ok',
        pageTimeseries: pageTimeseriesSave?.status || (pageTimeseriesSave ? 'ok' : 'skipped')
      },
      meta: { generatedAt: new Date().toISOString() }
    });
  } catch (error) {
    await updateScheduleStatus('error', error.message);
    await logCronEvent({
      jobKey: 'gsc_backlinks',
      status: 'error',
      propertyUrl,
      durationMs: Date.now() - startedAt,
      details: error.message
    });
    return res.status(500).json({
      status: 'error',
      message: 'Daily audit failed',
      details: error.message,
      meta: { generatedAt: new Date().toISOString(), propertyUrl }
    });
  }
}
