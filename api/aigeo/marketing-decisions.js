/**
 * GET /api/aigeo/marketing-decisions (x-arp-admin-key). Read-only: the shared decision state
 * (lib/marketing/decision-state.mjs) — Alan's open decisions (`open`, `count`), the overall plan approval, published
 * placements, deferred items and GPT's production queue. Marketing "Waiting on you" renders `open`; Strategy's
 * "Needs Alan" counts the same list. No names, emails or hashes. Nothing is written.
 */
import { createClient } from '@supabase/supabase-js';
import { requireAdminKeyOnly } from '../../lib/api/requireAdminKeyOnly.js';
import { buildDecisionState } from '../../lib/marketing/decision-state.mjs';

const send = (res, status, body) => res.status(status).json(body);

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { ok: false, error: 'Method not allowed' }); }
  if (!requireAdminKeyOnly(req, res, send)) return undefined;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE;
  if (!url || !key) return send(res, 500, { ok: false, error: 'Missing Supabase credentials' });
  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    res.setHeader('Cache-Control', 'no-store');
    return send(res, 200, { ok: true, ...(await buildDecisionState(sb)) });
  } catch (e) {
    return send(res, 500, { ok: false, error: e?.message || String(e) });
  }
}
