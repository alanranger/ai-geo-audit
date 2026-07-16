import { createClient } from '@supabase/supabase-js';
import { computeNextRunAt, shouldRunNow } from '../../lib/cron/schedule.js';
import { runFullAudit } from '../../lib/audit/fullAudit.js';
import { logCronEvent } from '../../lib/cron/logCron.js';

const MAINTENANCE_KEY = 'gsc_audit';

// Self-lock so the dashboard's pre-flight guard (and a second audit) can see an
// audit is in progress. Fails open: a missing service key never blocks the run.
const getMaintenanceClient = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    return createClient(url, key);
  } catch {
    return null;
  }
};

const setAuditState = async (supabase, patch) => {
  if (!supabase) return;
  try {
    await supabase
      .from('system_maintenance_state')
      .upsert(
        { key: MAINTENANCE_KEY, updated_at: new Date().toISOString(), ...patch },
        { onConflict: 'key' }
      );
  } catch (err) {
    console.warn('[Daily Cron] Failed to update maintenance state:', err.message);
  }
};

// Pre-flight: don't pile onto an overloaded DB. Fails open on any error.
const checkDbBusy = async (baseUrl) => {
  try {
    const resp = await fetch(`${baseUrl}/api/system/db-busy`);
    if (!resp.ok) return { busy: false };
    return await resp.json();
  } catch {
    return { busy: false };
  }
};

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

const formatLocalDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const buildRollingDateRange = (daysBack = 28) => {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(daysBack - 1, 0));
  start.setHours(0, 0, 0, 0);
  return {
    startDate: formatLocalDate(start),
    endDate: formatLocalDate(end)
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
  // 11:20 (not 11:00): the shared DB runs heavy refresh cron jobs on the hour;
  // starting the audit at the top of the hour collides with them and pegs the instance.
  let schedule = { frequency: 'daily', timeOfDay: '11:20' };
  let maintenance = null;
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

    const busy = await checkDbBusy(baseUrl);
    if (busy.busy && !forceRun) {
      await updateScheduleStatus('deferred', busy.reason || 'database busy');
      await logCronEvent({
        jobKey: 'gsc_backlinks',
        status: 'deferred',
        propertyUrl,
        durationMs: Date.now() - startedAt,
        details: busy.reason || 'database busy'
      });
      return res.status(200).json({
        status: 'deferred',
        message: `Audit deferred: ${busy.reason || 'database busy'}. Will retry next schedule.`,
        meta: { generatedAt: nowIso }
      });
    }

    maintenance = getMaintenanceClient();
    await setAuditState(maintenance, {
      state: 'running',
      started_at: new Date().toISOString(),
      finished_at: null,
      last_error: null
    });

    const audit = await runFullAudit({
      baseUrl,
      propertyUrl,
      dateRangeDays: 28
    });

    // Same Brand demand refresh as GSC & Backlink Audit button / Dashboard full refresh
    try {
      await fetchJson(`${baseUrl}/api/cron/gbp-brand-demand-sync`, { method: 'POST' });
      const brandPayload = await fetchJson(
        `${baseUrl}/api/aigeo/brand-demand?propertyUrl=${encodeURIComponent(propertyUrl)}`
      );
      if (brandPayload?.brandOverlay && audit?.scores) {
        audit.scores.brandOverlay = brandPayload.brandOverlay;
      }
    } catch (brandErr) {
      console.warn('[daily-gsc-backlink] GBP/Brand demand refresh skipped:', brandErr?.message || brandErr);
    }

    const auditDate = new Date().toISOString().split('T')[0];
    const payload = {
      propertyUrl,
      auditDate,
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

    let pageMetricsSave = null;
    try {
      const pages = Array.isArray(audit?.gscPageRows) ? audit.gscPageRows : [];
      const gscRange = audit?.gscRange || null;
      if (pages.length > 0 && gscRange?.startDate && gscRange?.endDate) {
        pageMetricsSave = await fetchJson(`${baseUrl}/api/supabase/save-gsc-page-metrics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runId: auditDate,
            siteUrl: propertyUrl,
            dateStart: gscRange.startDate,
            dateEnd: gscRange.endDate,
            pages
          })
        });
      }
    } catch (err) {
      pageMetricsSave = { status: 'error', message: err.message };
    }

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

    let dashboardWindowSave = null;
    try {
      const gscRange = audit?.gscRange || null;
      if (gscRange?.endDate) {
        dashboardWindowSave = await fetchJson(`${baseUrl}/api/supabase/save-dashboard-subsegment-windows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siteUrl: propertyUrl,
            runId: auditDate,
            dateEnd: gscRange.endDate,
            scope: 'all_pages'
          })
        });
      }
    } catch (err) {
      dashboardWindowSave = { status: 'error', message: err.message };
    }

    await setAuditState(maintenance, {
      state: 'idle',
      finished_at: new Date().toISOString(),
      last_success_at: new Date().toISOString(),
      last_error: null
    });
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
        pageMetrics: pageMetricsSave?.status || (pageMetricsSave ? 'ok' : 'skipped'),
        pageTimeseries: pageTimeseriesSave?.status || (pageTimeseriesSave ? 'ok' : 'skipped'),
        dashboardWindows: dashboardWindowSave?.status || (dashboardWindowSave ? 'ok' : 'skipped')
      },
      meta: { generatedAt: new Date().toISOString() }
    });
  } catch (error) {
    await setAuditState(maintenance, {
      state: 'idle',
      finished_at: new Date().toISOString(),
      last_error: error.message
    });
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
