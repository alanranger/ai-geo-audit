/**
 * Acquisition — Channels tab data.
 *
 * One request per period; the UI drives cards, trend chart and detail table
 * from this single payload so all three zones always agree.
 *
 * GET /api/aigeo/acquisition-channels?days=28
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { createClient } from '@supabase/supabase-js';
import {
  CHANNELS,
  normalisePeriod,
  monthsForPeriod,
  monthKeysBack,
  weekBuckets,
  bucketGscSeries,
  bucketMonthlyFlat,
  bucketAcademySeries,
  bucketGa4Series,
  bucketGa4Visits,
  buildChannelRows,
} from '../../lib/acquisition/channels-report.js';
import {
  ATTRIBUTION_START,
  channelForSource,
  academyClient,
} from '../../lib/acquisition/academy-signup-source.js';

const PROPERTY = 'https://www.alanranger.com';

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
};

function admin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

const isoDaysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

/**
 * Property-level daily totals, NOT gsc_page_timeseries. The page-level table
 * holds ~8k rows per 28 days, which silently truncates at PostgREST's 1000-row
 * cap and produces totals that shrink as the window grows. One row per day
 * keeps every period well inside the cap.
 */
async function fetchGsc(sb, days) {
  const { data, error } = await sb
    .from('gsc_timeseries')
    .select('date, clicks, impressions')
    .eq('property_url', PROPERTY)
    .gte('date', isoDaysAgo(days))
    .order('date', { ascending: true })
    .limit(400);
  if (error) throw new Error(`gsc_timeseries: ${error.message}`);
  return data || [];
}

async function fetchLlm(sb, days) {
  const months = monthKeysBack(monthsForPeriod(days));
  const [monthlyRes, dailyRes] = await Promise.all([
    sb.from('llm_mentions_monthly')
      .select('platform, month, mentions, ai_search_volume')
      .eq('property_url', PROPERTY)
      .in('month', months),
    sb.from('llm_mentions_daily')
      .select('platform, captured_date, mentions, own_domain_mentions')
      .eq('property_url', PROPERTY)
      .is('location_code', null)
      .order('captured_date', { ascending: false })
      .limit(20),
  ]);
  if (monthlyRes.error) throw new Error(`llm_mentions_monthly: ${monthlyRes.error.message}`);
  if (dailyRes.error) throw new Error(`llm_mentions_daily: ${dailyRes.error.message}`);

  const monthly = { chat_gpt: [], google: [] };
  for (const row of monthlyRes.data || []) monthly[row.platform]?.push(row);
  const latest = {};
  for (const row of dailyRes.data || []) {
    if (!latest[row.platform]) latest[row.platform] = row;
  }
  return { monthly, latest, months };
}

async function fetchYoutube(sb, days) {
  const { data, error } = await sb
    .from('youtube_channel_stats')
    .select('captured_date, total_views, views_window, subscribers, total_videos, source')
    .gte('captured_date', isoDaysAgo(days))
    .order('captured_date', { ascending: false })
    .limit(200);
  if (error) throw new Error(`youtube_channel_stats: ${error.message}`);
  return data || [];
}

async function fetchAcademyTrials(days) {
  const sb = academyClient();
  if (!sb) return { configured: false, rows: [] };
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await sb
    .from('academy_trial_history')
    .select('member_id, trial_start_at, converted_at, signup_source')
    .gte('trial_start_at', since)
    .limit(5000);
  if (error) throw new Error(`academy_trial_history: ${error.message}`);
  return { configured: true, rows: data || [] };
}

function academyTotals(rows) {
  const byChannel = {};
  let unattributed = 0;
  for (const row of rows || []) {
    const key = channelForSource(row.signup_source);
    if (key === 'unattributed' || key === 'other') {
      unattributed += 1;
      continue;
    }
    if (!byChannel[key]) byChannel[key] = { trials: 0, members: 0 };
    byChannel[key].trials += 1;
    if (row.converted_at) byChannel[key].members += 1;
  }
  return { byChannel, unattributed };
}

/**
 * Paginated on purpose. 90 days of channel/source/medium rows exceeds
 * PostgREST's 1000-row default, and a silent truncation here would understate
 * visits exactly the way gsc_page_timeseries once understated organic.
 */
async function fetchGa4(sb, days) {
  const PAGE = 1000;
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('ga4_channel_sessions_daily')
      .select('date, channel_group, source, medium, sessions, is_unattributed')
      .gte('date', isoDaysAgo(days))
      .order('date', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`ga4_channel_sessions_daily: ${error.message}`);
    all.push(...(data || []));
    if (!data || data.length < PAGE) return all;
  }
}

async function countPreAttributionTrials() {
  const sb = academyClient();
  if (!sb) return null;
  const { count, error } = await sb
    .from('academy_trial_history')
    .select('member_id', { count: 'exact', head: true })
    .lt('trial_start_at', `${ATTRIBUTION_START}T00:00:00.000Z`);
  if (error) return null;
  return count ?? null;
}

function buildTrend(buckets, gscRows, llm, academyRows, ga4Rows) {
  const gsc = bucketGscSeries(gscRows, buckets);
  const nulls = buckets.map(() => null);
  const academyFor = (key) => bucketAcademySeries(academyRows, buckets, key, (r) => channelForSource(r.signup_source));

  const series = { visits: {}, reach: {}, trials: {}, members: {} };
  for (const ch of CHANNELS) {
    const a = academyFor(ch.key);
    series.trials[ch.key] = a.started;
    series.members[ch.key] = a.converted;
    if (ch.key === 'google_organic') series.visits[ch.key] = gsc.clicks;
    else if (ga4Rows) series.visits[ch.key] = bucketGa4Series(ga4Rows, buckets, ch.key);
    else series.visits[ch.key] = nulls;
    if (ch.key === 'google_organic') series.reach[ch.key] = gsc.impressions;
    else if (ch.key === 'chatgpt') series.reach[ch.key] = bucketMonthlyFlat(llm.monthly.chat_gpt, buckets);
    else if (ch.key === 'google_ai') series.reach[ch.key] = bucketMonthlyFlat(llm.monthly.google, buckets);
    else series.reach[ch.key] = nulls;
  }
  return {
    buckets: buckets.map((b) => b.label),
    bucket_ranges: buckets.map((b) => b.range),
    series,
  };
}

function totalsFromGsc(rows) {
  return rows.reduce(
    (acc, r) => ({
      clicks: acc.clicks + Number(r.clicks || 0),
      impressions: acc.impressions + Number(r.impressions || 0),
    }),
    { clicks: 0, impressions: 0 }
  );
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  const sb = admin();
  if (!sb) return send(res, 500, { ok: false, error: 'missing_supabase_credentials' });
  const days = normalisePeriod(req.query?.days);

  try {
    const [gscRows, llm, youtubeRows, academy, ga4Rows] = await Promise.all([
      fetchGsc(sb, days),
      fetchLlm(sb, days),
      fetchYoutube(sb, days),
      fetchAcademyTrials(days),
      fetchGa4(sb, days),
    ]);

    const totals = academyTotals(academy.rows);
    const ga4 = ga4Rows.length ? bucketGa4Visits(ga4Rows) : null;
    const rows = buildChannelRows({
      gscTotals: totalsFromGsc(gscRows),
      llmMonthly: llm.monthly,
      llmLatest: llm.latest,
      youtubeSnapshots: youtubeRows,
      academyByChannel: totals.byChannel,
      ga4,
    });
    const buckets = weekBuckets(days, new Date());

    return send(res, 200, {
      ok: true,
      generated_at: new Date().toISOString(),
      period_days: days,
      channels: rows,
      trend: buildTrend(buckets, gscRows, llm, academy.rows, ga4Rows.length ? ga4Rows : null),
      ga4: ga4 && {
        attributed_sessions: ga4.attributed_sessions,
        unattributed_sessions: ga4.unattributed_sessions,
        attributed_pct: ga4.attributed_pct,
      },
      academy: {
        configured: academy.configured,
        attribution_start: ATTRIBUTION_START,
        unattributed_trials_in_window: totals.unattributed,
        pre_attribution_trials: await countPreAttributionTrials(),
      },
      notes: {
        ai_platforms: 'ChatGPT and Google AI are the only platforms DataForSEO llm_mentions covers — Gemini and Perplexity are not available from this source.',
        ai_granularity: `AI mention history is month-granular; this period uses the last ${monthsForPeriod(days)} month(s).`,
        reach: 'Reach units differ per channel (impressions vs mentions vs views) and are never summed. Channels rank on visits (site lens) or members (Academy lens).',
        keywords: 'Keyword-level detail lives in the Keyword Ranking & AI tab.',
        visits: 'Google organic visits are Search Console clicks (Google only). Every other channel is GA4 sessions, excluding GA4\'s "Unassigned" bucket — on this property that bucket is automated traffic (3% engaged, ~5s sessions, 1.00 pages per session).',
      },
    });
  } catch (err) {
    return send(res, 500, { ok: false, error: err?.message || String(err) });
  }
}
