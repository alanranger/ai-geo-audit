/**
 * GET /api/supabase/gsc-timeseries-banner?propertyUrl=https://www.alanranger.com
 *
 * Canonical GSC daily sync stamp for the green banner.
 * Score Trends reads `gsc_timeseries`; the banner used to read only
 * `audit_results.gsc_timeseries` (stale when full save-audit fails).
 */
import { createClient } from '@supabase/supabase-js';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';
const WINDOW_DAYS = 28;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ status: 'error', message: 'Supabase not configured' });
  }

  const propertyUrl = String(req.query?.propertyUrl || DEFAULT_PROPERTY).trim();
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: latestRows, error: latestErr } = await supabase
    .from('gsc_timeseries')
    .select('date, updated_at')
    .eq('property_url', propertyUrl)
    .order('date', { ascending: false })
    .limit(WINDOW_DAYS);
  if (latestErr) {
    return res.status(500).json({ status: 'error', message: latestErr.message });
  }
  const rows = latestRows || [];
  if (!rows.length) {
    return res.status(200).json({
      status: 'ok',
      property_url: propertyUrl,
      last_date: null,
      period_start: null,
      period_end: null,
      last_synced_at: null,
      row_count: 0
    });
  }

  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  const lastSynced = rows.reduce((max, r) => {
    const t = r.updated_at ? new Date(r.updated_at).getTime() : 0;
    return t > max ? t : max;
  }, 0);

  return res.status(200).json({
    status: 'ok',
    property_url: propertyUrl,
    last_date: dates[dates.length - 1] || null,
    period_start: dates[0] || null,
    period_end: dates[dates.length - 1] || null,
    last_synced_at: lastSynced ? new Date(lastSynced).toISOString() : null,
    row_count: rows.length
  });
}
