// GET /api/aigeo/ranking-scan-quality — latest ranking scan's guard state for the dial labels.
// Includes held scans (ranking_incomplete), which get-latest-audit skips.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE;
const DEFAULT_PROPERTY = 'https://www.alanranger.com';

function guardSummary(detail) {
  const guard = detail?.stability?.guard || {};
  const suspect = guard.suspect === true;
  return {
    suspect,
    hold_reason: suspect ? (guard.reason || detail.reason || null) : null,
    volatility_note: guard.volatility?.note || null,
  };
}

function summarise(row) {
  const detail = row?.ranking_quality_detail || {};
  return {
    audit_date: row?.audit_date || null,
    ranking_quality: row?.ranking_quality || null,
    cohort_size: Number(detail.stability?.cohort?.size) || null,
    ...guardSummary(detail),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Missing Supabase credentials' });
  }
  try {
    const propertyUrl = String(req.query.propertyUrl || DEFAULT_PROPERTY);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data, error } = await supabase.from('audit_results')
      .select('audit_date, ranking_quality, ranking_quality_detail')
      .eq('property_url', propertyUrl)
      .not('ranking_quality_detail', 'is', null)
      .order('audit_date', { ascending: false })
      .limit(1);
    if (error) throw error;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, ...summarise(data?.[0]) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
