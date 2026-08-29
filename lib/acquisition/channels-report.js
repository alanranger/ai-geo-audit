/**
 * Acquisition — Channels report builders (pure functions, no IO).
 *
 * Reach units differ per channel (impressions vs mentions vs views), so reach
 * is NEVER summed across channels. Channels rank on the common denominator:
 * site visits for the site lens, members produced for the Academy lens.
 *
 * Anything we cannot measure is returned as null with a `note`, never as 0.
 * A zero here would read as "this channel sent nobody", which is a different
 * claim from "we have no way to see this channel yet".
 */

export const CHANNELS = [
  { key: 'google_organic', name: 'Google organic', reach_unit: 'impr' },
  { key: 'chatgpt', name: 'ChatGPT (AI)', reach_unit: 'mentions' },
  { key: 'google_ai', name: 'Google AI', reach_unit: 'mentions' },
  { key: 'youtube', name: 'YouTube', reach_unit: 'views' },
  { key: 'direct_referral', name: 'Direct / referral', reach_unit: null },
];

export const PERIODS = [28, 60, 90];
export const DEFAULT_PERIOD = 28;

export function normalisePeriod(value) {
  const n = Number(value);
  return PERIODS.includes(n) ? n : DEFAULT_PERIOD;
}

/** 28d -> 1 month, 60d -> 2, 90d -> 3. AI mention history is month-granular. */
export function monthsForPeriod(days) {
  return Math.max(1, Math.round(days / 30));
}

export function monthKeysBack(count, now = new Date()) {
  const keys = [];
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth();
  for (let i = 0; i < count; i += 1) {
    keys.push(`${y}-${String(m + 1).padStart(2, '0')}-01`);
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
  }
  return keys;
}

/** Weekly buckets covering the period, oldest first, labelled wk-N. */
export function weekBuckets(days, endDate) {
  const end = new Date(endDate);
  const count = Math.max(1, Math.round(days / 7));
  const buckets = [];
  for (let i = count; i >= 1; i -= 1) {
    const bucketEnd = new Date(end.getTime() - (i - 1) * 7 * 86400000);
    const bucketStart = new Date(bucketEnd.getTime() - 6 * 86400000);
    buckets.push({
      label: `wk-${i}`,
      start: bucketStart.toISOString().slice(0, 10),
      end: bucketEnd.toISOString().slice(0, 10),
    });
  }
  return buckets;
}

function bucketIndexFor(buckets, iso) {
  if (!iso) return -1;
  const day = String(iso).slice(0, 10);
  for (let i = 0; i < buckets.length; i += 1) {
    if (day >= buckets[i].start && day <= buckets[i].end) return i;
  }
  return -1;
}

/** Sum GSC daily rows into weekly clicks + impressions. */
export function bucketGscSeries(rows, buckets) {
  const clicks = buckets.map(() => 0);
  const impressions = buckets.map(() => 0);
  for (const row of rows || []) {
    const i = bucketIndexFor(buckets, row?.date);
    if (i < 0) continue;
    clicks[i] += Number(row.clicks || 0);
    impressions[i] += Number(row.impressions || 0);
  }
  return { clicks, impressions };
}

/** Sum attributed GA4 daily rows for one channel into the weekly buckets. */
export function bucketGa4Series(rows, buckets, channelKey) {
  const matches = GA4_CHANNEL_MATCHERS[channelKey];
  const out = buckets.map(() => 0);
  if (!matches) return out;
  for (const row of rows || []) {
    if (row?.is_unattributed || !matches(row)) continue;
    const i = bucketIndexFor(buckets, row?.date);
    if (i >= 0) out[i] += Number(row.sessions || 0);
  }
  return out;
}

/**
 * AI mention history is monthly. Rather than invent weekly variation, hold the
 * month's value flat across every week inside that month and label it as
 * month-granular in the UI.
 */
export function bucketMonthlyFlat(monthlyRows, buckets) {
  const byMonth = new Map();
  for (const row of monthlyRows || []) {
    byMonth.set(String(row.month).slice(0, 7), Number(row.mentions || 0));
  }
  return buckets.map((b) => {
    const v = byMonth.get(b.end.slice(0, 7));
    return v == null ? null : v;
  });
}

/** Count Academy trials / conversions per week for one channel. */
export function bucketAcademySeries(trials, buckets, channelKey, channelOf) {
  const started = buckets.map(() => 0);
  const converted = buckets.map(() => 0);
  for (const row of trials || []) {
    if (channelOf(row) !== channelKey) continue;
    const i = bucketIndexFor(buckets, row?.trial_start_at);
    if (i >= 0) started[i] += 1;
    const j = bucketIndexFor(buckets, row?.converted_at);
    if (j >= 0) converted[j] += 1;
  }
  return { started, converted };
}

const sumMentions = (rows) => (rows || []).reduce((t, r) => t + Number(r.mentions || 0), 0);

/**
 * Window views need two snapshots to difference; one snapshot cannot say.
 *
 * `awaiting_setup` and `awaiting_history` are deliberately distinct: the first
 * means nobody has connected the channel, the second means it is connected and
 * pulling fine but has not yet accrued a second day to difference against.
 * Reporting a working channel as "awaiting setup" sends you back to the
 * credentials screen to fix something that is not broken.
 */
export function youtubeWindowViews(snapshots) {
  const rows = (snapshots || []).filter((r) => r?.total_views != null);
  if (rows.length === 0) {
    return {
      value: null,
      state: 'awaiting_setup',
      note: 'awaiting YouTube authorisation — no snapshot has been pulled yet',
    };
  }
  const analytics = rows.find((r) => r.views_window != null);
  if (analytics) return { value: Number(analytics.views_window), state: 'ok', note: null };
  if (rows.length < 2) {
    return {
      value: null,
      state: 'awaiting_history',
      note: 'channel connected and syncing — period views need a second daily snapshot (history starts 29 Aug 2026) or the yt-analytics.readonly scope',
    };
  }
  const sorted = [...rows].sort((a, b) => String(a.captured_date).localeCompare(String(b.captured_date)));
  const delta = Number(sorted.at(-1).total_views) - Number(sorted[0].total_views);
  return { value: Math.max(0, delta), state: 'ok', note: 'derived from daily snapshot delta' };
}

/** Lifetime channel facts, worth showing while period reach is still accruing. */
function youtubeContext(snapshots) {
  const rows = (snapshots || []).filter((r) => r?.total_views != null);
  if (rows.length === 0) return null;
  const latest = [...rows].sort((a, b) => String(a.captured_date).localeCompare(String(b.captured_date))).at(-1);
  return {
    subscribers: latest.subscribers ?? null,
    total_views: latest.total_views ?? null,
    total_videos: latest.total_videos ?? null,
  };
}

const NOT_MEASURABLE = 'no referrer source wired — visits from this channel are not measurable yet';

/**
 * Which GA4 source/medium rows belong to which tab channel.
 *
 * `google_ai` matches Gemini referrals only. Google AI Overviews and AI Mode
 * send their clicks through as ordinary google/organic and carry no marker, so
 * they are NOT separable in GA4 and are not counted here — the reach figure for
 * this channel (DataForSEO mentions) covers a wider surface than the visits
 * figure does, and the UI says so.
 */
export const GA4_CHANNEL_MATCHERS = {
  chatgpt: (r) => r.source === 'chatgpt.com',
  google_ai: (r) => r.source === 'gemini.google.com',
  youtube: (r) => /(^|\.)youtube\./i.test(String(r.source || '')),
  direct_referral: (r) => r.channel_group === 'Direct' || r.channel_group === 'Referral',
};

/**
 * Sum attributed GA4 sessions into tab channels.
 *
 * Rows flagged `is_unattributed` are excluded and counted separately. On this
 * property that bucket is automated traffic, and folding it into a channel
 * would swamp every real number on the tab.
 */
export function bucketGa4Visits(rows) {
  const visits = { chatgpt: 0, google_ai: 0, youtube: 0, direct_referral: 0 };
  let attributed = 0;
  let unattributed = 0;

  for (const r of rows || []) {
    const sessions = Number(r?.sessions || 0);
    if (r?.is_unattributed) { unattributed += sessions; continue; }
    attributed += sessions;
    for (const [key, matches] of Object.entries(GA4_CHANNEL_MATCHERS)) {
      if (matches(r)) visits[key] += sessions;
    }
  }

  const total = attributed + unattributed;
  return {
    visits,
    attributed_sessions: attributed,
    unattributed_sessions: unattributed,
    attributed_pct: total ? Math.round((attributed / total) * 100) : null,
  };
}

const GA4_VISIT_NOTES = {
  chatgpt: 'GA4 sessions referred by chatgpt.com',
  google_ai: 'GA4 sessions referred by gemini.google.com — AI Overviews clicks arrive as ordinary google/organic and cannot be separated',
  youtube: 'GA4 sessions referred by youtube.com',
  direct_referral: 'GA4 Direct + Referral sessions',
};

/** A measured zero is a real answer; only an absent source stays null. */
function ga4Visits(key, ga4) {
  if (!ga4) return { value: null, note: NOT_MEASURABLE };
  return { value: ga4.visits[key] ?? 0, note: GA4_VISIT_NOTES[key] };
}

function aiChannel(base, monthly, latestDaily, ga4) {
  const mentions = sumMentions(monthly);
  const cited = latestDaily?.own_domain_mentions ?? null;
  return {
    ...base,
    reach: { value: mentions, unit: base.reach_unit, note: 'month-granular' },
    cited: cited == null ? null : { value: cited, of: latestDaily?.mentions ?? null },
    visits: ga4Visits(base.key, ga4),
    state: 'ok',
  };
}

/**
 * Assemble one row per channel. `sources` carries everything already fetched
 * so this stays pure and unit-testable.
 */
export function buildChannelRows(sources) {
  const { gscTotals, llmMonthly, llmLatest, youtubeSnapshots, academyByChannel, ga4 } = sources;
  const find = (key) => CHANNELS.find((c) => c.key === key);

  const organic = {
    ...find('google_organic'),
    reach: { value: gscTotals?.impressions ?? null, unit: 'impr', note: null },
    cited: null,
    // Search Console clicks, not GA4: they pair with the GSC impressions above
    // in the same measurement system, and are Google-only like this channel.
    visits: { value: gscTotals?.clicks ?? null, note: 'Search Console clicks (Google only)' },
    state: 'ok',
  };

  const chatgpt = aiChannel(find('chatgpt'), llmMonthly?.chat_gpt, llmLatest?.chat_gpt, ga4);
  const googleAi = aiChannel(find('google_ai'), llmMonthly?.google, llmLatest?.google, ga4);

  const ytViews = youtubeWindowViews(youtubeSnapshots);
  const youtube = {
    ...find('youtube'),
    reach: { value: ytViews.value, unit: 'views', note: ytViews.note },
    cited: null,
    visits: ga4Visits('youtube', ga4),
    context: youtubeContext(youtubeSnapshots),
    state: ytViews.state,
  };

  const direct = {
    ...find('direct_referral'),
    reach: { value: null, unit: null, note: 'no native reach unit for this channel' },
    cited: null,
    visits: ga4Visits('direct_referral', ga4),
    state: 'ok',
  };

  return [organic, chatgpt, googleAi, youtube, direct].map((row) => {
    const academy = academyByChannel?.[row.key] || { trials: 0, members: 0 };
    return {
      ...row,
      trials: academy.trials,
      members: academy.members,
      trial_to_paid_pct: academy.trials > 0
        ? Number(((academy.members / academy.trials) * 100).toFixed(1))
        : null,
    };
  });
}

/** Rank on the common denominator, never on reach. */
export function rankChannels(rows, lens) {
  const key = lens === 'academy' ? 'members' : 'visits';
  const score = (r) => (key === 'members' ? (r.members || 0) : (r.visits?.value ?? -1));
  return [...rows].sort((a, b) => score(b) - score(a) || (b.trials || 0) - (a.trials || 0));
}
