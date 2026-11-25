/** Pull Ads status into chatgpt_ads_sync. Page loads reuse a row newer than 15 minutes. */

import { adsCardModel, displayState } from './chatgpt-ads-card.js';
import { readAccount, readPerformance } from './openai-ads-read.js';

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

async function ga4Line(sb, ads) {
  const ids = [...new Set((ads || []).map((row) => row.id).filter(Boolean))];
  if (!ids.length) return 'GA4: no ad ids on this sync';
  const { data, error } = await sb.from('ga4_campaign_daily')
    .select('sessions,engaged_sessions,content')
    .eq('source', 'chatgpt')
    .in('content', ids)
    .limit(5000);
  if (error) return 'GA4 unavailable';
  if (!data?.length) return 'GA4: no stored sessions for these ad ids';
  let sessions = 0;
  let engaged = 0;
  for (const row of data) {
    sessions += Number(row.sessions || 0);
    engaged += Number(row.engaged_sessions || 0);
  }
  return `GA4 sessions ${sessions}, engaged sessions ${engaged}`;
}

async function performanceFor(campaigns, now) {
  const active = (campaigns || []).filter((row) => displayState(row, now) === 'active');
  if (!active.length) return { report: { data: [] }, reportError: null, gotRows: false };
  const data = [];
  try {
    for (const campaign of active) {
      const json = await readPerformance(campaign);
      data.push(...(json.data || []));
    }
    return { report: { data }, reportError: null, gotRows: data.length > 0 };
  } catch (err) {
    return { report: { data: [] }, reportError: err.message, gotRows: false };
  }
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
    const ga4 = await ga4Line(sb, account.ads);
    return adsCardModel({ ...patch, ga4, now });
  } catch (err) {
    const stale = previous?.campaigns?.length && !previous.status_error;
    await save(sb, {
      status_error: err.message,
      synced_at: previous?.synced_at || null
    }).catch(() => {});
    if (!stale) return adsCardModel({ statusError: err.message, now });
    const ga4 = await ga4Line(sb, previous.ads);
    return adsCardModel({
      campaigns: previous.campaigns,
      groups: previous.groups,
      syncedAt: previous.synced_at,
      report: { data: [] },
      reportOkAt: previous.report_ok_at,
      ga4,
      now,
      stale: true
    });
  }
}

export async function loadAdsCard(sb, { force = false, now = new Date() } = {}) {
  const row = await readRow(sb);
  if (!force && fresh(row)) {
    const ga4 = await ga4Line(sb, row.ads);
    return adsCardModel({
      campaigns: row.campaigns,
      groups: row.groups,
      syncedAt: row.synced_at,
      report: row.report,
      reportOkAt: row.report_ok_at,
      ga4,
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
