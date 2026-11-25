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

function pagePath(path, after) {
  const join = path.includes('?') ? '&' : '?';
  return `${path}${join}limit=100${after}`;
}

export function londonDay(unixSeconds) {
  const date = new Date(Number(unixSeconds) * 1000);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

export async function listAll(path, fetchImpl = fetch) {
  const rows = [];
  let after = '';
  for (let page = 0; page < 10; page += 1) {
    const json = await call(pagePath(path, after), {}, fetchImpl);
    rows.push(...(json.data || []));
    if (!json.has_more || !json.last_id) break;
    after = `&after=${encodeURIComponent(json.last_id)}`;
  }
  return rows;
}

function flightQuery(campaign) {
  const now = Math.floor(Date.now() / 1000);
  const end = Math.min(Number(campaign.end_time) || now, now);
  const since = londonDay(campaign.start_time);
  const until = londonDay(end) || since;
  const range = encodeURIComponent(JSON.stringify({
    type: 'date_range', since, until: until < since ? since : until, timezone: 'Europe/London'
  }));
  return [
    'aggregation_level=campaign',
    'time_granularity=none',
    `time_ranges[]=${range}`,
    'fields[]=impressions',
    'fields[]=clicks',
    'fields[]=spend',
    'fields[]=conversions'
  ].join('&');
}

export async function readPerformance(campaign, fetchImpl = fetch) {
  const id = encodeURIComponent(campaign.id);
  return call(`/v1/campaigns/${id}/insights?${flightQuery(campaign)}`, {}, fetchImpl);
}

async function groupsFor(campaigns, fetchImpl) {
  const lists = await Promise.all(campaigns.map((campaign) => (
    listAll(`/v1/ad_groups?campaign_id=${encodeURIComponent(campaign.id)}`, fetchImpl)
  )));
  return lists.flatMap((rows, index) => rows.map((row) => ({ ...row, campaign_id: campaigns[index].id })));
}

async function adsFor(groups, fetchImpl) {
  const lists = await Promise.all(groups.map((group) => (
    listAll(`/v1/ads?ad_group_id=${encodeURIComponent(group.id)}`, fetchImpl)
  )));
  return lists.flatMap((rows, index) => rows.map((row) => ({
    ...row, ad_group_id: groups[index].id, campaign_id: groups[index].campaign_id
  })));
}

export async function readAccount(fetchImpl = fetch) {
  const campaigns = await listAll('/v1/campaigns', fetchImpl);
  const groups = await groupsFor(campaigns, fetchImpl);
  const live = new Set(campaigns.filter((row) => String(row.status || '').toLowerCase() === 'active').map((row) => row.id));
  const ads = await adsFor(groups.filter((row) => live.has(row.campaign_id)), fetchImpl);
  return { campaigns, groups, ads };
}
