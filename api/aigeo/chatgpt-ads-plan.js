/** Read-only ChatGPT Ads card. Status is the last Ads API sync, not a hardcoded label. */
export const config = { runtime: 'nodejs', maxDuration: 60 };
import { createClient } from '@supabase/supabase-js';
import { loadAdsCard } from '../../lib/acquisition/chatgpt-ads-sync.js';

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { ok: false });
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
  try {
    return send(res, 200, await loadAdsCard(sb));
  } catch (err) {
    return send(res, 200, { ok: true, heading: 'unavailable', message: err?.message || 'Live campaign status unavailable.', current: [], historical: [] });
  }
}
