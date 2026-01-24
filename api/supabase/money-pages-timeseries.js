// /api/supabase/money-pages-timeseries.js
// Fetch per-URL daily GSC timeseries from stored audit payloads

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

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

const buildMeta = (property_url, target_url, count) => ({
  property_url,
  target_url,
  count,
  generatedAt: new Date().toISOString()
});

const toNumberOrNull = (value) => (
  value === null || value === undefined ? null : Number(value)
);

const mapStoredRows = (rows) => rows.map((row) => ({
  date: row.date,
  clicks: Number(row.clicks || 0),
  impressions: Number(row.impressions || 0),
  ctr: Number(row.ctr || 0),
  position: toNumberOrNull(row.position)
}));

const readFromAuditResults = (audits, cutoffDate, targetUrlNormalized) => {
  const dailyMap = new Map();
  audits.forEach((audit) => {
    if (!audit?.gsc_timeseries) return;
    let ts = audit.gsc_timeseries;
    if (typeof ts === 'string') {
      try { ts = JSON.parse(ts); } catch { ts = null; }
    }
    if (!Array.isArray(ts)) return;

    ts.forEach((entry) => {
      const dateStr = entry?.date || entry?.day || null;
      const url = entry?.url || entry?.page || entry?.page_url || entry?.target_url || '';
      if (!dateStr || !url) return;

      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime()) || d < cutoffDate) return;

      const normalized = normalizeUrl(url);
      if (!normalized || normalized !== targetUrlNormalized) return;

      const dateKey = d.toISOString().split('T')[0];
      if (dailyMap.has(dateKey)) return;

      dailyMap.set(dateKey, {
        date: dateKey,
        clicks: Number(entry.clicks || 0),
        impressions: Number(entry.impressions || 0),
        position: toNumberOrNull(entry.position)
      });
    });
  });

  return Array.from(dailyMap.values())
    .sort((a, b) => new Date(a.date) - new Date(b.date));
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return sendJSON(res, 405, { error: 'Method not allowed. Expected: GET' });
  }

  try {
    const { property_url, target_url, days = 28 } = req.query;
    if (property_url && target_url) {
      // ok
    } else {
      return sendJSON(res, 400, { error: 'property_url and target_url are required' });
    }

    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    const targetUrlNormalized = normalizeUrl(target_url);
    const daysNum = Number.parseInt(days, 10) || 28;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysNum);

    const { data: storedRows, error: storedError } = await supabase
      .from('gsc_page_timeseries')
      .select('date,clicks,impressions,ctr,position')
      .eq('property_url', property_url)
      .eq('page_url', targetUrlNormalized)
      .gte('date', cutoffDate.toISOString().split('T')[0])
      .order('date', { ascending: true });

    if (!storedError && Array.isArray(storedRows) && storedRows.length > 0) {
      const data = mapStoredRows(storedRows);
      return sendJSON(res, 200, {
        status: 'ok',
        data,
        meta: buildMeta(property_url, target_url, data.length)
      });
    }

    const { data: audits, error: auditError } = await supabase
      .from('audit_results')
      .select('audit_date, gsc_timeseries')
      .eq('property_url', property_url)
      .order('audit_date', { ascending: false });

    if (auditError || !audits || audits.length === 0) {
      return sendJSON(res, 200, { status: 'ok', data: [], message: 'No audit data found' });
    }

    const data = readFromAuditResults(audits, cutoffDate, targetUrlNormalized);

    return sendJSON(res, 200, {
      status: 'ok',
      data,
      meta: buildMeta(property_url, target_url, data.length)
    });
  } catch (err) {
    return sendJSON(res, 200, {
      status: 'error',
      error: err.message || 'Internal server error',
      data: []
    });
  }
}

