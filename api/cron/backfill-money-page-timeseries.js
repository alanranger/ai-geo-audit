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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Cron-Secret');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed. Use GET.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  const cronSecret = process.env.CRON_SECRET;
  const requestSecret = req.headers['x-cron-secret'] || req.query.secret;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  if (cronSecret && !isVercelCron && requestSecret !== cronSecret) {
    return res.status(401).json({
      status: 'error',
      message: 'Unauthorized cron request',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    const propertyUrl = req.query.propertyUrl || process.env.CRON_PROPERTY_URL || 'https://www.alanranger.com';
    const siteUrl = normalizePropertyUrl(propertyUrl);
    const { startDate, endDate } = getGscDateRange({ daysBack: 28, endOffsetDays: 1 });

    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    const { data: latestAudit, error: auditError } = await supabase
      .from('audit_results')
      .select('audit_date, money_pages_metrics')
      .eq('property_url', siteUrl)
      .order('audit_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (auditError || !latestAudit) {
      return res.status(500).json({
        status: 'error',
        message: `Latest audit not found: ${auditError?.message || 'no_audit'}`,
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    let moneyPagesMetrics = latestAudit.money_pages_metrics;
    if (typeof moneyPagesMetrics === 'string') {
      try { moneyPagesMetrics = JSON.parse(moneyPagesMetrics); } catch { moneyPagesMetrics = null; }
    }

    const moneyPages = Array.isArray(moneyPagesMetrics?.rows)
      ? moneyPagesMetrics.rows.map((row) => row.url).filter(Boolean)
      : [];

    if (moneyPages.length === 0) {
      return res.status(200).json({
        status: 'ok',
        message: 'No money pages found in latest audit',
        data: { saved: 0, pages: 0 },
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const accessToken = await getGSCAccessToken();
    const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    const response = await fetch(searchConsoleUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ['date', 'page'],
        rowLimit: 25000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        status: 'error',
        message: 'Failed to fetch page timeseries from GSC',
        details: errorText,
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const data = await response.json().catch(() => ({}));
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const moneyPageSet = new Set(moneyPages.map((url) => normalizeUrl(url)).filter(Boolean));

    const records = rows
      .map((row) => ({
        date: row.keys?.[0] || null,
        page: row.keys?.[1] || null,
        clicks: row.clicks || 0,
        impressions: row.impressions || 0,
        ctr: row.ctr ? row.ctr * 100 : 0,
        position: row.position ?? null
      }))
      .filter((row) => row.date && row.page)
      .filter((row) => moneyPageSet.has(normalizeUrl(row.page)))
      .map((row) => ({
        property_url: siteUrl,
        page_url: normalizeUrl(row.page),
        date: row.date,
        clicks: Number(row.clicks || 0),
        impressions: Number(row.impressions || 0),
        ctr: Number(row.ctr || 0),
        position: row.position != null ? Number(row.position) : null,
        updated_at: new Date().toISOString()
      }));

    if (records.length === 0) {
      return res.status(200).json({
        status: 'ok',
        message: 'No matching GSC rows for money pages',
        data: { saved: 0, pages: moneyPages.length },
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const batchSize = 1000;
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

    return res.status(200).json({
      status: 'ok',
      message: `Saved ${inserted} page timeseries rows (${errors} batch errors)`,
      data: { saved: inserted, pages: moneyPages.length, errors },
      meta: { generatedAt: new Date().toISOString(), startDate, endDate }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unknown error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

