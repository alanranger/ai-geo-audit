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
    if (!property_url || !target_url) {
      return sendJSON(res, 400, { error: 'property_url and target_url are required' });
    }

    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    const targetUrlNormalized = normalizeUrl(target_url);
    const daysNum = parseInt(days, 10) || 28;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysNum);

    const { data: audits, error: auditError } = await supabase
      .from('audit_results')
      .select('audit_date, gsc_timeseries')
      .eq('property_url', property_url)
      .order('audit_date', { ascending: false });

    if (auditError || !audits || audits.length === 0) {
      return sendJSON(res, 200, { status: 'ok', data: [], message: 'No audit data found' });
    }

    const dailyMap = new Map();

    for (const audit of audits) {
      if (!audit?.gsc_timeseries) continue;
      let ts = audit.gsc_timeseries;
      if (typeof ts === 'string') {
        try { ts = JSON.parse(ts); } catch { ts = null; }
      }
      if (!Array.isArray(ts)) continue;

      for (const entry of ts) {
        const dateStr = entry?.date || entry?.day || null;
        const url = entry?.url || entry?.page || entry?.page_url || entry?.target_url || '';
        if (!dateStr || !url) continue;

        const d = new Date(dateStr);
        if (Number.isNaN(d.getTime()) || d < cutoffDate) continue;

        const normalized = normalizeUrl(url);
        if (!normalized || normalized !== targetUrlNormalized) continue;

        const dateKey = d.toISOString().split('T')[0];
        if (dailyMap.has(dateKey)) continue;

        dailyMap.set(dateKey, {
          date: dateKey,
          clicks: Number(entry.clicks || 0),
          impressions: Number(entry.impressions || 0),
          position: entry.position != null ? Number(entry.position) : null
        });
      }
    }

    const data = Array.from(dailyMap.values())
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    return sendJSON(res, 200, {
      status: 'ok',
      data,
      meta: {
        property_url,
        target_url,
        count: data.length,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    return sendJSON(res, 200, {
      status: 'error',
      error: err.message || 'Internal server error',
      data: []
    });
  }
}

