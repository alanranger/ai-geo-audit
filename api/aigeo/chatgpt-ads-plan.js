/** Read-only paused ChatGPT Ads plan. Orders line follows a captured chatgpt/cpc visit. */
import { createClient } from '@supabase/supabase-js';
import { chatgptAdsView } from '../../lib/chatgpt-ads-plan-data.js';

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
  const { count, error } = await sb.from('order_visit_attribution')
    .select('order_number', { count: 'exact', head: true })
    .eq('utm_source', 'chatgpt')
    .eq('utm_medium', 'cpc');
  if (error) return send(res, 200, { ok: false });
  return send(res, 200, chatgptAdsView(count > 0));
}
