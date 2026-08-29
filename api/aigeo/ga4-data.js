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

/**
 * GA4 channel group holding automated traffic: source=(not set) / medium=(not set),
 * engaging at 2.8% vs 50.8% for real traffic. Same discriminator the Acquisition
 * tab uses (lib/acquisition/ga4-channels.js UNATTRIBUTED_GROUP) so both agree.
 */
export const GA4_UNATTRIBUTED_GROUP = 'Unassigned';

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

function isAttributedGroup(group) {
  return group !== GA4_UNATTRIBUTED_GROUP;
}

/** eventName x channelGroup rows -> raw and bot-excluded count maps. */
export function parseEventRows(report) {
  const all = {};
  const attributed = {};
  for (const row of report?.rows || []) {
    const name = row.dimensionValues?.[0]?.value;
    const group = row.dimensionValues?.[1]?.value;
    const n = Number(row.metricValues?.[0]?.value) || 0;
    if (!name) continue;
    all[name] = (all[name] || 0) + n;
    if (isAttributedGroup(group)) attributed[name] = (attributed[name] || 0) + n;
  }
  return { all, attributed };
}

/** pagePath x eventName x channelGroup rows -> site/money splits, raw and bot-excluded. */
export function parsePageEventRows(report) {
  const out = { site: 0, money: 0, siteAttributed: 0, moneyAttributed: 0 };
  for (const row of report?.rows || []) {
    const [pagePath, eventName, group] = (row.dimensionValues || []).map((d) => d?.value);
    if (!GA4_ENQUIRY_EVENT_NAMES.has(eventName)) continue;
    const n = Number(row.metricValues?.[0]?.value) || 0;
    const money = isMoneyPagePath(pagePath);
    out.site += n;
    if (money) out.money += n;
    if (!isAttributedGroup(group)) continue;
    out.siteAttributed += n;
    if (money) out.moneyAttributed += n;
  }
  return out;
}

/** channelGroup rows -> sessions/page_views split raw vs automated. */
export function parseTotalsByGroup(report) {
  const out = { sessions: 0, pageViews: 0, attributedSessions: 0, attributedPageViews: 0 };
  for (const row of report?.rows || []) {
    const group = row.dimensionValues?.[0]?.value;
    const sessions = Number(row.metricValues?.[0]?.value) || 0;
    const views = Number(row.metricValues?.[1]?.value) || 0;
    out.sessions += sessions;
    out.pageViews += views;
    if (!isAttributedGroup(group)) continue;
    out.attributedSessions += sessions;
    out.attributedPageViews += views;
  }
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
  // Every report carries sessionDefaultChannelGroup so raw and bot-excluded
  // totals come from one pass — no extra GA4 quota for the split.
  const [eventsReport, pageEventsReport, totalsReport] = await Promise.all([
    runGa4Report(accessToken, {
      dateRanges: [range],
      dimensions: [{ name: 'eventName' }, { name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'eventCount' }],
      limit: 1000,
      orderBys: [{ desc: true, metric: { metricName: 'eventCount' } }]
    }),
    runGa4Report(accessToken, {
      dateRanges: [range],
      dimensions: [{ name: 'pagePath' }, { name: 'eventName' }, { name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: enquiryFilter,
      limit: 10000
    }),
    runGa4Report(accessToken, {
      dateRanges: [range],
      dimensions: [{ name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'sessions' }, { name: 'screenPageViews' }],
      limit: 100
    })
  ]);
  const events = parseEventRows(eventsReport);
  const pageSplit = parsePageEventRows(pageEventsReport);
  const totals = parseTotalsByGroup(totalsReport);
  const enquiryAll = sumEnquiryEvents(events.all);
  return {
    ga4_property_id: ga4PropertyId(),
    date_start: startDate,
    date_end: endDate,
    sessions_28d: totals.sessions,
    page_views_28d: totals.pageViews,
    enquiry_events_28d: enquiryAll,
    money_page_enquiry_events_28d: pageSplit.money,
    event_counts: events.all,
    attributed_sessions_28d: totals.attributedSessions,
    attributed_page_views_28d: totals.attributedPageViews,
    attributed_enquiry_events_28d: sumEnquiryEvents(events.attributed),
    attributed_money_page_enquiry_events_28d: pageSplit.moneyAttributed,
    unattributed_sessions_28d: totals.sessions - totals.attributedSessions,
    unattributed_page_views_28d: totals.pageViews - totals.attributedPageViews,
    unattributed_enquiry_events_28d: enquiryAll - sumEnquiryEvents(events.attributed),
    event_counts_attributed: events.attributed,
    captured_at: new Date().toISOString()
  };
}

export async function readLatestGa4Metrics(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('ga4_site_metrics_28d')
    .select('property_url, ga4_property_id, date_start, date_end, sessions_28d, page_views_28d, enquiry_events_28d, money_page_enquiry_events_28d, event_counts, captured_at, attributed_sessions_28d, attributed_page_views_28d, attributed_enquiry_events_28d, attributed_money_page_enquiry_events_28d, unattributed_sessions_28d, unattributed_page_views_28d, unattributed_enquiry_events_28d, event_counts_attributed')
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
    attributed_sessions_28d: snap.attributed_sessions_28d ?? null,
    attributed_page_views_28d: snap.attributed_page_views_28d ?? null,
    attributed_enquiry_events_28d: snap.attributed_enquiry_events_28d ?? null,
    attributed_money_page_enquiry_events_28d: snap.attributed_money_page_enquiry_events_28d ?? null,
    unattributed_sessions_28d: snap.unattributed_sessions_28d ?? null,
    unattributed_page_views_28d: snap.unattributed_page_views_28d ?? null,
    unattributed_enquiry_events_28d: snap.unattributed_enquiry_events_28d ?? null,
    event_counts_attributed: snap.event_counts_attributed ?? null,
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

function numOrNull(value) {
  return value == null ? null : Number(value);
}

/**
 * Single place every consumer resolves GA4 figures, so no tab counts automated
 * traffic. Prefers the bot-excluded columns and falls back to raw for snapshots
 * captured before the split existed (bot_excluded === false says so honestly).
 */
export function ga4AttributedView(row) {
  if (!row) return null;
  const attributedSessions = numOrNull(row.attributed_sessions_28d);
  const excluded = attributedSessions != null;
  const pick = (attr, raw) => (excluded ? Number(attr ?? 0) : Number(raw ?? 0));
  return {
    bot_excluded: excluded,
    sessions: pick(row.attributed_sessions_28d, row.sessions_28d),
    page_views: pick(row.attributed_page_views_28d, row.page_views_28d),
    enquiry_events: pick(row.attributed_enquiry_events_28d, row.enquiry_events_28d),
    money_page_enquiry_events: pick(
      row.attributed_money_page_enquiry_events_28d,
      row.money_page_enquiry_events_28d
    ),
    excluded_sessions: excluded ? Number(row.unattributed_sessions_28d ?? 0) : 0,
    excluded_page_views: excluded ? Number(row.unattributed_page_views_28d ?? 0) : 0,
    excluded_enquiry_events: excluded ? Number(row.unattributed_enquiry_events_28d ?? 0) : 0,
    raw_sessions: Number(row.sessions_28d ?? 0),
    raw_page_views: Number(row.page_views_28d ?? 0),
    raw_enquiry_events: Number(row.enquiry_events_28d ?? 0),
    raw_money_page_enquiry_events: Number(row.money_page_enquiry_events_28d ?? 0),
    event_counts: (excluded && row.event_counts_attributed) || row.event_counts || {}
  };
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
