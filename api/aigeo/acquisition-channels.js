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
import {
  SOURCES,
  ga4RealVisitsSection,
  ga4Section,
  gscSection,
  gscCoverage,
  gscExplainer,
  aiSection,
  youtubeSection,
  detailRows,
  attachPrevToSections,
} from '../../lib/acquisition/acquisition-sections.js';

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

function periodBounds(days) {
  const currentStart = isoDaysAgo(days);
  const prevStart = isoDaysAgo(days * 2);
  return { currentStart, prevStart };
}

function splitByIsoDate(rows, dateKey, days) {
  const { currentStart, prevStart } = periodBounds(days);
  const current = [];
  const previous = [];
  for (const row of rows || []) {
    const d = String(row?.[dateKey] || '').slice(0, 10);
    if (!d) continue;
    if (d >= currentStart) current.push(row);
    else if (d >= prevStart) previous.push(row);
  }
  return { current, previous };
}

function splitAcademyTrials(rows, days) {
  const { currentStart, prevStart } = periodBounds(days);
  const curMs = new Date(`${currentStart}T00:00:00.000Z`).getTime();
  const prevMs = new Date(`${prevStart}T00:00:00.000Z`).getTime();
  const current = [];
  const previous = [];
  for (const row of rows || []) {
    const ms = new Date(row.trial_start_at).getTime();
    if (!Number.isFinite(ms)) continue;
    if (ms >= curMs) current.push(row);
    else if (ms >= prevMs) previous.push(row);
  }
  return { current, previous };
}

function splitLlmMonths(llm, days) {
  const n = monthsForPeriod(days);
  const keys = monthKeysBack(n * 2);
  const currentKeys = new Set(keys.slice(0, n));
  const prevKeys = new Set(keys.slice(n));
  const pick = (platform, keySet) => (llm?.monthly?.[platform] || []).filter((r) => keySet.has(r.month));
  return {
    current: { monthly: { chat_gpt: pick('chat_gpt', currentKeys), google: pick('google', currentKeys) }, latest: llm.latest },
    previous: { monthly: { chat_gpt: pick('chat_gpt', prevKeys), google: pick('google', prevKeys) }, latest: {} },
  };
}

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
  const monthCount = monthsForPeriod(days);
  const months = monthKeysBack(monthCount);
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
    .select('captured_date, total_views, views_window, subscribers, total_videos, source, '
      + 'window_days, impressions_window, impressions_ctr_window, '
      + 'watch_time_minutes_window, clicks_to_site_window')
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

/**
 * Trend metrics, one unit and one source each.
 *
 * The old chart offered a single "Reach per channel" line set that put GSC
 * impressions (millions), AI mentions (hundreds) and YouTube views (dozens) on
 * one shared axis. Everything except impressions was flattened onto the
 * baseline, and the shape implied the four were the same measurement. Each
 * unit now trends on its own axis or not at all.
 */
function trendMetrics(buckets, gscRows, llm, academyRows, ga4Rows) {
  const gsc = bucketGscSeries(gscRows, buckets);
  const nulls = buckets.map(() => null);
  const academyFor = (key) => bucketAcademySeries(academyRows, buckets, key, (r) => channelForSource(r.signup_source));
  const named = (key) => CHANNELS.find((c) => c.key === key)?.name || key;

  const visits = CHANNELS.map((ch) => ({
    key: ch.key,
    label: named(ch.key),
    data: ga4Rows ? bucketGa4Series(ga4Rows, buckets, ch.key) : nulls,
  }));
  const trials = CHANNELS.map((ch) => ({ key: ch.key, label: named(ch.key), data: academyFor(ch.key).started }));
  const members = CHANNELS.map((ch) => ({ key: ch.key, label: named(ch.key), data: academyFor(ch.key).converted }));

  return [
    {
      key: 'visits',
      label: 'Site visits per channel',
      unit: 'visits',
      source: 'GA4',
      lens: 'both',
      series: visits,
    },
    {
      key: 'gsc_clicks',
      label: 'Google Search clicks',
      unit: 'clicks',
      source: 'GSC',
      lens: 'site',
      series: [{ key: 'gsc_clicks', label: 'Clicks (all pages)', data: gsc.clicks }],
    },
    {
      key: 'gsc_impressions',
      label: 'Google Search impressions',
      unit: 'impr',
      source: 'GSC',
      lens: 'site',
      series: [{ key: 'gsc_impressions', label: 'Impressions (all pages)', data: gsc.impressions }],
    },
    {
      key: 'ai_mentions',
      label: 'AI mentions',
      unit: 'mentions',
      source: 'D4S',
      lens: 'site',
      series: [
        { key: 'chatgpt', label: 'ChatGPT', data: bucketMonthlyFlat(llm.monthly.chat_gpt, buckets) },
        { key: 'google_ai', label: 'Google AI', data: bucketMonthlyFlat(llm.monthly.google, buckets) },
      ],
    },
    { key: 'trials', label: 'Trials per channel', unit: 'trials', source: 'Academy', lens: 'academy', series: trials },
    { key: 'members', label: 'Members per channel', unit: 'members', source: 'Academy', lens: 'academy', series: members },
  ];
}

function buildTrend(buckets, gscRows, llm, academyRows, ga4Rows) {
  return {
    buckets: buckets.map((b) => b.label),
    bucket_ranges: buckets.map((b) => b.range),
    metrics: trendMetrics(buckets, gscRows, llm, academyRows, ga4Rows),
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

function buildSections({ ga4Rows, gscTotals, gscRows, llm, rows }) {
  const organicVisits = rows.find((r) => r.key === 'google_organic')?.visits?.value ?? null;
  const yt = rows.find((r) => r.key === 'youtube');
  const gsc = gscSection(gscTotals, gscCoverage(gscRows));
  return [
    ga4RealVisitsSection(ga4Rows),
    ga4Section(ga4Rows),
    { ...gsc, explainer: gscExplainer(gscTotals?.clicks ?? null, organicVisits) },
    aiSection(llm),
    youtubeSection(yt?.reach, yt?.context, yt?.engagement),
  ];
}

function buildPeriodBundle({ ga4Rows, gscRows, llm, youtubeRows, academyRows }) {
  const totals = academyTotals(academyRows);
  const ga4 = ga4Rows.length ? bucketGa4Visits(ga4Rows) : null;
  const gscTotals = totalsFromGsc(gscRows);
  const rows = buildChannelRows({
    gscTotals,
    llmMonthly: llm.monthly,
    llmLatest: llm.latest,
    youtubeSnapshots: youtubeRows,
    academyByChannel: totals.byChannel,
    ga4,
  });
  return buildSections({ ga4Rows, gscTotals, gscRows, llm, rows });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  const sb = admin();
  if (!sb) return send(res, 500, { ok: false, error: 'missing_supabase_credentials' });
  const days = normalisePeriod(req.query?.days);

  try {
    const [gscAll, llmAll, youtubeAll, academyAll, ga4All] = await Promise.all([
      fetchGsc(sb, days * 2),
      fetchLlm(sb, days * 2),
      fetchYoutube(sb, days * 2),
      fetchAcademyTrials(days * 2),
      fetchGa4(sb, days * 2),
    ]);

    const gscSplit = splitByIsoDate(gscAll, 'date', days);
    const ga4Split = splitByIsoDate(ga4All, 'date', days);
    const ytSplit = splitByIsoDate(youtubeAll, 'captured_date', days);
    const academySplit = splitAcademyTrials(academyAll.rows, days);
    const llmSplit = splitLlmMonths(llmAll, days);

    const gscRows = gscSplit.current;
    const ga4Rows = ga4Split.current;
    const youtubeRows = ytSplit.current;
    const academyRows = academySplit.current;
    const llm = llmSplit.current;

    const totals = academyTotals(academyRows);
    const ga4 = ga4Rows.length ? bucketGa4Visits(ga4Rows) : null;
    const gscTotals = totalsFromGsc(gscRows);
    const rows = buildChannelRows({
      gscTotals,
      llmMonthly: llm.monthly,
      llmLatest: llm.latest,
      youtubeSnapshots: youtubeRows,
      academyByChannel: totals.byChannel,
      ga4,
    });
    const buckets = weekBuckets(days, new Date());
    const sections = attachPrevToSections(
      buildPeriodBundle({ ga4Rows, gscRows, llm, youtubeRows, academyRows }),
      buildPeriodBundle({
        ga4Rows: ga4Split.previous,
        gscRows: gscSplit.previous,
        llm: llmSplit.previous,
        youtubeRows: ytSplit.previous,
        academyRows: academySplit.previous,
      })
    );

    return send(res, 200, {
      ok: true,
      generated_at: new Date().toISOString(),
      period_days: days,
      sources: SOURCES,
      sections,
      detail: detailRows(sections),
      channels: rows,
      trend: buildTrend(buckets, gscRows, llm, academyRows, ga4Rows.length ? ga4Rows : null),
      ga4: ga4 && {
        attributed_sessions: ga4.attributed_sessions,
        unattributed_sessions: ga4.unattributed_sessions,
        attributed_pct: ga4.attributed_pct,
      },
      academy: {
        configured: academyAll.configured,
        attribution_start: ATTRIBUTION_START,
        unattributed_trials_in_window: totals.unattributed,
        pre_attribution_trials: await countPreAttributionTrials(),
      },
      comparison: {
        prior_period_days: days,
        note: `Deltas compare this ${days}-day window with the previous ${days} days.`,
      },
      notes: {
        ai_platforms: 'ChatGPT and Google AI are the only platforms DataForSEO llm_mentions covers — Gemini and Perplexity are not available from this source.',
        ai_granularity: `AI mention history is month-granular; this period uses the last ${monthsForPeriod(days)} month(s).`,
        reach: 'Reach units differ per tool (impressions vs mentions vs views) and are never summed. Only the GA4 visits section adds up.',
        keywords: 'Keyword-level detail lives in the Keyword Ranking & AI tab.',
        visits: 'Every visits figure on this tab is GA4 sessions, including Google organic — one ruler throughout. GA4\'s "Unassigned" bucket is excluded: on this property it is automated traffic (3% engaged, ~5s sessions, 1.00 pages per session).',
      },
    });
  } catch (err) {
    return send(res, 500, { ok: false, error: err?.message || String(err) });
  }
}
