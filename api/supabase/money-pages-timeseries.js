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

const buildPropertyCandidates = (propertyUrl) => {
  const trimmed = String(propertyUrl || '').trim().replace(/\/$/, '');
  if (!trimmed) return [];
  const candidates = new Set([trimmed]);
  const hasProtocol = /^(https?:\/\/)/.exec(trimmed);
  const withProtocol = hasProtocol ? trimmed : `https://${trimmed}`;
  candidates.add(withProtocol);
  if (withProtocol.includes('://www.')) {
    candidates.add(withProtocol.replace('://www.', '://'));
  } else {
    candidates.add(withProtocol.replace('://', '://www.'));
  }
  return Array.from(candidates);
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

const toUtcDate = (dateStr) => {
  if (!dateStr) return null;
  const date = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const fillMissingDates = (points, days) => {
  if (!Array.isArray(points) || points.length === 0) return [];
  const validDays = Number.parseInt(days, 10) || 28;
  const keyed = new Map(points.map((p) => [p.date, p]));
  const dates = points
    .map((p) => toUtcDate(p.date))
    .filter(Boolean);
  if (dates.length === 0) return points;
  const endDate = new Date(Math.max(...dates.map((d) => d.getTime())));
  const startDate = new Date(endDate);
  startDate.setUTCDate(endDate.getUTCDate() - (validDays - 1));
  const filled = [];
  for (let i = 0; i < validDays; i += 1) {
    const day = new Date(startDate);
    day.setUTCDate(startDate.getUTCDate() + i);
    const key = day.toISOString().split('T')[0];
    if (keyed.has(key)) {
      filled.push(keyed.get(key));
    } else {
      filled.push({
        date: key,
        clicks: 0,
        impressions: 0,
        ctr: 0,
        position: null
      });
    }
  }
  return filled;
};

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

    const propertyCandidates = buildPropertyCandidates(property_url);
    const { data: storedRows, error: storedError } = await supabase
      .from('gsc_page_timeseries')
      .select('date,clicks,impressions,ctr,position')
      .in('property_url', propertyCandidates)
      .eq('page_url', targetUrlNormalized)
      .gte('date', cutoffDate.toISOString().split('T')[0])
      .order('date', { ascending: true });

    if (!storedError && Array.isArray(storedRows) && storedRows.length > 0) {
      const data = fillMissingDates(mapStoredRows(storedRows), daysNum);
      return sendJSON(res, 200, {
        status: 'ok',
        data,
        meta: buildMeta(property_url, target_url, data.length)
      });
    }

    const { data: audits, error: auditError } = await supabase
      .from('audit_results')
      .select('audit_date, gsc_timeseries')
      .in('property_url', propertyCandidates)
      .order('audit_date', { ascending: false });

    if (auditError || !audits || audits.length === 0) {
      return sendJSON(res, 200, { status: 'ok', data: [], message: 'No audit data found' });
    }

    const data = fillMissingDates(readFromAuditResults(audits, cutoffDate, targetUrlNormalized), daysNum);

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

