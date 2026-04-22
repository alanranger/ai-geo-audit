import { computeNextRunAt, shouldRunNow } from '../../lib/cron/schedule.js';
import { logCronEvent } from '../../lib/cron/logCron.js';
import {
  fetchJson,
  fetchSerpRows,
  fetchAiRows,
  buildCombinedRows,
  buildSummary,
  buildKeywordRows,
  saveKeywordBatch
} from '../../lib/keyword-ranking/refresh-core.js';

export const config = { runtime: 'nodejs', maxDuration: 300 };

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

const getSchedule = async (baseUrl) => {
  const scheduleResp = await fetchJson(`${baseUrl}/api/supabase/get-cron-schedule?jobKey=ranking_ai`);
  return scheduleResp?.data?.jobs?.ranking_ai || { frequency: 'daily', timeOfDay: '11:10' };
};

const getKeywords = async (baseUrl) => {
  const keywordsResp = await fetchJson(`${baseUrl}/api/keywords/get`);
  return (keywordsResp?.keywords || keywordsResp?.data || []).map(String).filter(Boolean);
};

const upsertAuditResults = async (payload) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return;
  const response = await fetch(`${supabaseUrl}/rest/v1/audit_results?on_conflict=property_url,audit_date`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
};

const updateSchedule = async (baseUrl, schedule, nowIso, status, errorMessage = null) => {
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
        ranking_ai: {
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
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  if (cronSecret && !isVercelCron && requestSecret !== cronSecret) {
    return sendJson(res, 401, {
      status: 'error',
      message: 'Unauthorized cron request',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  const forceRun = req.query.force === '1' || req.query.force === 'true';
  const startedAt = Date.now();

  try {
    const propertyUrl = req.query.propertyUrl || process.env.CRON_PROPERTY_URL || 'https://www.alanranger.com';
    const fallbackBaseUrl = req.headers.host
      ? `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`
      : 'http://localhost:3000';
    const baseUrl = process.env.CRON_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || fallbackBaseUrl;
    const nowIso = new Date().toISOString();

    const schedule = await getSchedule(baseUrl);

    if (!forceRun && !shouldRunNow(schedule)) {
      return sendJson(res, 200, {
        status: 'skipped',
        message: 'Schedule not due.',
        schedule,
        meta: { generatedAt: nowIso }
      });
    }

    const keywords = await getKeywords(baseUrl);
    if (!keywords.length) {
      return sendJson(res, 200, {
        status: 'skipped',
        message: 'No keywords found.',
        meta: { generatedAt: nowIso }
      });
    }

    // 2026-04-22 spend-guard: removed the 20/10/5 batch-size retry cascade.
    // Empty SERP rows almost always mean DFS billing/credit failure; retrying
    // with smaller batches just fires the same expensive requests 3 more times
    // ($50-70 in credits on 2026-04-22). One pass, then surface the error.
    const serpRows = await fetchSerpRows(baseUrl, keywords, { batchSize: 20, concurrency: 4 });
    const aiRows = await fetchAiRows(baseUrl, keywords, { batchSize: 10, concurrency: 4 });
    const combinedRows = buildCombinedRows(serpRows, aiRows);
    if (!combinedRows.length) {
      await updateSchedule(baseUrl, schedule, nowIso, 'error', 'No SERP rows returned for keywords');
      await logCronEvent({
        jobKey: 'ranking_ai',
        status: 'error',
        propertyUrl,
        durationMs: Date.now() - startedAt,
        details: 'No SERP rows returned for keywords'
      });
      return sendJson(res, 500, {
        status: 'error',
        message: 'No SERP rows returned for keywords',
        meta: { generatedAt: nowIso }
      });
    }

    const auditDate = new Date().toISOString().slice(0, 10);
    const summary = buildSummary(combinedRows);
    const keywordRows = buildKeywordRows(combinedRows, auditDate, propertyUrl);

    await saveKeywordBatch(baseUrl, { propertyUrl, auditDate, keywordRows });
    await upsertAuditResults({
      property_url: propertyUrl,
      audit_date: auditDate,
      ranking_ai_data: { summary, combinedRows, lastRunTimestamp: nowIso },
      updated_at: nowIso
    });
    await updateSchedule(baseUrl, schedule, nowIso, 'ok');
    await logCronEvent({
      jobKey: 'ranking_ai',
      status: 'success',
      propertyUrl,
      durationMs: Date.now() - startedAt
    });

    return sendJson(res, 200, {
      status: 'ok',
      message: 'Keyword ranking & AI audit complete.',
      summary,
      meta: { generatedAt: nowIso }
    });
  } catch (err) {
    try {
      const fallbackBaseUrl = req.headers.host
        ? `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`
        : 'http://localhost:3000';
      const baseUrl = process.env.CRON_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || fallbackBaseUrl;
      const nowIso = new Date().toISOString();
      const schedule = await getSchedule(baseUrl);
      await updateSchedule(baseUrl, schedule, nowIso, 'error', err.message);
    } catch (error_) {
      console.warn('[Keyword Ranking Cron] Failed to update schedule status:', error_.message);
    }
    await logCronEvent({
      jobKey: 'ranking_ai',
      status: 'error',
      propertyUrl: req.query.propertyUrl || process.env.CRON_PROPERTY_URL || 'https://www.alanranger.com',
      durationMs: Date.now() - startedAt,
      details: err.message
    });
    console.error('[Keyword Ranking Cron] Error:', err.message);
    return sendJson(res, 500, { status: 'error', message: err.message });
  }
}
