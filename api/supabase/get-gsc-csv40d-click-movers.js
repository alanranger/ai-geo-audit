// GET /api/supabase/get-gsc-csv40d-click-movers?siteUrl=...
// Compares the two most recent csv40d-* snapshots for a property; returns top click gainers/losers.

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { normalizePropertyUrl } from '../aigeo/utils.js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJSON = (res, status, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(obj));
};

async function loadRunRows(supabase, siteUrl, runId) {
  const pageSize = 1000;
  const map = new Map();
  let from = 0;
  for (;;) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('gsc_page_metrics_28d')
      .select('page_url,clicks_28d,impressions_28d')
      .eq('site_url', siteUrl)
      .eq('run_id', runId)
      .range(from, to);
    if (error) throw new Error(error.message);
    const rows = Array.isArray(data) ? data : [];
    rows.forEach((r) => {
      const u = String(r.page_url || '').trim();
      if (!u) return;
      map.set(u, {
        clicks: Number(r.clicks_28d) || 0,
        impressions: Number(r.impressions_28d) || 0
      });
    });
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return map;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return sendJSON(res, 405, { status: 'error', error: 'Method not allowed' });
  }

  try {
    const siteUrlRaw = String(req.query.siteUrl || req.query.propertyUrl || '').trim();
    if (!siteUrlRaw) {
      return sendJSON(res, 400, { status: 'error', error: 'Missing siteUrl' });
    }
    const siteUrl = normalizePropertyUrl(siteUrlRaw);
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));

    const { data: newest, error: e1 } = await supabase
      .from('gsc_page_metrics_28d')
      .select('run_id,date_end')
      .eq('site_url', siteUrl)
      .like('run_id', 'csv40d-%')
      .order('date_end', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (e1) throw new Error(e1.message);
    if (!newest?.run_id || !newest?.date_end) {
      return sendJSON(res, 200, {
        status: 'no_data',
        reason: 'no_csv40d_snapshot',
        siteUrl
      });
    }

    const { data: older, error: e2 } = await supabase
      .from('gsc_page_metrics_28d')
      .select('run_id,date_end')
      .eq('site_url', siteUrl)
      .like('run_id', 'csv40d-%')
      .lt('date_end', newest.date_end)
      .order('date_end', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (e2) throw new Error(e2.message);
    if (!older?.run_id) {
      return sendJSON(res, 200, {
        status: 'need_second_run',
        siteUrl,
        newer: { run_id: newest.run_id, date_end: newest.date_end },
        message: 'Only one csv40d snapshot found. Run backfill again on a later day to compare.'
      });
    }

    const [newMap, oldMap] = await Promise.all([
      loadRunRows(supabase, siteUrl, newest.run_id),
      loadRunRows(supabase, siteUrl, older.run_id)
    ]);

    const urls = new Set([...newMap.keys(), ...oldMap.keys()]);
    const deltas = [];
    urls.forEach((page_url) => {
      const c = newMap.get(page_url)?.clicks ?? 0;
      const p = oldMap.get(page_url)?.clicks ?? 0;
      deltas.push({ page_url, delta: c - p, clicks_newer: c, clicks_older: p });
    });

    const gainers = deltas
      .filter((d) => d.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 50);
    const losers = deltas
      .filter((d) => d.delta < 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 50);

    return sendJSON(res, 200, {
      status: 'ok',
      siteUrl,
      windowDays: 40,
      newer: { run_id: newest.run_id, date_end: newest.date_end },
      older: { run_id: older.run_id, date_end: older.date_end },
      gainers,
      losers
    });
  } catch (err) {
    console.error('[get-gsc-csv40d-click-movers]', err);
    return sendJSON(res, 500, { status: 'error', error: err.message || String(err) });
  }
}
