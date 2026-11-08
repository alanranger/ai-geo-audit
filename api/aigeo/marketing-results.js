/**
 * GET /api/aigeo/marketing-results?days=30 (x-arp-admin-key). Read-only: the Marketing & Campaigns "Results" rows
 * (lib/marketing/results.mjs): every email or post that actually went out, with provider evidence, newest first.
 * Counts and list names only; no member lists or names. Nothing is written.
 */
import { createClient } from '@supabase/supabase-js';
import { requireAdminKeyOnly } from '../../lib/api/requireAdminKeyOnly.js';
import { buildMarketingResults } from '../../lib/marketing/results.mjs';

const send = (res, status, body) => res.status(status).json(body);

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  if (!requireAdminKeyOnly(req, res, send)) return undefined;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE;
  if (!url || !key) return send(res, 500, { ok: false, error: 'Missing Supabase credentials' });
  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const out = await buildMarketingResults(sb, { days: req.query.days });
    res.setHeader('Cache-Control', 'no-store');
    return send(res, 200, { ok: true, ...out });
  } catch (e) {
    return send(res, 500, { ok: false, error: e?.message || String(e) });
  }
}
