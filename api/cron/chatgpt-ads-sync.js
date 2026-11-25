/** Daily read of OpenAI Ads status. GET from Vercel cron. Does not change ads. */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { createClient } from '@supabase/supabase-js';
import { syncChatgptAds } from '../../lib/acquisition/chatgpt-ads-sync.js';
import { isRequestAuthorized } from '../../lib/acquisition/sync-runs.js';

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (!isRequestAuthorized(req)) return send(res, 401, { ok: false, error: 'unauthorized' });
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
  try {
    const card = await syncChatgptAds(sb);
    return send(res, 200, { ok: true, job: 'chatgpt_ads_sync', heading: card.heading, stale: card.stale });
  } catch (err) {
    return send(res, 500, { ok: false, error: err?.message || String(err) });
  }
}
