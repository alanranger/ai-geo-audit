import { getGSCAccessToken, normalizePropertyUrl, getGscDateRange } from '../aigeo/utils.js';
import { createClient } from '@supabase/supabase-js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const normalizeUrl = (url) => {
  if (!url) return '';
  let normalized = String(url).toLowerCase().trim();
  normalized = normalized.replace(/^https?:\/\//, '');
  normalized = normalized.replace(/^www\./, '');
  normalized = normalized.split('?')[0].split('#')[0];
  const parts = normalized.split('/');
  if (parts.length > 1) {
    normalized = parts.slice(1).join('/');
  }
  return normalized.replace(/^\/+/, '').replace(/\/+$/, '');
};

// Strategic pages that MUST be synced regardless of whether the latest audit
// classifies them as "money pages". The audit's click-volume threshold
// filters out high-strategic-value URLs like the Academy entry points (the
// /academy/login gate page only earns ~6 clicks/28d but is the conversion
// chokepoint for the entire Academy funnel). See
// Docs/ACADEMY_FUNNEL_INVESTIGATION_2026-05.md for the root-cause analysis.
const STRATEGIC_PAGES = [
  'academy/login',
  'academy/trial-expired',
  'academy/upgrade',
  'trial-expired',
  'free-online-photography-course',
  'free-photography-course',
  'free-online-photography-academy',
  'online-photography-course'
];

function jsonResponse(res, status, body) {
  const baseMeta = body.meta || null;
  const meta = baseMeta
    ? { ...baseMeta, generatedAt: new Date().toISOString() }
    : { generatedAt: new Date().toISOString() };
  return res.status(status).json({ ...body, meta });
}

function checkAuth(req) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return { ok: true };
  const requestSecret = req.headers['x-cron-secret'] || req.query.secret;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  if (isVercelCron || requestSecret === cronSecret) return { ok: true };
  return { ok: false };
}

function parseMoneyPagesMetrics(rawValue) {
  if (typeof rawValue === 'string') {
    try { return JSON.parse(rawValue); } catch { return null; }
  }
  return rawValue;
}

function buildPageSet(auditMoneyPages, strategicPages) {
  const combinedSet = new Set();
  for (const url of auditMoneyPages) {
    const norm = normalizeUrl(url);
    if (norm) combinedSet.add(norm);
  }
  for (const slug of strategicPages) {
    const norm = normalizeUrl(slug);
    if (norm) combinedSet.add(norm);
  }
  return combinedSet;
}

async function fetchLatestMoneyPages(supabase, siteUrl) {
  const { data, error } = await supabase
    .from('audit_results')
    .select('audit_date, money_pages_metrics')
    .eq('property_url', siteUrl)
    .order('audit_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    throw new Error(`latest_audit_missing:${error?.message || 'no_audit'}`);
  }
  const metrics = parseMoneyPagesMetrics(data.money_pages_metrics);
  return Array.isArray(metrics?.rows) ? metrics.rows.map((row) => row.url).filter(Boolean) : [];
}

async function fetchGscRows(siteUrl, startDate, endDate) {
  const accessToken = await getGSCAccessToken();
  const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const response = await fetch(searchConsoleUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ startDate, endDate, dimensions: ['date', 'page'], rowLimit: 25000 })
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    const err = new Error(`gsc_api_error:${response.status}`);
    err.status = response.status;
    err.details = errorText;
    throw err;
  }
  const data = await response.json().catch(() => ({}));
  return Array.isArray(data.rows) ? data.rows : [];
}

function mapGscRowsToRecords(rows, siteUrl, pageSet) {
  const result = [];
  for (const row of rows) {
    const date = row.keys?.[0] || null;
    const page = row.keys?.[1] || null;
    if (!date || !page) continue;
    const pageUrl = normalizeUrl(page);
    if (!pageSet.has(pageUrl)) continue;
    result.push({
      property_url: siteUrl,
      page_url: pageUrl,
      date,
      clicks: Number(row.clicks || 0),
      impressions: Number(row.impressions || 0),
      ctr: Number(row.ctr ? row.ctr * 100 : 0),
      position: row.position != null ? Number(row.position) : null,
      updated_at: new Date().toISOString()
    });
  }
  return result;
}

function pickBetterRecord(a, b) {
  if (a.clicks !== b.clicks) return a.clicks > b.clicks ? a : b;
  if (a.impressions !== b.impressions) return a.impressions > b.impressions ? a : b;
  return a;
}

function dedupeRecords(records) {
  const byKey = new Map();
  let collisions = 0;
  for (const r of records) {
    const key = `${r.property_url}|${r.page_url}|${r.date}`;
    const existing = byKey.get(key);
    if (existing) {
      collisions += 1;
      byKey.set(key, pickBetterRecord(existing, r));
    } else {
      byKey.set(key, r);
    }
  }
  return { records: Array.from(byKey.values()), collisions };
}

async function upsertInBatches(supabase, records, batchSize = 1000) {
  let inserted = 0;
  let errors = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const { error } = await supabase
      .from('gsc_page_timeseries')
      .upsert(batch, { onConflict: 'property_url,page_url,date', ignoreDuplicates: false });
    if (error) {
      errors += 1;
    } else {
      inserted += batch.length;
    }
  }
  return { inserted, errors };
}

async function runBackfill(req) {
  const propertyUrl = req.query.propertyUrl || process.env.CRON_PROPERTY_URL || 'https://www.alanranger.com';
  const siteUrl = normalizePropertyUrl(propertyUrl);
  const { startDate, endDate } = getGscDateRange({ daysBack: 28, endOffsetDays: 1 });

  const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const auditMoneyPages = await fetchLatestMoneyPages(supabase, siteUrl);
  const pageSet = buildPageSet(auditMoneyPages, STRATEGIC_PAGES);

  if (pageSet.size === 0) {
    return { status: 200, body: { status: 'ok', message: 'No money pages or strategic pages configured', data: { saved: 0, pages: 0 } } };
  }

  const rows = await fetchGscRows(siteUrl, startDate, endDate);
  const rawRecords = mapGscRowsToRecords(rows, siteUrl, pageSet);
  const { records, collisions } = dedupeRecords(rawRecords);

  if (records.length === 0) {
    return { status: 200, body: { status: 'ok', message: 'No matching GSC rows for money pages', data: { saved: 0, pages: pageSet.size } } };
  }

  const { inserted, errors } = await upsertInBatches(supabase, records);
  return {
    status: 200,
    body: {
      status: 'ok',
      message: `Saved ${inserted} page timeseries rows (${errors} batch errors, ${collisions} dedupe collisions)`,
      data: {
        saved: inserted,
        pages: pageSet.size,
        audit_money_pages: auditMoneyPages.length,
        strategic_pages: STRATEGIC_PAGES.length,
        dedupe_collisions: collisions,
        errors
      },
      meta: { startDate, endDate }
    }
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Cron-Secret');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { status: 'error', message: 'Method not allowed. Use GET.' });
  }
  if (!checkAuth(req).ok) {
    return jsonResponse(res, 401, { status: 'error', message: 'Unauthorized cron request' });
  }

  try {
    const { status, body } = await runBackfill(req);
    return jsonResponse(res, status, body);
  } catch (error) {
    const status = error?.status || 500;
    return jsonResponse(res, status, {
      status: 'error',
      message: error?.message || 'Unknown error',
      details: error?.details
    });
  }
}
