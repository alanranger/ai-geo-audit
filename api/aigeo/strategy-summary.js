// GET /api/aigeo/strategy-summary
import { createClient } from '@supabase/supabase-js';
import { buildStrategySummary } from '../../lib/strategy-summary.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE;
const DEFAULT_PROPERTY = 'https://www.alanranger.com';

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
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });
    const noBackfill = String(req.query.noBackfill || '') === '1';
    const summary = await buildStrategySummary(supabase, propertyUrl, { noBackfill });
    // no-store: quarter ticks must appear immediately after PATCH + reload
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, ...summary });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
