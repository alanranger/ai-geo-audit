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

const buildDateSeries = (endDate, days) => {
  const list = [];
  const end = new Date(`${endDate}T00:00:00Z`);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    list.push(d.toISOString().split('T')[0]);
  }
  return list;
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
    const days = Number.parseInt(req.query.days || '28', 10) || 28;
    const endOffset = Number.parseInt(req.query.endOffset || '1', 10);
    const pageLimit = Number.parseInt(req.query.pageLimit || '', 10);
    const batchSize = Number.parseInt(req.query.batchSize || '1000', 10) || 1000;
    const commit = req.query.commit === '1';

    const siteUrl = normalizePropertyUrl(propertyUrl);
    const { startDate, endDate } = getGscDateRange({ daysBack: days, endOffsetDays: endOffset });

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

    let moneyPages = Array.isArray(moneyPagesMetrics?.rows)
      ? moneyPagesMetrics.rows.map((row) => row.url).filter(Boolean)
      : [];

    if (pageLimit && Number.isFinite(pageLimit)) {
      moneyPages = moneyPages.slice(0, pageLimit);
    }

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
    const hitRowLimit = rows.length === 25000;

    const moneyPageSet = new Set(moneyPages.map((url) => normalizeUrl(url)).filter(Boolean));
    const dateSeries = buildDateSeries(endDate, days);
    const pageRows = rows
      .map((row) => ({
        date: row.keys?.[0] || null,
        page: row.keys?.[1] || null,
        clicks: row.clicks || 0,
        impressions: row.impressions || 0,
        ctr: row.ctr ? row.ctr * 100 : 0,
        position: row.position ?? null
      }))
      .filter((row) => row.date && row.page)
      .filter((row) => moneyPageSet.has(normalizeUrl(row.page)));

    const pageMap = new Map();
    pageRows.forEach((row) => {
      const pageKey = normalizeUrl(row.page);
      if (!pageMap.has(pageKey)) pageMap.set(pageKey, new Map());
      pageMap.get(pageKey).set(row.date, row);
    });

    const records = [];
    moneyPageSet.forEach((pageKey) => {
      const perDate = pageMap.get(pageKey) || new Map();
      dateSeries.forEach((date) => {
        const existing = perDate.get(date);
        records.push({
          property_url: siteUrl,
          page_url: pageKey,
          date,
          clicks: Number(existing?.clicks || 0),
          impressions: Number(existing?.impressions || 0),
          ctr: Number(existing?.ctr || 0),
          position: existing?.position != null ? Number(existing.position) : null,
          updated_at: new Date().toISOString()
        });
      });
    });

    if (!commit) {
      return res.status(200).json({
        status: 'ok',
        message: 'Dry run complete (no DB writes)',
        data: {
          pages: moneyPages.length,
          gscRows: rows.length,
          matchedRows: pageRows.length,
          gridRows: records.length,
          hitRowLimit
        },
        meta: { generatedAt: new Date().toISOString(), startDate, endDate }
      });
    }

    const batchStart = Date.now();
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
    const totalMs = Date.now() - batchStart;

    return res.status(200).json({
      status: 'ok',
      message: `Upsert complete (errors=${errors})`,
      data: {
        pages: moneyPages.length,
        gscRows: rows.length,
        matchedRows: pageRows.length,
        gridRows: records.length,
        saved: inserted,
        errors,
        totalMs,
        hitRowLimit
      },
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
