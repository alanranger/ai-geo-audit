// POST /api/supabase/backfill-gsc-csv-urls-40d
// Fetches GSC page metrics for a rolling 40-day window, keeps rows for URLs in 06-site-urls.csv,
// upserts into gsc_page_metrics_28d with run_id csv40d-YYYY-MM-DD (end date).

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { getGSCAccessToken, getGscDateRange, normalizePropertyUrl } from '../aigeo/utils.js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJSON = (res, status, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(obj));
};

const CSV_SOURCES = [
  'https://schema-tools-six.vercel.app/06-site-urls.csv',
  'https://raw.githubusercontent.com/alanranger/alan-shared-resources/main/csv/06-site-urls.csv',
  'https://raw.githubusercontent.com/alanranger/alan-shared-resources/master/csv/06-site-urls.csv'
];

function normalizePageUrl(url, siteUrl) {
  if (!url || typeof url !== 'string') return '';
  let u = url.trim();
  const base = String(siteUrl || '').replace(/\/+$/, '');
  if (u.startsWith('/')) {
    u = base + u;
  } else if (!/^https?:\/\//i.test(u)) {
    u = `${base}/${u.replace(/^\/+/, '')}`;
  }
  try {
    const urlObj = new URL(u);
    let path = urlObj.pathname || '/';
    if (path.length > 1) path = path.replace(/\/+$/, '');
    return urlObj.origin.toLowerCase() + path;
  } catch {
    return u.split('?')[0].split('#')[0].replace(/\/+$/, '').toLowerCase();
  }
}

async function fetchSiteUrlsCsvText() {
  const bust = Date.now();
  for (const src of CSV_SOURCES) {
    try {
      const sep = src.includes('?') ? '&' : '?';
      const res = await fetch(`${src}${sep}cb=${bust}`, { cache: 'no-store' });
      if (!res.ok) continue;
      const text = await res.text();
      if (text && text.trim()) return text;
    } catch {
      /* try next */
    }
  }
  return '';
}

function parseUrlsFromCsv(text, siteUrl) {
  const out = [];
  const seen = new Set();
  const urlRe = /https?:\/\/[^,\s"'<>]+/gi;
  String(text || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const matches = line.match(urlRe) || [];
      matches.forEach((raw) => {
        const n = normalizePageUrl(raw, siteUrl);
        if (n && !seen.has(n)) {
          seen.add(n);
          out.push(n);
        }
      });
    });
  return out;
}

async function fetchGscOverview(siteUrl, startDate, endDate) {
  const accessToken = await getGSCAccessToken();
  const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const response = await fetch(searchConsoleUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ startDate, endDate })
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`GSC overview API error: ${errorData.error?.message || response.statusText || 'Unknown error'}`);
  }
  const data = await response.json();
  const row = data.rows && data.rows.length > 0 ? data.rows[0] : null;
  return {
    clicks: row?.clicks || 0,
    impressions: row?.impressions || 0,
    ctr: row?.ctr || 0,
    position: row?.position || 0
  };
}

async function fetchGscPageRowsAll(siteUrl, startDate, endDate) {
  const accessToken = await getGSCAccessToken();
  const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const rowLimit = 25000;
  const all = [];
  let startRow = 0;
  for (;;) {
    const requestBody = {
      startDate,
      endDate,
      dimensions: ['page'],
      rowLimit,
      startRow
    };
    const response = await fetch(searchConsoleUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`GSC API error: ${errorData.error?.message || 'Unknown error'}`);
    }
    const data = await response.json();
    const rows = Array.isArray(data.rows) ? data.rows : [];
    all.push(...rows);
    if (rows.length < rowLimit) break;
    startRow += rowLimit;
    if (startRow > 200000) break;
  }
  return all;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return sendJSON(res, 405, { status: 'error', error: 'Method not allowed' });
  }

  try {
    const { propertyUrl, force = false, csvText: csvTextBody } = req.body || {};
    if (!propertyUrl || !String(propertyUrl).trim()) {
      return sendJSON(res, 400, { status: 'error', error: 'Missing propertyUrl' });
    }

    const siteUrl = normalizePropertyUrl(propertyUrl);
    const { startDate, endDate } = getGscDateRange({ daysBack: 40, endOffsetDays: 2 });
    const runId = `csv40d-${endDate}`;

    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));

    if (!force) {
      const { count, error: cErr } = await supabase
        .from('gsc_page_metrics_28d')
        .select('id', { count: 'exact', head: true })
        .eq('site_url', siteUrl)
        .eq('run_id', runId);
      if (!cErr && count > 0) {
        return sendJSON(res, 200, {
          status: 'ok',
          skipped: true,
          runId,
          siteUrl,
          date_start: startDate,
          date_end: endDate,
          message: `Run ${runId} already exists (${count} rows). Pass force:true to replace.`
        });
      }
    }

    const csvText = String(csvTextBody || '').trim() || (await fetchSiteUrlsCsvText());
    if (!csvText.trim()) {
      return sendJSON(res, 400, { status: 'error', error: 'Could not load 06-site-urls.csv from known sources' });
    }

    const csvUrls = parseUrlsFromCsv(csvText, siteUrl);
    if (!csvUrls.length) {
      return sendJSON(res, 400, { status: 'error', error: 'No URLs parsed from CSV' });
    }

    const overview = await fetchGscOverview(siteUrl, startDate, endDate);
    const gscRows = await fetchGscPageRowsAll(siteUrl, startDate, endDate);

    const agg = new Map();
    gscRows.forEach((row) => {
      const raw = row.keys && row.keys[0] ? String(row.keys[0]) : '';
      const key = normalizePageUrl(raw, siteUrl);
      if (!key) return;
      const clicks = Number(row.clicks) || 0;
      const impressions = Number(row.impressions) || 0;
      const ctr = Number(row.ctr) || 0;
      const pos = row.position != null && Number(row.position) > 0 ? Number(row.position) : null;
      const prev = agg.get(key) || { clicks: 0, impressions: 0, posWeight: 0, posImpr: 0 };
      prev.clicks += clicks;
      prev.impressions += impressions;
      if (pos !== null && impressions > 0) {
        prev.posWeight += pos * impressions;
        prev.posImpr += impressions;
      }
      agg.set(key, prev);
    });

    const rawClicks = [...agg.values()].reduce((s, v) => s + v.clicks, 0);
    const rawImpressions = [...agg.values()].reduce((s, v) => s + v.impressions, 0);
    const scale = {
      clicks: rawClicks > 0 ? overview.clicks / rawClicks : 1,
      impressions: rawImpressions > 0 ? overview.impressions / rawImpressions : 1
    };

    const rows = csvUrls.map((page_url) => {
      const a = agg.get(page_url) || { clicks: 0, impressions: 0, posWeight: 0, posImpr: 0 };
      const clicks = a.clicks * scale.clicks;
      const impressions = a.impressions * scale.impressions;
      const ctr = impressions > 0 ? clicks / impressions : 0;
      const position = a.posImpr > 0 ? a.posWeight / a.posImpr : null;
      return {
        run_id: runId,
        site_url: siteUrl,
        page_url,
        date_start: startDate,
        date_end: endDate,
        clicks_28d: clicks,
        impressions_28d: impressions,
        ctr_28d: ctr,
        position_28d: position
      };
    });

    const batchSize = 500;
    let inserted = 0;
    const errors = [];
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await supabase.from('gsc_page_metrics_28d').upsert(batch, {
        onConflict: 'run_id,page_url',
        ignoreDuplicates: false
      });
      if (error) {
        errors.push({ batch: i / batchSize + 1, message: error.message });
      } else {
        inserted += batch.length;
      }
    }

    const matchedInGsc = csvUrls.filter((u) => agg.has(u)).length;

    return sendJSON(res, errors.length && inserted === 0 ? 500 : 200, {
      status: errors.length && inserted === 0 ? 'error' : 'ok',
      runId,
      siteUrl,
      date_start: startDate,
      date_end: endDate,
      csvUrlCount: csvUrls.length,
      gscPageRowsFetched: gscRows.length,
      csvUrlsWithGscRow: matchedInGsc,
      upserted: inserted,
      scale,
      errors: errors.length ? errors : undefined
    });
  } catch (err) {
    console.error('[backfill-gsc-csv-urls-40d]', err);
    return sendJSON(res, 500, { status: 'error', error: err.message || String(err) });
  }
}
