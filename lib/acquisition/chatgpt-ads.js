/** ChatGPT paid-test tile maths. GA4 counts the visits and the purchases. Squarespace supplies the pounds. */

export async function fetchChatgptAdsRows(sb) {
  const [sessions, purchases, provider, exclusions] = await Promise.all([
    sb.from('ga4_campaign_daily').select('date,sessions,medium,source,campaign').eq('source', 'chatgpt').limit(5000),
    sb.from('ga4_campaign_purchases').select('date,transaction_id,medium,source,campaign').eq('source', 'chatgpt').limit(2000),
    sb.from('chatgpt_ads_provider').select('clicks,spend_gbp').eq('id', 1).maybeSingle(),
    sb.from('chatgpt_ads_exclusions').select('transaction_id').limit(500)
  ]);
  if (sessions.error) throw new Error(`ga4_campaign_daily: ${sessions.error.message}`);
  if (purchases.error) throw new Error(`ga4_campaign_purchases: ${purchases.error.message}`);
  return {
    sessions: sessions.data || [],
    purchases: purchases.data || [],
    provider: provider.data || null,
    excluded: new Set((exclusions.data || []).map((row) => String(row.transaction_id)))
  };
}

export async function squarespaceTotals(sb, purchases) {
  const keys = [...new Set((purchases || []).map((row) => squarespaceOrderKey(row.transaction_id)).filter(Boolean))];
  const orders = new Map();
  const testKeys = new Set();
  if (!keys.length) return { orders, testKeys };
  const { data, error } = await sb.from('sqs_orders').select('order_number, grand_total_gbp, testmode').in('order_number', keys);
  if (error) throw new Error(`sqs_orders: ${error.message}`);
  for (const row of data || []) {
    const key = String(parseInt(row.order_number, 10));
    if (row.testmode) { testKeys.add(key); continue; }
    orders.set(key, Number(row.grand_total_gbp));
  }
  return { orders, testKeys };
}

export function squarespaceOrderKey(transactionId) {
  const raw = String(transactionId || '').trim();
  if (!raw || raw === '(not set)' || !/^\d{1,6}$/.test(raw)) return null;
  return String(parseInt(raw, 10));
}

export function summariseChatgptAds({ sessions, purchases, orders, excluded, provider, trials }) {
  let visitCount = 0;
  for (const row of sessions || []) visitCount += Number(row.sessions || 0);
  let purchaseCount = 0;
  let revenue = 0;
  let unconfirmed = 0;
  const seen = new Set();
  for (const row of purchases || []) {
    const id = String(row.transaction_id || '');
    if (!id || seen.has(id) || excluded?.has(id)) continue;
    seen.add(id);
    purchaseCount += 1;
    const key = squarespaceOrderKey(id);
    const total = key == null ? null : orders?.get(key);
    if (total == null) unconfirmed += 1;
    else revenue += Number(total);
  }
  const trialRows = trials || [];
  const upgrades = trialRows.filter((row) => row.converted_at).length;
  const spend = provider?.spend_gbp == null ? null : Number(provider.spend_gbp);
  return {
    sessions: visitCount,
    provider_clicks: provider?.clicks == null ? null : Number(provider.clicks),
    provider_spend: spend,
    purchases: purchaseCount,
    revenue_gbp: revenue,
    unconfirmed,
    trials: trialRows.length,
    upgrades,
    upgrade_gbp: upgrades * 79,
    cost_per_purchase: spend != null && purchaseCount > 0 ? Math.round((spend / purchaseCount) * 100) / 100 : null
  };
}
