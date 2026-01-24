// /api/supabase/save-gsc-page-timeseries.js
// Save per-URL daily GSC timeseries to Supabase

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
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

const toNumberOrNull = (value) => (
  value === null || value === undefined ? null : Number(value)
);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return sendJSON(res, 405, { error: `Method not allowed. Received: ${req.method}, Expected: POST` });
  }

  try {
    const { propertyUrl, rows = [] } = req.body || {};
    if (propertyUrl && Array.isArray(rows)) {
      // ok
    } else {
      return sendJSON(res, 400, { error: 'Missing required fields: propertyUrl, rows (array)' });
    }

    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    const records = rows.map((row) => ({
      property_url: propertyUrl,
      page_url: normalizeUrl(row.page || row.url || ''),
      date: row.date,
      clicks: Number(row.clicks || 0),
      impressions: Number(row.impressions || 0),
      ctr: Number(row.ctr || 0),
      position: toNumberOrNull(row.position),
      updated_at: new Date().toISOString()
    })).filter((row) => row.page_url && row.date);

    if (records.length === 0) {
      return sendJSON(res, 200, { saved: 0, total: 0, message: 'No valid rows to save' });
    }

    const batchSize = 1000;
    let inserted = 0;
    let errors = [];

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await supabase
        .from('gsc_page_timeseries')
        .upsert(batch, { onConflict: 'property_url,page_url,date', ignoreDuplicates: false });

      if (error) {
        errors.push({ batch: i / batchSize + 1, error: error.message });
      } else {
        inserted += batch.length;
      }
    }

    if (errors.length > 0 && inserted === 0) {
      return sendJSON(res, 500, { error: 'Failed to save page timeseries', details: errors });
    }

    return sendJSON(res, 200, {
      saved: inserted,
      total: records.length,
      errors: errors.length > 0 ? errors : null,
      message: `Saved ${inserted} page timeseries rows (${errors.length} batch errors)`
    });
  } catch (err) {
    return sendJSON(res, 500, { error: err.message });
  }
}

