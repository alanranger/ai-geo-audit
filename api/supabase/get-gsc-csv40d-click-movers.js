// GET /api/supabase/get-gsc-csv40d-click-movers?siteUrl=...
// Compares two GSC page-metric snapshots; prefers csv40d-* pair, else latest dated runs.

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

/** Newest distinct run_ids by date_end (optionally csv40d-only). */
async function latestDistinctRuns(supabase, siteUrl, { csvOnly = false, limit = 2 } = {}) {
  let q = supabase
    .from('gsc_page_metrics_28d')
    .select('run_id,date_end')
    .eq('site_url', siteUrl)
    .order('date_end', { ascending: false })
    .limit(2500);
  if (csvOnly) q = q.like('run_id', 'csv40d-%');
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const seen = new Set();
  const out = [];
  for (const r of data || []) {
    const id = String(r.run_id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ run_id: id, date_end: r.date_end });
    if (out.length >= limit) break;
  }
  return out;
}

async function resolveComparePair(supabase, siteUrl) {
  const csv = await latestDistinctRuns(supabase, siteUrl, { csvOnly: true, limit: 2 });
  if (csv.length >= 2) {
    return { newer: csv[0], older: csv[1], source: 'csv40d', windowDays: 40 };
  }
  const any = await latestDistinctRuns(supabase, siteUrl, { csvOnly: false, limit: 2 });
  if (any.length >= 2) {
    return { newer: any[0], older: any[1], source: 'dated_runs', windowDays: 28 };
  }
  return {
    newer: csv[0] || any[0] || null,
    older: null,
    source: csv[0] ? 'csv40d' : (any[0] ? 'dated_runs' : null),
    windowDays: csv[0] ? 40 : 28
  };
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

    const pair = await resolveComparePair(supabase, siteUrl);
    if (!pair.newer?.run_id) {
      return sendJSON(res, 200, {
        status: 'no_data',
        reason: 'no_gsc_page_snapshot',
        siteUrl
      });
    }
    if (!pair.older?.run_id) {
      return sendJSON(res, 200, {
        status: 'need_second_run',
        siteUrl,
        newer: pair.newer,
        source: pair.source,
        message: 'Only one GSC page snapshot found. Need a second run to compare.'
      });
    }

    const [newMap, oldMap] = await Promise.all([
      loadRunRows(supabase, siteUrl, pair.newer.run_id),
      loadRunRows(supabase, siteUrl, pair.older.run_id)
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
      windowDays: pair.windowDays,
      source: pair.source,
      newer: pair.newer,
      older: pair.older,
      gainers,
      losers
    });
  } catch (err) {
    console.error('[get-gsc-csv40d-click-movers]', err);
    return sendJSON(res, 500, { status: 'error', error: err.message || String(err) });
  }
}
