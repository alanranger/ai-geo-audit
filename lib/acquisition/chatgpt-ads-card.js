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

export function londonDay(unix) {
  if (!unix) return '';
  const date = new Date(Number(unix) * 1000);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LONDON, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
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
  if (micros == null || micros === '') return null;
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

function budgetFields(campaign) {
  const lifetime = pounds(campaign.budget?.lifetime_spend_limit_micros);
  const daily = pounds(campaign.budget?.daily_spend_limit_micros);
  const amount = lifetime ?? daily;
  return {
    budget: money(amount),
    budget_type: lifetime != null ? 'lifetime' : (daily != null ? 'daily' : null),
    budget_amount: amount,
    budget_display: amount == null ? 'Budget unavailable' : (lifetime != null ? `${money(amount)} total campaign cap` : `${money(amount)}/day`)
  };
}

function bidFields(groups) {
  if (!groups.length) return { bid: 'unavailable', bid_display: 'Bid unavailable' };
  const configs = groups.map((group) => group.bidding_config || {});
  const keys = configs.map((config) => JSON.stringify([config.target_strategy || config.strategy, config.target_micros, config.max_bid_micros, config.billing_event_type]));
  if (new Set(keys).size !== 1) return { bid: 'varies', bid_display: 'Bids vary by ad group' };
  const config = configs[0];
  const strategy = config.target_strategy || config.strategy;
  if (strategy === 'target_cpc' || strategy === 'target_cpa') {
    const amount = pounds(config.target_micros);
    const label = strategy === 'target_cpc' ? 'Target CPC' : 'Target CPA';
    return { bid: money(amount), bid_display: `${label} ${money(amount)} (average)` };
  }
  const amount = pounds(config.max_bid_micros);
  if (amount != null && config.billing_event_type !== 'impression') return { bid: money(amount), bid_display: `Max CPC ${money(amount)}` };
  const automatic = { maximize_clicks: 'Maximize Clicks', maximize_conversions: 'Maximize Conversions' };
  return { bid: 'unavailable', bid_display: automatic[strategy] || 'Bid unavailable' };
}

function monitoringFields(campaign) {
  if (campaign.id === 'cmpn_4d7a58c3b7708192b3402d805deb2e85') {
    return { spend_stop: 100, click_stop: 115, text: 'Gift vouchers only: £105 net Sunday–Saturday allowance. Daily stop check at £100 net or 115 clicks; checks are not continuous.' };
  }
  const cap = pounds(campaign.budget?.lifetime_spend_limit_micros);
  return { spend_cap: cap, text: cap == null ? 'No separate monitoring stop recorded for this campaign.' : `Provider total campaign cap: ${money(cap)}. ${flight(campaign)}.` };
}

function currentRow(campaign, groups, now) {
  const state = displayState(campaign, now);
  const mine = linkedGroups(campaign, groups);
  const active = mine.filter((group) => String(group.status || '').toLowerCase() === 'active');
  const title = active.length === 1 ? active[0].name : campaign.name;
  const groupLine = mine.length
    ? (active.length === 1 ? `${active[0].name} group only (${active[0].id})` : `${active.length} active of ${mine.length} groups`)
    : 'ad-group link unavailable';
  return {
    title,
    id: campaign.id,
    state,
    place: placeLabel(campaign),
    ...budgetFields(campaign),
    ...bidFields(active.length ? active : mine),
    monitoring: monitoringFields(campaign),
    flight: flight(campaign),
    start: londonDay(campaign.start_time),
    end: londonDay(campaign.end_time),
    groups: groupLine
  };
}

/** Null when a row is missing the metric. A stored 0 stays 0. An empty list stays null. */
export function sumMetric(rows, key) {
  if (!rows?.length) return null;
  let total = 0;
  for (const row of rows) {
    if (row?.[key] == null) return null;
    total += Number(row[key]);
  }
  return total;
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

function tableFields(report, ga4Rows, ads, reportError) {
  return {
    days: report?.days || [],
    ad_metrics: report?.ad_metrics || [],
    totals: report?.totals || [],
    ga4_rows: ga4Rows || null,
    breakdown_error: report?.days?.length ? '' : (reportError || ''),
    report_fresh: report?.fresh || null,
    ads: (ads || []).map((row) => ({
      id: row.id, name: row.name, status: row.status, campaign_id: row.campaign_id
    }))
  };
}

export function adsCardModel({ campaigns, groups, ads, syncedAt, synced_at, statusError, report, reportOkAt, report_error, ga4, ga4Rows, now = new Date(), stale = false } = {}) {
  const synced = syncedAt || synced_at || null;
  const tables = tableFields(report, ga4Rows, ads, report_error);
  const list = Array.isArray(campaigns) ? campaigns : [];
  if (!list.length) {
    return {
      ok: true,
      heading: 'unavailable',
      stale: false,
      synced_at: synced,
      message: statusError || 'Live campaign status unavailable.',
      current: [],
      monitoring: 'Monitoring limits are shown separately for each campaign.',
      figures: figuresText(report, reportOkAt),
      ga4: ga4 || 'GA4 unavailable',
      ...tables,
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
    ...currentRow(row, groups, now), name: row.name, note: HISTORICAL_IDS[row.id] || ''
  }));
  return {
    ok: true,
    heading: current.length ? 'active' : displayState(ranked[0], now),
    stale,
    synced_at: synced,
    message: stale ? 'Last read failed. Showing the previous sync.' : '',
    current,
    monitoring: 'Monitoring limits are shown separately for each campaign.',
    figures: figuresText(report, reportOkAt),
    ga4: ga4 || 'GA4 unavailable',
    ...tables,
    historical_note: HISTORICAL_NOTE,
    historical
  };
}
