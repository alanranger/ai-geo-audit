/**
 * Google Business Profile Performance API helpers.
 * Scope: business.manage. Auth: getBusinessProfileAccessToken().
 */

import { getBusinessProfileAccessToken } from '../../api/aigeo/utils.js';

const PERF_BASE = 'https://businessprofileperformance.googleapis.com/v1';
const ACCOUNTS_URL = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts';
const INFO_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';

const DAILY_METRICS = [
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'WEBSITE_CLICKS',
  'CALL_CLICKS',
  'BUSINESS_DIRECTION_REQUESTS',
  'BUSINESS_CONVERSATIONS',
  'BUSINESS_BOOKINGS',
];

const METRIC_TO_FIELD = {
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 'impressions_search_mobile',
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 'impressions_search_desktop',
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: 'impressions_maps_mobile',
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 'impressions_maps_desktop',
  WEBSITE_CLICKS: 'website_clicks',
  CALL_CLICKS: 'call_clicks',
  BUSINESS_DIRECTION_REQUESTS: 'direction_requests',
  BUSINESS_CONVERSATIONS: 'conversations',
  BUSINESS_BOOKINGS: 'bookings',
};

function emptyMonthRow(locationId, monthIso) {
  return {
    location_id: locationId,
    month: monthIso,
    impressions_search_mobile: 0,
    impressions_search_desktop: 0,
    impressions_maps_mobile: 0,
    impressions_maps_desktop: 0,
    website_clicks: 0,
    call_clicks: 0,
    direction_requests: 0,
    conversations: 0,
    bookings: 0,
  };
}

function monthStartIso(year, month) {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function parseLocationId(resourceName) {
  const m = String(resourceName || '').match(/locations\/([^/]+)/);
  return m ? m[1] : null;
}

async function authFetch(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 400) }; }
  if (!r.ok) {
    const msg = json?.error?.message || text.slice(0, 300);
    throw new Error(`${r.status} ${msg}`);
  }
  return json;
}

/** Resolve primary GBP location for alanranger.com (or first with website). */
export async function resolveGbpLocation(token) {
  const accounts = await authFetch(ACCOUNTS_URL, token);
  const list = accounts.accounts || [];
  if (!list.length) throw new Error('No GBP accounts returned');

  let best = null;
  for (const account of list) {
    const url = `${INFO_BASE}/${account.name}/locations?readMask=name,title,websiteUri`;
    const data = await authFetch(url, token);
    for (const loc of data.locations || []) {
      const website = String(loc.websiteUri || '').toLowerCase();
      const candidate = {
        location_id: parseLocationId(loc.name),
        title: loc.title || null,
        website_uri: loc.websiteUri || null,
        account_name: account.name || null,
      };
      if (!candidate.location_id) continue;
      if (website.includes('alanranger.com')) return candidate;
      if (!best) best = candidate;
    }
  }
  if (!best) throw new Error('No GBP locations found');
  return best;
}

/** Fetch daily metrics and roll up to calendar months. */
export async function fetchPerformanceMonthly(token, locationId, startDate, endDate) {
  const q = new URLSearchParams();
  for (const m of DAILY_METRICS) q.append('dailyMetrics', m);
  q.set('dailyRange.start_date.year', String(startDate.year));
  q.set('dailyRange.start_date.month', String(startDate.month));
  q.set('dailyRange.start_date.day', String(startDate.day));
  q.set('dailyRange.end_date.year', String(endDate.year));
  q.set('dailyRange.end_date.month', String(endDate.month));
  q.set('dailyRange.end_date.day', String(endDate.day));

  const url = `${PERF_BASE}/locations/${locationId}:fetchMultiDailyMetricsTimeSeries?${q}`;
  const data = await authFetch(url, token);
  const byMonth = new Map();

  for (const multi of data.multiDailyMetricTimeSeries || []) {
    for (const series of multi.dailyMetricTimeSeries || []) {
      const field = METRIC_TO_FIELD[series.dailyMetric];
      if (!field) continue;
      for (const pt of series.timeSeries?.datedValues || []) {
        const y = pt.date?.year;
        const m = pt.date?.month;
        if (!y || !m) continue;
        const key = monthStartIso(y, m);
        if (!byMonth.has(key)) byMonth.set(key, emptyMonthRow(locationId, key));
        byMonth.get(key)[field] += Number(pt.value || 0);
      }
    }
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Discovery search keywords for one calendar month (API aggregates over range). */
export async function fetchDiscoveryTermsForMonth(token, locationId, year, month) {
  const q = new URLSearchParams({
    'monthlyRange.start_month.year': String(year),
    'monthlyRange.start_month.month': String(month),
    'monthlyRange.end_month.year': String(year),
    'monthlyRange.end_month.month': String(month),
    pageSize: '100',
  });
  const rows = [];
  let pageToken = null;
  const monthIso = monthStartIso(year, month);

  for (;;) {
    const url = pageToken
      ? `${PERF_BASE}/locations/${locationId}/searchkeywords/impressions/monthly?${q}&pageToken=${encodeURIComponent(pageToken)}`
      : `${PERF_BASE}/locations/${locationId}/searchkeywords/impressions/monthly?${q}`;
    const data = await authFetch(url, token);
    for (const item of data.searchKeywordsCounts || []) {
      const kw = String(item.searchKeyword || '').trim();
      if (!kw) continue;
      const iv = item.insightsValue || {};
      rows.push({
        location_id: locationId,
        month: monthIso,
        search_keyword: kw,
        impressions: iv.value != null ? Number(iv.value) : null,
        threshold: iv.threshold != null ? Number(iv.threshold) : null,
      });
    }
    pageToken = data.nextPageToken || null;
    if (!pageToken) break;
  }
  return rows;
}

export async function withGbpToken(fn) {
  const token = await getBusinessProfileAccessToken();
  return fn(token);
}

export { DAILY_METRICS, monthStartIso };
