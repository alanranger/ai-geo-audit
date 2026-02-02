import { logCronEvent } from '../../lib/cron/logCron.js';
import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'nodejs', maxDuration: 300 };

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const fetchJson = async (url, options) => {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json();
};

const toDateOnly = (d) => d.toISOString().split('T')[0];

const getPrevMonthEndUtc = (now = new Date()) => {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based
  // Day 0 of current month = last day of previous month.
  return new Date(Date.UTC(y, m, 0));
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use GET.' });
  }

  const cronSecret = process.env.CRON_SECRET;
  const requestSecret = req.headers['x-cron-secret'] || req.query.secret;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  if (cronSecret && !isVercelCron && requestSecret !== cronSecret) {
    return sendJson(res, 401, {
      status: 'error',
      message: 'Unauthorized cron request',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  const now = new Date();
  const utcDay = now.getUTCDate();
  const propertyUrl = req.query.propertyUrl || process.env.CRON_PROPERTY_URL || 'https://www.alanranger.com';
  const fallbackBaseUrl = req.headers.host
    ? `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`
    : 'http://localhost:3000';
  const baseUrl = process.env.CRON_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || fallbackBaseUrl;

  // GSC data is typically available ~2 days after month end. Only attempt on day >= 2 (UTC).
  if (utcDay < 2) {
    return sendJson(res, 200, {
      status: 'skipped',
      reason: 'too_early_for_gsc_month_end',
      meta: { generatedAt: now.toISOString() }
    });
  }

  const prevMonthEnd = getPrevMonthEndUtc(now);
  const prevMonthEndStr = toDateOnly(prevMonthEnd);

  const startedAt = Date.now();
  try {
    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    // If portfolio segment snapshot already exists for previous month end, no-op.
    const { count: existingCount, error: existingErr } = await supabase
      .from('portfolio_segment_metrics_28d')
      .select('id', { count: 'exact', head: true })
      .eq('site_url', propertyUrl)
      .eq('date_end', prevMonthEndStr);

    if (existingErr) {
      throw new Error(`portfolio_segment_metrics_28d check failed: ${existingErr.message}`);
    }

    if ((existingCount || 0) > 0) {
      return sendJson(res, 200, {
        status: 'ok',
        message: 'Month-end portfolio snapshot already exists.',
        meta: { date_end: prevMonthEndStr }
      });
    }

    // Find the GSC page metrics run_id for the month-end date.
    const { data: gscRun, error: gscErr } = await supabase
      .from('gsc_page_metrics_28d')
      .select('run_id, date_start, date_end, captured_at')
      .eq('site_url', propertyUrl)
      .eq('date_end', prevMonthEndStr)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (gscErr) {
      throw new Error(`gsc_page_metrics_28d lookup failed: ${gscErr.message}`);
    }

    if (!gscRun?.run_id) {
      return sendJson(res, 200, {
        status: 'skipped',
        reason: 'no_gsc_page_metrics_for_month_end',
        meta: { date_end: prevMonthEndStr }
      });
    }

    const headers = {
      'Content-Type': 'application/json',
      ...(cronSecret ? { 'x-cron-secret': cronSecret } : {})
    };

    // Backfill portfolio segment metrics for this run_id (writes rows with date_end = month end).
    const backfillResp = await fetchJson(`${baseUrl}/api/supabase/backfill-portfolio-segments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ runId: gscRun.run_id })
    });

    await logCronEvent({
      jobKey: 'portfolio_month_end',
      status: 'success',
      propertyUrl,
      durationMs: Date.now() - startedAt,
      details: `date_end=${prevMonthEndStr}, run_id=${gscRun.run_id}`
    });

    return sendJson(res, 200, {
      status: 'ok',
      message: 'Month-end portfolio snapshot backfilled.',
      meta: { date_end: prevMonthEndStr, run_id: gscRun.run_id },
      result: backfillResp
    });
  } catch (err) {
    await logCronEvent({
      jobKey: 'portfolio_month_end',
      status: 'error',
      propertyUrl,
      durationMs: Date.now() - startedAt,
      details: err.message
    });
    return sendJson(res, 500, { status: 'error', message: err.message });
  }
}
