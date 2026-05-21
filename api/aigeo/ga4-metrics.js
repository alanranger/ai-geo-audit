// GET  /api/aigeo/ga4-metrics?propertyUrl=https://www.alanranger.com
// POST /api/aigeo/ga4-metrics  { "propertyUrl": "...", "refresh": true }
//
// Pulls GA4 Data API (28d, aligned with GSC window), caches in ga4_site_metrics_28d.

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { getGa4MetricsForProperty } from './ga4-data.js';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
};

const need = (key) => {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'GET' && req.method !== 'POST') {
    return send(res, 405, { error: 'method_not_allowed' });
  }

  let body = {};
  if (req.method === 'POST') {
    if (typeof req.body === 'string') {
      try { body = JSON.parse(req.body); } catch { body = {}; }
    } else if (req.body && typeof req.body === 'object') body = req.body;
  }
  const propertyUrl = String(
    req.method === 'POST' ? (body.propertyUrl || DEFAULT_PROPERTY) : (req.query?.propertyUrl || DEFAULT_PROPERTY)
  ).trim();
  const forceRefresh = req.method === 'POST'
    || req.query?.refresh === '1'
    || req.query?.refresh === 'true'
    || body.refresh === true;

  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const { row, refreshed } = await getGa4MetricsForProperty(supabase, propertyUrl, { forceRefresh });
    return send(res, 200, {
      property_url: propertyUrl,
      refreshed,
      metrics: row,
      top_events: row?.event_counts
        ? Object.entries(row.event_counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([eventName, count]) => ({ eventName, count }))
        : []
    });
  } catch (err) {
    return send(res, 500, {
      error: 'ga4_metrics_failed',
      message: err?.message || String(err)
    });
  }
}
