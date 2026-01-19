export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAdminKeyOnly } from '../../lib/api/requireAdminKeyOnly.js';

const need = (key) => {
  const value = process.env[key];
  if (!value || !String(value).trim()) {
    throw new Error(`missing_env:${key}`);
  }
  return value;
};

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key');
  res.status(status).send(JSON.stringify(body));
};

const parseMessage = (message) => {
  if (!message || typeof message !== 'string') return null;
  try {
    return JSON.parse(message);
  } catch (err) {
    return null;
  }
};

const normalizeStatus = (value) => {
  const status = String(value || '').toLowerCase();
  if (['ok', 'success', 'succeeded'].includes(status)) return 'success';
  if (['error', 'failed', 'fail'].includes(status)) return 'failed';
  return 'unknown';
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, {});
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use GET.' });
  }

  if (!requireAdminKeyOnly(req, res, sendJson)) return;

  const jobKey = String(req.query.jobKey || '').trim();
  if (!jobKey) {
    return sendJson(res, 400, { status: 'error', message: 'Missing jobKey.' });
  }

  const limitRaw = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 25;

  try {
    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    const search = `%\"cronJob\":\"${jobKey}\"%`;
    const { data, error } = await supabase
      .from('debug_logs')
      .select('timestamp,type,message')
      .ilike('message', search)
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error) {
      if (error.message && error.message.includes('does not exist')) {
        return sendJson(res, 200, { status: 'missing_table', logs: [], runHistory: [] });
      }
      return sendJson(res, 500, { status: 'error', message: error.message });
    }

    const logs = (data || []).map((row) => {
      const parsed = parseMessage(row.message) || {};
      const status = normalizeStatus(parsed.status || row.type);
      return {
        timestamp: row.timestamp,
        type: row.type,
        status,
        message: row.message,
        durationMs: parsed.durationMs ?? null,
        details: parsed.details || null
      };
    });

    const runHistory = logs.slice().reverse().map((entry) => ({
      date: entry.timestamp,
      status: entry.status,
      success: entry.status === 'success'
    }));

    return sendJson(res, 200, {
      status: 'ok',
      jobKey,
      logs,
      runHistory
    });
  } catch (err) {
    return sendJson(res, 500, { status: 'error', message: err.message });
  }
}
