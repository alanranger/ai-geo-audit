/** Read-only live ChatGPT Ads card. Test orders stay on the exclusion list. */
import { createClient } from '@supabase/supabase-js';
import { chatgptAdsView } from '../../lib/chatgpt-ads-plan-data.js';
import { academyClient } from '../../lib/acquisition/academy-signup-source.js';
import {
  fetchChatgptAdsRows,
  squarespaceTotals,
  summariseChatgptAds,
  squarespaceOrderKey
} from '../../lib/acquisition/chatgpt-ads.js';

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

function cpcRows(rows) {
  return (rows || []).filter((row) => row.medium === 'cpc' && row.campaign !== 'claude_check');
}

async function liveTrials(excluded) {
  const academy = academyClient();
  if (!academy) return [];
  const { data, error } = await academy.from('academy_signup_attribution')
    .select('member_id')
    .eq('utm_source', 'chatgpt')
    .eq('utm_medium', 'cpc')
    .limit(1000);
  if (error) return [];
  return (data || []).filter((row) => row.member_id && !excluded.has(`member:${row.member_id}`));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { ok: false });
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
  try {
    const rows = await fetchChatgptAdsRows(sb);
    const visits = cpcRows(rows.orderVisits);
    const matched = await squarespaceTotals(sb, visits);
    for (const row of visits) {
      const key = squarespaceOrderKey(row.transaction_id);
      if (key && matched.testKeys.has(key)) rows.excluded.add(String(row.transaction_id));
    }
    const summary = summariseChatgptAds({
      sessions: cpcRows(rows.sessions),
      purchases: visits,
      orders: matched.orders,
      excluded: rows.excluded,
      provider: rows.provider,
      trials: await liveTrials(rows.excluded)
    });
    return send(res, 200, chatgptAdsView(summary));
  } catch (err) {
    return send(res, 200, { ok: false });
  }
}
