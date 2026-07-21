/**
 * Weekly cron: refresh GSC URL Inspection cache for WS3 recrawl watch URLs only (12 paths).
 * Vercel schedule: Sunday 22:00 UTC ≈ 23:00 Europe/London in BST; 22:00 GMT in winter.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logCronEvent } from '../../lib/cron/logCron.js';
import { computeNextRunAt, shouldRunNow } from '../../lib/cron/schedule.js';

const JOB_KEY = 'ws3_recrawl_gsc_inspection';
const DEFAULT_SCHEDULE = { frequency: 'weekly', timeOfDay: '22:00' };
const BATCH_SIZE = 5;
const BATCH_PAUSE_MS = 8000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WATCH_PATH = path.join(ROOT, 'config/ws3-recrawl-watch-urls.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Cron-Secret');
  res.status(status).send(JSON.stringify(body));
};

const normalizeBaseUrl = (value) => String(value || '').replace(/\/+$/, '');

const resolveBaseUrl = (req) => {
  const fallback = req.headers.host
    ? `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`
    : 'http://localhost:3000';
  return normalizeBaseUrl(process.env.CRON_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || fallback);
};

function loadWatchUrls() {
  const raw = JSON.parse(fs.readFileSync(WATCH_PATH, 'utf8'));
  return Array.isArray(raw.urls) ? raw.urls : [];
}

function buildAbsoluteUrls(entries, propertyUrl) {
  const base = String(propertyUrl || 'https://www.alanranger.com').replace(/\/+$/, '');
  return entries
    .map((entry) => {
      const p = String(entry?.path || entry || '').trim();
      if (!p) return '';
      if (/^https?:\/\//i.test(p)) return p;
      return `${base}${p.startsWith('/') ? p : `/${p}`}`;
    })
    .filter(Boolean);
}

function chunkUrls(urls, size) {
  const chunks = [];
  for (let i = 0; i < urls.length; i += size) {
    chunks.push(urls.slice(i, i + size));
  }
  return chunks;
}

async function inspectBatch(baseUrl, propertyUrl, urls) {
  const resp = await fetch(`${baseUrl}/api/aigeo/gsc-url-inspection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ propertyUrl, urls }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || String(json?.status || '').toLowerCase() !== 'ok') {
    throw new Error(json?.message || `inspect_batch_failed:${resp.status}`);
  }
  const results = Array.isArray(json.results) ? json.results : [];
  const errors = results.filter((r) => r?.error || r?.httpOk === false);
  return { results, errors, count: results.length };
}

async function updateScheduleStatus(baseUrl, schedule, nowIso, status, errorMessage = null) {
  try {
    const nextRunAt = computeNextRunAt({
      frequency: schedule.frequency,
      timeOfDay: schedule.timeOfDay,
      lastRunAt: nowIso,
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
            lastError: errorMessage,
          },
        },
      }),
    });
  } catch (err) {
    console.warn('[WS3 GSC inspect cron] Failed to update schedule status:', err.message);
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, {});
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
  const propertyUrl = String(
    req.query.propertyUrl || process.env.CRON_PROPERTY_URL || 'https://www.alanranger.com'
  ).trim();
  let schedule = { ...DEFAULT_SCHEDULE };

  try {
    const scheduleResp = await fetch(`${baseUrl}/api/supabase/get-cron-schedule?jobKey=${JOB_KEY}`);
    const scheduleJson = await scheduleResp.json().catch(() => null);
    schedule = scheduleJson?.data?.jobs?.[JOB_KEY] || schedule;
  } catch (err) {
    console.warn('[WS3 GSC inspect cron] Failed to load schedule, using default:', err.message);
  }

  if (!forceRun && !shouldRunNow(schedule)) {
    return sendJson(res, 200, {
      status: 'skipped',
      message: 'Schedule not due.',
      schedule,
      meta: { generatedAt: nowIso },
    });
  }

  const watchEntries = loadWatchUrls();
  const urls = buildAbsoluteUrls(watchEntries, propertyUrl);
  if (!urls.length) {
    return sendJson(res, 500, {
      status: 'error',
      message: 'No WS3 recrawl watch URLs configured.',
      meta: { generatedAt: nowIso },
    });
  }

  const batches = chunkUrls(urls, BATCH_SIZE);
  const batchResults = [];
  let totalRefreshed = 0;
  let totalErrors = 0;

  try {
    for (let i = 0; i < batches.length; i += 1) {
      if (i > 0) await sleep(BATCH_PAUSE_MS);
      const batch = batches[i];
      const result = await inspectBatch(baseUrl, propertyUrl, batch);
      totalRefreshed += result.count;
      totalErrors += result.errors.length;
      batchResults.push({
        batch: i + 1,
        urls: batch.length,
        refreshed: result.count,
        errors: result.errors.length,
      });
    }

    const runStatus = totalErrors ? 'partial' : 'success';
    await updateScheduleStatus(baseUrl, schedule, nowIso, runStatus);
    await logCronEvent({
      jobKey: JOB_KEY,
      status: totalErrors ? 'error' : 'success',
      propertyUrl,
      durationMs: Date.now() - startedAt,
      details: {
        urlsTotal: urls.length,
        urlsRefreshed: totalRefreshed,
        errors: totalErrors,
        batches: batchResults,
      },
    });

    return sendJson(res, 200, {
      status: 'ok',
      jobKey: JOB_KEY,
      propertyUrl,
      urlsTotal: urls.length,
      urlsRefreshed: totalRefreshed,
      errors: totalErrors,
      batches: batchResults,
      scheduleNote: 'Scheduled Sun 23:00 Europe/London via 22:00 UTC (BST=23:00 UK; winter GMT=22:00 UK — acceptable).',
      meta: { generatedAt: nowIso, lastAutoRefreshAt: nowIso },
    });
  } catch (err) {
    await updateScheduleStatus(baseUrl, schedule, nowIso, 'error', err.message);
    await logCronEvent({
      jobKey: JOB_KEY,
      status: 'error',
      propertyUrl,
      durationMs: Date.now() - startedAt,
      details: err.message,
    });
    return sendJson(res, 500, {
      status: 'error',
      message: err.message,
      propertyUrl,
      urlsTotal: urls.length,
      batches: batchResults,
      meta: { generatedAt: nowIso },
    });
  }
}
