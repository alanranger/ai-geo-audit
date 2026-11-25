/** Read-only OpenAI Ads calls. Never sends a pause, budget, bid or creative change. */

const BASE = 'https://api.ads.openai.com';

export function adsKey() {
  return String(process.env.OPENAI_ADS_SDK_KEY || '').trim();
}

async function call(path, { method = 'GET', body } = {}, fetchImpl = fetch) {
  const key = adsKey();
  if (!key) {
    const err = new Error('OPENAI_ADS_SDK_KEY is not set');
    err.code = 'not_configured';
    throw err;
  }
  const res = await fetchImpl(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `ads api ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export async function listAll(path, fetchImpl = fetch) {
  const rows = [];
  let after = '';
  for (let page = 0; page < 10; page += 1) {
    const json = await call(`${path}?limit=100${after}`, {}, fetchImpl);
    rows.push(...(json.data || []));
    if (!json.has_more || !json.last_id) break;
    after = `&after=${encodeURIComponent(json.last_id)}`;
  }
  return rows;
}

export async function readPerformance(campaign, fetchImpl = fetch) {
  return call('/v1/ads/query', {
    method: 'POST',
    body: {
      aggregation: 'ad',
      granularity: 'none',
      zero_impression_items: true,
      campaign_id: campaign.id,
      start_time: campaign.start_time || null,
      end_time: campaign.end_time || null
    }
  }, fetchImpl);
}

export async function readAccount(fetchImpl = fetch) {
  const [campaigns, groups, ads] = await Promise.all([
    listAll('/v1/campaigns', fetchImpl),
    listAll('/v1/ad_groups', fetchImpl),
    listAll('/v1/ads', fetchImpl)
  ]);
  return { campaigns, groups, ads };
}
