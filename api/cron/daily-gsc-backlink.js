import { computeNextRunAt, shouldRunNow } from '../../lib/cron/schedule.js';

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

    const syncResult = await fetchJson(`${baseUrl}/api/sync-csv`);
    const gscResult = await fetchJson(
      `${baseUrl}/api/aigeo/gsc-entity-metrics?property=${encodeURIComponent(propertyUrl)}`
    );
    const backlinkResult = await fetchJson(`${baseUrl}/api/aigeo/backlink-metrics`);
    const localSignalsResult = await fetchJson(
      `${baseUrl}/api/aigeo/local-signals?property=${encodeURIComponent(propertyUrl)}`
    );

    const overview = gscResult?.data?.overview || {};
    const searchData = {
      totalClicks: overview.totalClicks || 0,
      totalImpressions: overview.totalImpressions || 0,
      averagePosition: overview.avgPosition || 0,
      ctr: overview.ctr || 0,
      overview: {
        clicks: overview.totalClicks || 0,
        impressions: overview.totalImpressions || 0,
        position: overview.avgPosition || 0,
        ctr: overview.ctr || 0,
        totalClicks: overview.totalClicks || 0,
        totalImpressions: overview.totalImpressions || 0,
        siteTotalClicks: overview.totalClicks || 0,
        siteTotalImpressions: overview.totalImpressions || 0
      },
      timeseries: gscResult?.data?.timeseries || [],
      topQueries: gscResult?.data?.topQueries || [],
      topPages: gscResult?.data?.topPages || [],
      queryPages: gscResult?.data?.queryPages || [],
      queryTotals: gscResult?.data?.queryTotals || [],
      dateRange: 28,
      propertyUrl
    };

    const payload = {
      propertyUrl,
      auditDate: new Date().toISOString().split('T')[0],
      searchData,
      backlinkMetrics: backlinkResult?.data || null,
      localSignals: localSignalsResult || null
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
        syncCsv: syncResult?.status || 'ok',
        gsc: gscResult?.status || 'ok',
        backlinks: backlinkResult?.status || 'ok',
        localSignals: localSignalsResult?.status || 'ok',
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
