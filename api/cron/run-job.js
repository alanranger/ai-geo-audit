export const config = { runtime: 'nodejs', maxDuration: 300 };

import { requireAdminKeyOnly } from '../../lib/api/requireAdminKeyOnly.js';

const JOB_ENDPOINTS = {
  gsc_backlinks: '/api/cron/daily-gsc-backlink',
  ranking_ai: '/api/cron/keyword-ranking-ai',
  global_run: '/api/cron/global-run',
  gsc_cleanup: '/api/cron/gsc-data-cleanup'
};

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key');
  res.status(status).send(JSON.stringify(body));
};

const resolveBaseUrl = (req) => {
  const fallback = req.headers.host
    ? `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`
    : 'http://localhost:3000';
  const raw = process.env.CRON_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || fallback;
  return String(raw || '').replace(/\/+$/, '');
};

const readBody = async (req) => {
  if (req.method !== 'POST') return {};
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (err) {
    return {};
  }
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, {});
  }

  if (!['GET', 'POST'].includes(req.method)) {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use GET or POST.' });
  }

  if (!requireAdminKeyOnly(req, res, sendJson)) return;

  const body = await readBody(req);
  const jobKey = String(req.query.jobKey || body.jobKey || '').trim();
  if (!jobKey || !JOB_ENDPOINTS[jobKey]) {
    return sendJson(res, 400, { status: 'error', message: 'Invalid or missing jobKey.' });
  }

  const propertyUrl = req.query.propertyUrl || body.propertyUrl || process.env.CRON_PROPERTY_URL || '';
  const baseUrl = resolveBaseUrl(req);
  const endpoint = JOB_ENDPOINTS[jobKey];
  const url = new URL(`${baseUrl}${endpoint}`);
  url.searchParams.set('force', '1');
  if (propertyUrl) url.searchParams.set('propertyUrl', propertyUrl);

  try {
    const headers = {};
    if (process.env.CRON_SECRET) {
      headers['x-cron-secret'] = process.env.CRON_SECRET;
    }
    const response = await fetch(url.toString(), { method: 'GET', headers });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (err) {
      payload = { raw: text };
    }
    if (!response.ok) {
      return sendJson(res, response.status, {
        status: 'error',
        message: payload?.message || text || `HTTP ${response.status}`,
        data: payload
      });
    }

    return sendJson(res, 200, { status: 'ok', data: payload });
  } catch (err) {
    return sendJson(res, 500, { status: 'error', message: err.message });
  }
}
