export const config = { runtime: 'nodejs' };

import { computeNextRunAt } from '../../lib/cron/schedule.js';
import { requireAdminKeyOnly } from '../../lib/api/requireAdminKeyOnly.js';

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
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

const normalizeFrequency = (value) => {
  const v = String(value || '').toLowerCase().trim();
  if (!v) return 'off';
  if (['off', 'disabled'].includes(v)) return 'off';
  if (['daily', 'weekly', 'monthly'].includes(v)) return v;
  return 'daily';
};

const normalizeTime = (value) => {
  const v = String(value || '').trim();
  if (!v) return '00:00';
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v);
  if (match) return `${match[1].padStart(2, '0')}:${match[2]}`;
  return '00:00';
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, {});
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use POST.' });
  }

  if (!requireAdminKeyOnly(req, res, sendJson)) return;

  const body = await readBody(req);
  const jobKey = String(body.jobKey || '').trim();
  if (!jobKey) {
    return sendJson(res, 400, { status: 'error', message: 'Missing jobKey.' });
  }

  const frequency = normalizeFrequency(body.frequency);
  const timeOfDay = normalizeTime(body.timeOfDay);
  const resetStats = Boolean(body.resetStats);
  const baseUrl = resolveBaseUrl(req);

  try {
    const scheduleResp = await fetch(`${baseUrl}/api/supabase/get-cron-schedule?jobKey=${encodeURIComponent(jobKey)}`);
    const scheduleJson = await scheduleResp.json().catch(() => null);
    const existing = scheduleJson?.data?.jobs?.[jobKey] || {};

    const lastRunAt = resetStats ? null : existing.lastRunAt || null;
    const lastStatus = resetStats ? null : existing.lastStatus || null;
    const lastError = resetStats ? null : existing.lastError || null;

    const nextRunAt = computeNextRunAt({
      frequency,
      timeOfDay,
      lastRunAt: lastRunAt || new Date().toISOString()
    });

    const payload = {
      jobs: {
        [jobKey]: {
          frequency,
          timeOfDay,
          lastRunAt,
          nextRunAt,
          lastStatus,
          lastError
        }
      }
    };

    const saveResp = await fetch(`${baseUrl}/api/supabase/save-cron-schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const saveJson = await saveResp.json().catch(() => null);
    if (!saveResp.ok) {
      return sendJson(res, saveResp.status, { status: 'error', message: saveJson?.message || 'Failed to save schedule' });
    }

    return sendJson(res, 200, { status: 'ok', data: saveJson?.data || null });
  } catch (err) {
    return sendJson(res, 500, { status: 'error', message: err.message });
  }
}
