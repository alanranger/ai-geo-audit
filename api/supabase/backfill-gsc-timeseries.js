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

async function fetchGscDailyTotals({ siteUrl, date, accessToken }) {
  const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const resp = await fetch(searchConsoleUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ startDate: date, endDate: date })
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`gsc_api_error:${resp.status}:${text.slice(0, 500)}`);
  }

  const data = await resp.json().catch(() => ({}));
  const row = (data.rows && data.rows.length > 0) ? data.rows[0] : null;
  return {
    clicks: row?.clicks ?? 0,
    impressions: row?.impressions ?? 0,
    ctr: row?.ctr ?? 0, // ratio 0-1
    position: row?.position ?? 0
  };
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
      delayMs = 200
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

    let fetched = 0;
    let saved = 0;
    const errors = [];

    for (const date of dateRangeInclusive(startDate, endDate)) {
      try {
        const totals = await fetchGscDailyTotals({ siteUrl, date, accessToken });
        fetched += 1;

        const row = {
          property_url: siteUrl,
          date,
          clicks: totals.clicks || 0,
          impressions: totals.impressions || 0,
          ctr: totals.ctr || 0,
          position: totals.position || 0
        };

        const { error } = await supabase
          .from('gsc_timeseries')
          .upsert(row, { onConflict: 'property_url,date' });
        if (error) throw new Error(`supabase_upsert_error:${error.message}`);
        saved += 1;

        if (nDelay > 0) await new Promise((r) => setTimeout(r, nDelay));
      } catch (e) {
        errors.push({ date, error: e?.message || String(e) });
        if (nDelay > 0) await new Promise((r) => setTimeout(r, Math.max(200, nDelay)));
      }
    }

    return sendJSON(res, 200, {
      status: 'ok',
      siteUrl,
      range: { startDate, endDate, days: nDays, endOffsetDays: nOffset },
      fetched,
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


