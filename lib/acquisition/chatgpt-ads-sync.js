/** Pull Ads status into chatgpt_ads_sync. Page loads reuse a row newer than 15 minutes. */

import { adsCardModel, displayState } from './chatgpt-ads-card.js';
import { londonDay, readAccount, readInsights } from './openai-ads-read.js';

const FRESH_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

async function readRow(sb) {
  const { data, error } = await sb.from('chatgpt_ads_sync').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function fresh(row) {
  if (!row?.synced_at || row.status_error) return false;
  return Date.now() - new Date(row.synced_at).getTime() < FRESH_MS;
}

function liveAds(campaigns, ads, now) {
  const ids = new Set((campaigns || []).filter((row) => displayState(row, now) === 'active').map((row) => row.id));
  return (ads || []).filter((row) => ids.has(row.campaign_id));
}

function flightFrom(campaigns, now) {
  const starts = (campaigns || [])
    .filter((row) => displayState(row, now) === 'active')
    .map((row) => Number(row.start_time))
    .filter((n) => n > 0);
  return starts.length ? londonDay(Math.min(...starts)) : '';
}

async function ga4Line(sb, ads, from) {
  const ids = [...new Set((ads || []).map((row) => row.id).filter(Boolean))];
  const range = from ? ` ${from} onward` : '';
  if (!ids.length) return `GA4${range}: no ad ids on the live campaign`;
  let query = sb.from('ga4_campaign_daily')
    .select('sessions,engaged_sessions,content')
    .eq('source', 'chatgpt')
    .in('content', ids);
  if (from) query = query.gte('date', from);
  const { data, error } = await query.limit(5000);
  if (error) return 'GA4 unavailable';
  if (!data?.length) return `GA4${range}: no stored sessions for these ad ids`;
  let sessions = 0;
  let engaged = 0;
  for (const row of data) {
    sessions += Number(row.sessions || 0);
    engaged += Number(row.engaged_sessions || 0);
  }
  return `GA4${range}: sessions ${sessions}, engaged sessions ${engaged}`;
}

function cardGa4(sb, campaigns, ads, now) {
  return ga4Line(sb, liveAds(campaigns, ads, now), flightFrom(campaigns, now));
}

function packMetric(row, campaignId) {
  const num = (key) => (row?.[key] == null ? null : Number(row[key]));
  return {
    campaign_id: campaignId,
    ad_id: row?.ad_id || null,
    date: row?.start_time ? londonDay(row.start_time) : null,
    impressions: num('impressions'),
    clicks: num('clicks'),
    spend: num('spend'),
    conversions: num('conversions')
  };
}

async function oneInsight(campaign, level, grain) {
  try {
    const json = await readInsights(campaign, level, grain);
    return { rows: (json.data || []).map((row) => packMetric(row, campaign.id)), error: null };
  } catch (err) {
    return { rows: [], error: err.message };
  }
}

async function performanceFor(campaigns, now) {
  const totals = [];
  const days = [];
  const adMetrics = [];
  const errors = [];
  for (const campaign of campaigns || []) {
    const total = await oneInsight(campaign, 'campaign', 'none');
    totals.push(...total.rows);
    if (total.error) errors.push(total.error);
    if (displayState(campaign, now) !== 'active') continue;
    const daily = await oneInsight(campaign, 'campaign', 'daily');
    const byAd = await oneInsight(campaign, 'ad', 'none');
    days.push(...daily.rows);
    adMetrics.push(...byAd.rows);
    if (daily.error) errors.push(daily.error);
    if (byAd.error) errors.push(byAd.error);
  }
  const activeIds = new Set((campaigns || []).filter((row) => displayState(row, now) === 'active').map((row) => row.id));
  return {
    report: {
      data: totals.filter((row) => activeIds.has(row.campaign_id)),
      totals,
      days,
      ad_metrics: adMetrics
    },
    reportError: errors[0] || null,
    gotRows: totals.some((row) => row.impressions != null || row.clicks != null || row.spend != null)
  };
}

async function ga4Rows(sb) {
  const { data, error } = await sb.from('ga4_campaign_daily')
    .select('date,content,sessions,engaged_sessions')
    .eq('source', 'chatgpt')
    .gte('date', '2026-11-01')
    .limit(5000);
  if (error) return null;
  return data || [];
}

async function save(sb, patch) {
  const { error } = await sb.from('chatgpt_ads_sync').upsert({ id: 1, ...patch });
  if (error) throw new Error(error.message);
}

export async function syncChatgptAds(sb, now = new Date()) {
  const previous = await readRow(sb);
  try {
    const account = await readAccount();
    const perf = await performanceFor(account.campaigns, now);
    const patch = {
      synced_at: now.toISOString(),
      status_error: null,
      campaigns: account.campaigns,
      groups: account.groups,
      ads: account.ads,
      report: perf.report,
      report_error: perf.reportError,
      report_ok_at: perf.gotRows ? now.toISOString() : (previous?.report_ok_at || null),
      report_empty_since: perf.gotRows ? null : (previous?.report_empty_since || now.toISOString())
    };
    await save(sb, patch);
    const ga4 = await cardGa4(sb, account.campaigns, account.ads, now);
    return adsCardModel({ ...patch, ga4, ga4Rows: await ga4Rows(sb), now });
  } catch (err) {
    const stale = previous?.campaigns?.length && !previous.status_error;
    await save(sb, {
      status_error: err.message,
      synced_at: previous?.synced_at || null
    }).catch(() => {});
    if (!stale) return adsCardModel({ statusError: err.message, now });
    const ga4 = await cardGa4(sb, previous.campaigns, previous.ads, now);
    return adsCardModel({
      campaigns: previous.campaigns,
      groups: previous.groups,
      ads: previous.ads,
      syncedAt: previous.synced_at,
      report: { data: [] },
      reportOkAt: previous.report_ok_at,
      ga4,
      ga4Rows: await ga4Rows(sb),
      now,
      stale: true
    });
  }
}

export async function loadAdsCard(sb, { force = false, now = new Date() } = {}) {
  const row = await readRow(sb);
  if (!force && fresh(row)) {
    const ga4 = await cardGa4(sb, row.campaigns, row.ads, now);
    return adsCardModel({
      campaigns: row.campaigns,
      groups: row.groups,
      ads: row.ads,
      syncedAt: row.synced_at,
      report: row.report,
      reportOkAt: row.report_ok_at,
      report_error: row.report_error,
      ga4,
      ga4Rows: await ga4Rows(sb),
      now
    });
  }
  return syncChatgptAds(sb, now);
}

export function adsBriefLine(row, now = new Date()) {
  if (!row?.synced_at || row.status_error) {
    return { state: 'warn', text: `ChatGPT Ads status sync failed${row?.status_error ? `: ${row.status_error}` : ''}` };
  }
  const active = (row.campaigns || []).some((campaign) => displayState(campaign, now) === 'active');
  const emptySince = row.report_empty_since ? new Date(row.report_empty_since).getTime() : 0;
  if (active && emptySince && now.getTime() - emptySince > DAY_MS) {
    return { state: 'warn', text: 'ChatGPT Ads reporting has been empty for more than 24 hours while a campaign is active' };
  }
  return { state: 'ok', text: 'ChatGPT Ads status sync is current' };
}
