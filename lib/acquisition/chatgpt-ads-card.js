/** Card model. Status comes from the provider status field, never the campaign name. */

const LONDON = 'Europe/London';
const HISTORICAL_IDS = {
  cmpn_5dfb74726ce481a289954d70a1b11b11: 'Historical cap £400. Not the current budget.',
  cmpn_036167a3656081988ef33a74f1201ffe: 'Historical cap £100. Not the current budget.'
};

export const HISTORICAL_NOTE = '£455 invoiced (+ £91 VAT = £546 paid). Provider hourly £454.35 / 201 clicks. Provider reports disagree (aggregate £188.19 / 82 clicks), under query with OpenAI. The £400/£100 split is the original allocation, not a current budget.';

const HISTORICAL_RECORD = [
  { name: 'Gifts & Academy', id: 'cmpn_5dfb74726ce481a289954d70a1b11b11', state: 'paused', note: 'Historical record, paused 19 Nov 07:11. Original flight to 2 Dec 13:00. Cap £400. Not a live read.' },
  { name: 'Short Workshops UK capped test', id: 'cmpn_036167a3656081988ef33a74f1201ffe', state: 'paused', note: 'Historical record, paused 19 Nov 07:11. Original flight to 2 Dec 13:00. Cap £100. Not a live read.' }
];

export function displayState(campaign, now = new Date()) {
  const status = String(campaign?.status || '').toLowerCase();
  if (!status) return 'unavailable';
  const end = Number(campaign.end_time);
  if (end && now.getTime() >= end * 1000) return 'ended';
  return status;
}

export function londonStamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON, day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

export function pounds(micros) {
  const n = Number(micros) / 1e6;
  if (!Number.isFinite(n)) return null;
  return n;
}

export function placeLabel(campaign) {
  const inc = campaign?.targeting?.locations?.include || [];
  if (inc.length === 1 && inc[0].type === 'country' && inc[0].country_code === 'GB') return 'UK only';
  if (inc.some((row) => row.type === 'postal_code')) return 'selected GB postcodes';
  if (!inc.length) return 'targeting unavailable';
  return inc.map((row) => row.name).filter(Boolean).slice(0, 3).join(', ');
}

function money(amount) {
  if (amount == null) return 'unavailable';
  return `£${Number.isInteger(amount) ? String(amount) : amount.toFixed(2)}`;
}

function flight(campaign) {
  const start = Number(campaign.start_time);
  const end = Number(campaign.end_time);
  if (!start && !end) return 'schedule unavailable';
  const from = start ? londonStamp(start * 1000) : 'open start';
  const to = end ? londonStamp(end * 1000) : 'open end';
  return `${from} to ${to} London`;
}

function linkedGroups(campaign, groups) {
  return (groups || []).filter((group) => group.campaign_id === campaign.id);
}

function currentRow(campaign, groups, now) {
  const state = displayState(campaign, now);
  const mine = linkedGroups(campaign, groups);
  const active = mine.filter((group) => String(group.status || '').toLowerCase() === 'active');
  const bid = active.length === 1 ? pounds(active[0].bidding_config?.max_bid_micros) : null;
  const title = active.length === 1 ? active[0].name : campaign.name;
  const groupLine = mine.length
    ? (active.length === 1 ? `${active[0].name} group only (${active[0].id})` : `${active.length} active of ${mine.length} groups`)
    : 'ad-group link unavailable';
  return {
    title,
    id: campaign.id,
    state,
    place: placeLabel(campaign),
    budget: money(pounds(campaign.budget?.daily_spend_limit_micros)),
    bid: bid == null ? 'unavailable' : money(bid),
    flight: flight(campaign),
    groups: groupLine
  };
}

export function figuresText(report, reportOkAt) {
  const rows = report?.data;
  if (!Array.isArray(rows) || !rows.length) {
    const when = reportOkAt ? londonStamp(reportOkAt) : 'never';
    return `Ads system figures unavailable — last successful read: ${when}`;
  }
  let impressions = 0;
  let clicks = 0;
  let conversions = 0;
  let spend = 0;
  let seen = false;
  for (const row of rows) {
    const has = row.impressions != null || row.clicks != null || row.spend != null || row.spend_micros != null || row.conversions != null;
    if (!has) continue;
    seen = true;
    impressions += Number(row.impressions || 0);
    clicks += Number(row.clicks || 0);
    conversions += Number(row.conversions || 0);
    spend += row.spend_micros != null ? Number(row.spend_micros) / 1e6 : Number(row.spend || 0);
  }
  if (!seen) return `Ads system figures unavailable — last successful read: ${reportOkAt ? londonStamp(reportOkAt) : 'never'}`;
  return `Ads system: ${impressions} impressions, ${clicks} clicks, ${money(spend)} spend, ${conversions} conversions`;
}

export function adsCardModel({ campaigns, groups, syncedAt, synced_at, statusError, report, reportOkAt, ga4, now = new Date(), stale = false } = {}) {
  const synced = syncedAt || synced_at || null;
  const list = Array.isArray(campaigns) ? campaigns : [];
  if (!list.length) {
    return {
      ok: true,
      heading: 'unavailable',
      stale: false,
      synced_at: synced,
      message: statusError || 'Live campaign status unavailable.',
      current: [],
      monitoring: 'Monitoring, not a provider setting: £105 net Sunday–Saturday allowance. Stop check at £100 net or 115 clicks.',
      figures: figuresText(report, reportOkAt),
      ga4: ga4 || 'GA4 unavailable',
      historical_note: HISTORICAL_NOTE,
      historical: HISTORICAL_RECORD
    };
  }
  const ranked = [...list].sort((a, b) => {
    const score = (row) => (displayState(row, now) === 'active' ? 0 : 1);
    return score(a) - score(b);
  });
  const current = ranked.filter((row) => displayState(row, now) === 'active').map((row) => currentRow(row, groups, now));
  const historical = ranked.filter((row) => displayState(row, now) !== 'active').map((row) => ({
    name: row.name,
    id: row.id,
    state: displayState(row, now),
    note: HISTORICAL_IDS[row.id] || ''
  }));
  return {
    ok: true,
    heading: current.length ? 'active' : displayState(ranked[0], now),
    stale,
    synced_at: synced,
    message: stale ? 'Last read failed. Showing the previous sync.' : '',
    current,
    monitoring: 'Monitoring, not a provider setting: £105 net Sunday–Saturday allowance. Stop check at £100 net or 115 clicks.',
    figures: figuresText(report, reportOkAt),
    ga4: ga4 || 'GA4 unavailable',
    historical_note: HISTORICAL_NOTE,
    historical
  };
}
