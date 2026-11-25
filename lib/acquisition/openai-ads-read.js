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

function insightWindow(campaign) {
  const now = Math.floor(Date.now() / 1000);
  const end = Math.min(Number(campaign.end_time) || now, now);
  const since = Number(campaign.start_time) ? londonDay(campaign.start_time) : '2026-11-01';
  const until = londonDay(end) || since;
  return { since, until: until < since ? since : until };
}

function insightPath(campaign, level, grain, extra) {
  const window = insightWindow(campaign);
  const range = encodeURIComponent(JSON.stringify({
    type: 'date_range', since: window.since, until: window.until, timezone: 'Europe/London'
  }));
  const fields = ['impressions', 'clicks', 'spend', 'conversions', ...(extra || [])];
  const query = [
    `aggregation_level=${level}`,
    `time_granularity=${grain}`,
    `time_ranges[]=${range}`,
    ...fields.map((field) => `fields[]=${encodeURIComponent(field)}`)
  ].join('&');
  return `/v1/campaigns/${encodeURIComponent(campaign.id)}/insights?${query}`;
}

export async function readInsights(campaign, level, grain, fetchImpl = fetch, extra = []) {
  return call(insightPath(campaign, level, grain, extra), {}, fetchImpl);
}

export async function readPerformance(campaign, fetchImpl = fetch) {
  return readInsights(campaign, 'campaign', 'none', fetchImpl);
}

async function groupsFor(campaigns, fetchImpl) {
  const lists = await Promise.all(campaigns.map((campaign) => (
    listAll(`/v1/ad_groups?campaign_id=${encodeURIComponent(campaign.id)}`, fetchImpl)
  )));
  return lists.flatMap((rows, index) => rows.map((row) => ({ ...row, campaign_id: campaigns[index].id })));
}

async function adsFor(groups, fetchImpl) {
  const ads = [];
  for (let index = 0; index < groups.length; index += 8) {
    const slice = groups.slice(index, index + 8);
    const lists = await Promise.all(slice.map((group) => (
      listAll(`/v1/ads?ad_group_id=${encodeURIComponent(group.id)}`, fetchImpl)
    )));
    ads.push(...lists.flatMap((rows, offset) => rows.map((row) => ({
      ...row, ad_group_id: slice[offset].id, campaign_id: slice[offset].campaign_id
    }))));
  }
  return ads;
}

export async function readAccount(fetchImpl = fetch) {
  const campaigns = await listAll('/v1/campaigns', fetchImpl);
  const groups = await groupsFor(campaigns, fetchImpl);
  const ads = await adsFor(groups, fetchImpl);
  return { campaigns, groups, ads };
}
