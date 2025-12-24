// /api/supabase/backfill-gsc-timeseries.js
// Admin-only: backfill/refresh recent site-level GSC daily totals into `gsc_timeseries`.

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../../lib/api/requireAdmin.js';
import { getGSCAccessToken, normalizePropertyUrl, getGscDateRange } from '../aigeo/utils.js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJSON = (res, status, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key');
  res.status(status).send(JSON.stringify(obj));
};

function* dateRangeInclusive(startIso, endIso) {
  const start = new Date(startIso + 'T00:00:00');
  const end = new Date(endIso + 'T00:00:00');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    yield d.toISOString().split('T')[0];
  }
}

async function fetchGscDailyTotals({ siteUrl, startDate, endDate, accessToken }) {
  const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const resp = await fetch(searchConsoleUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    // Fetch per-day totals for the whole range in ONE call (fast, avoids serverless timeouts).
    body: JSON.stringify({
      startDate,
      endDate,
      dimensions: ['date'],
      rowLimit: 1000
    })
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`gsc_api_error:${resp.status}:${text.slice(0, 500)}`);
  }

  const data = await resp.json().catch(() => ({}));
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const byDate = new Map();
  rows.forEach(r => {
    const date = r?.keys?.[0];
    if (!date) return;
    byDate.set(String(date), {
      clicks: r?.clicks ?? 0,
      impressions: r?.impressions ?? 0,
      ctr: r?.ctr ?? 0, // ratio 0-1
      position: r?.position ?? 0
    });
  });
  return byDate;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return sendJSON(res, 405, { status: 'error', error: 'Method not allowed. Expected POST.' });
  }

  // Admin key gate
  if (!requireAdmin(req, res, sendJSON)) return;

  try {
    const {
      propertyUrl = 'https://www.alanranger.com',
      days = 58,
      endOffsetDays = 2,
      // no per-day delay needed now; kept for backward compat
      delayMs = 0
    } = req.body || {};

    const nDays = Number(days);
    const nOffset = Number(endOffsetDays);
    const nDelay = Number(delayMs);
    if (!Number.isFinite(nDays) || nDays < 2 || nDays > 120) {
      return sendJSON(res, 400, { status: 'error', error: `Invalid days (${days}). Allowed: 2..120` });
    }
    if (!Number.isFinite(nOffset) || nOffset < 0 || nOffset > 7) {
      return sendJSON(res, 400, { status: 'error', error: `Invalid endOffsetDays (${endOffsetDays}). Allowed: 0..7` });
    }

    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const siteUrl = normalizePropertyUrl(String(propertyUrl));

    const { startDate, endDate } = getGscDateRange({ daysBack: nDays, endOffsetDays: nOffset });

    const accessToken = await getGSCAccessToken();

    const byDate = await fetchGscDailyTotals({ siteUrl, startDate, endDate, accessToken });

    const rowsToUpsert = [];
    for (const date of dateRangeInclusive(startDate, endDate)) {
      const totals = byDate.get(date) || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
      rowsToUpsert.push({
        property_url: siteUrl,
        date,
        clicks: totals.clicks || 0,
        impressions: totals.impressions || 0,
        ctr: totals.ctr || 0,
        position: totals.position || 0
      });
    }

    const errors = [];
    let saved = 0;
    const batchSize = 200;
    for (let i = 0; i < rowsToUpsert.length; i += batchSize) {
      const batch = rowsToUpsert.slice(i, i + batchSize);
      const { error } = await supabase
        .from('gsc_timeseries')
        .upsert(batch, { onConflict: 'property_url,date' });
      if (error) {
        errors.push({ batchStart: batch[0]?.date, batchEnd: batch[batch.length - 1]?.date, error: error.message });
      } else {
        saved += batch.length;
      }
      if (nDelay > 0) await new Promise((r) => setTimeout(r, nDelay));
    }

    return sendJSON(res, 200, {
      status: 'ok',
      siteUrl,
      range: { startDate, endDate, days: nDays, endOffsetDays: nOffset },
      saved,
      errorCount: errors.length,
      errors: errors.slice(0, 10), // cap payload
      meta: { generatedAt: new Date().toISOString() }
    });
  } catch (e) {
    return sendJSON(res, 500, {
      status: 'error',
      error: e?.message || String(e),
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}


