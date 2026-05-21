/**
 * GA4 Data API fetch + Supabase cache for Revenue Funnel.
 */
import { getGSCAccessToken, getGscDateRange } from './utils.js';
import { isMoneyPagePath } from '../../lib/revenue-funnel-money-pages.js';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';
const DEFAULT_GA4_PROPERTY_ID = '289575590';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Events counted as "Add-to-cart / enquiry" middle-funnel intent. */
export const GA4_ENQUIRY_EVENT_NAMES = new Set([
  'form_start',
  'view_item',
  'generate_lead',
  'begin_checkout',
  'add_to_cart',
  'checklist_download'
]);

function ga4PropertyId() {
  return String(process.env.GA4_PROPERTY_ID || DEFAULT_GA4_PROPERTY_ID).trim();
}

async function runGa4Report(accessToken, body) {
  const id = ga4PropertyId();
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${id}:runReport`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.error?.message || text.slice(0, 200);
    throw new Error(`ga4_run_report_failed:${res.status}:${msg}`);
  }
  return json;
}

function parseEventRows(report) {
  const counts = {};
  for (const row of report?.rows || []) {
    const name = row.dimensionValues?.[0]?.value;
    const n = Number(row.metricValues?.[0]?.value) || 0;
    if (name) counts[name] = n;
  }
  return counts;
}

function parsePageEventRows(report) {
  let site = 0;
  let money = 0;
  for (const row of report?.rows || []) {
    const pagePath = row.dimensionValues?.[0]?.value;
    const eventName = row.dimensionValues?.[1]?.value;
    if (!GA4_ENQUIRY_EVENT_NAMES.has(eventName)) continue;
    const n = Number(row.metricValues?.[0]?.value) || 0;
    site += n;
    if (isMoneyPagePath(pagePath)) money += n;
  }
  return { site, money };
}

function parseTotals(report, metricNames) {
  const row = report?.rows?.[0];
  const out = {};
  metricNames.forEach((key, i) => {
    out[key] = Number(row?.metricValues?.[i]?.value) || 0;
  });
  return out;
}

function sumEnquiryEvents(counts) {
  let total = 0;
  for (const [name, n] of Object.entries(counts)) {
    if (GA4_ENQUIRY_EVENT_NAMES.has(name)) total += Number(n) || 0;
  }
  return total;
}

export async function fetchGa4FromGoogle() {
  const { startDate, endDate } = getGscDateRange({ daysBack: 28, endOffsetDays: 2 });
  const accessToken = await getGSCAccessToken();
  const range = { startDate, endDate };
  const enquiryFilter = {
    filter: {
      fieldName: 'eventName',
      inListFilter: { values: [...GA4_ENQUIRY_EVENT_NAMES] }
    }
  };
  const [eventsReport, pageEventsReport, totalsReport] = await Promise.all([
    runGa4Report(accessToken, {
      dateRanges: [range],
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      limit: 100,
      orderBys: [{ desc: true, metric: { metricName: 'eventCount' } }]
    }),
    runGa4Report(accessToken, {
      dateRanges: [range],
      dimensions: [{ name: 'pagePath' }, { name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: enquiryFilter,
      limit: 10000
    }),
    runGa4Report(accessToken, {
      dateRanges: [range],
      metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }]
    })
  ]);
  const event_counts = parseEventRows(eventsReport);
  const pageSplit = parsePageEventRows(pageEventsReport);
  const totals = parseTotals(totalsReport, ['sessions', 'screenPageViews']);
  return {
    ga4_property_id: ga4PropertyId(),
    date_start: startDate,
    date_end: endDate,
    sessions_28d: totals.sessions,
    page_views_28d: totals.screenPageViews,
    enquiry_events_28d: sumEnquiryEvents(event_counts),
    money_page_enquiry_events_28d: pageSplit.money,
    event_counts,
    captured_at: new Date().toISOString()
  };
}

export async function readLatestGa4Metrics(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('ga4_site_metrics_28d')
    .select('property_url, ga4_property_id, date_start, date_end, sessions_28d, page_views_28d, enquiry_events_28d, money_page_enquiry_events_28d, event_counts, captured_at')
    .eq('property_url', propertyUrl)
    .order('date_end', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

function isCacheFresh(row) {
  if (!row?.captured_at) return false;
  return Date.now() - new Date(row.captured_at).getTime() < CACHE_MAX_AGE_MS;
}

export async function upsertGa4Snapshot(supabase, propertyUrl, snap) {
  const row = {
    property_url: propertyUrl,
    ga4_property_id: snap.ga4_property_id,
    date_start: snap.date_start,
    date_end: snap.date_end,
    sessions_28d: snap.sessions_28d,
    page_views_28d: snap.page_views_28d,
    enquiry_events_28d: snap.enquiry_events_28d,
    money_page_enquiry_events_28d: snap.money_page_enquiry_events_28d,
    event_counts: snap.event_counts,
    captured_at: snap.captured_at
  };
  const { data, error } = await supabase
    .from('ga4_site_metrics_28d')
    .upsert(row, { onConflict: 'property_url,date_end' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getGa4MetricsForProperty(supabase, propertyUrl, { forceRefresh = false } = {}) {
  const url = propertyUrl || DEFAULT_PROPERTY;
  let cached = await readLatestGa4Metrics(supabase, url);
  if (!forceRefresh && isCacheFresh(cached)) {
    return { row: cached, refreshed: false };
  }
  const snap = await fetchGa4FromGoogle();
  const row = await upsertGa4Snapshot(supabase, url, snap);
  return { row, refreshed: true };
}
