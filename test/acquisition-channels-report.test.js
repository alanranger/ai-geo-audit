import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalisePeriod,
  monthsForPeriod,
  monthKeysBack,
  weekBuckets,
  shortDate,
  bucketGscSeries,
  bucketMonthlyFlat,
  bucketAcademySeries,
  youtubeWindowViews,
  bucketGa4Visits,
  bucketGa4Series,
  buildChannelRows,
  rankChannels,
} from '../lib/acquisition/channels-report.js';

const ga4Row = (date, channel_group, source, sessions, is_unattributed = false) =>
  ({ date, channel_group, source, medium: '', sessions, is_unattributed });

test('normalisePeriod only accepts the three offered windows', () => {
  assert.equal(normalisePeriod('60'), 60);
  assert.equal(normalisePeriod(90), 90);
  assert.equal(normalisePeriod('45'), 28);
  assert.equal(normalisePeriod(undefined), 28);
});

test('monthsForPeriod maps each period onto whole months of AI history', () => {
  assert.equal(monthsForPeriod(28), 1);
  assert.equal(monthsForPeriod(60), 2);
  assert.equal(monthsForPeriod(90), 3);
});

test('monthKeysBack walks backwards across a year boundary', () => {
  const keys = monthKeysBack(3, new Date('2026-01-15T00:00:00Z'));
  assert.deepEqual(keys, ['2026-01-01', '2025-12-01', '2025-11-01']);
});

test('weekBuckets covers the period oldest first and ends today', () => {
  const buckets = weekBuckets(28, new Date('2026-08-29T00:00:00Z'));
  assert.equal(buckets.length, 4);
  assert.equal(buckets[3].end, '2026-08-29');
  assert.equal(buckets[3].start, '2026-08-23');
});

test('weekBuckets labels with real dates — a relative week number dates nothing', () => {
  const buckets = weekBuckets(28, new Date('2026-08-29T00:00:00Z'));
  assert.equal(buckets[0].label, '2 Aug');
  assert.equal(buckets[3].label, '23 Aug');
  assert.equal(buckets[3].range, '23 Aug – 29 Aug');
  assert.ok(!buckets.some((b) => /^wk-/.test(b.label)));
});

test('weekBuckets stays readable across a 90 day period', () => {
  const buckets = weekBuckets(90, new Date('2026-08-29T00:00:00Z'));
  assert.equal(buckets.length, 13);
  assert.equal(buckets[0].label, '31 May');
  assert.equal(buckets[12].label, '23 Aug');
});

test('shortDate renders a day and month, and refuses junk', () => {
  assert.equal(shortDate('2026-08-04'), '4 Aug');
  assert.equal(shortDate('2026-12-31'), '31 Dec');
  assert.equal(shortDate('nonsense'), '');
  assert.equal(shortDate(null), '');
});

test('bucketGscSeries sums daily clicks and impressions into their week', () => {
  const buckets = weekBuckets(28, new Date('2026-08-29T00:00:00Z'));
  const { clicks, impressions } = bucketGscSeries(
    [
      { date: '2026-08-29', clicks: 10, impressions: 100 },
      { date: '2026-08-25', clicks: 5, impressions: 50 },
      { date: '2026-07-01', clicks: 999, impressions: 999 },
    ],
    buckets
  );
  assert.equal(clicks[3], 15, 'both August dates fall in the latest week');
  assert.equal(impressions[3], 150);
  assert.equal(clicks.reduce((a, b) => a + b, 0), 15, 'the July row is outside every bucket');
});

test('bucketMonthlyFlat holds a month value flat and returns null for months with no data', () => {
  const buckets = weekBuckets(28, new Date('2026-08-29T00:00:00Z'));
  const series = bucketMonthlyFlat([{ month: '2026-08-01', mentions: 25 }], buckets);
  assert.deepEqual(series, [25, 25, 25, 25]);

  const missing = bucketMonthlyFlat([{ month: '2026-06-01', mentions: 39 }], buckets);
  assert.deepEqual(missing, [null, null, null, null]);
});

test('bucketAcademySeries counts starts and conversions in their own weeks', () => {
  const buckets = weekBuckets(28, new Date('2026-08-29T00:00:00Z'));
  const channelOf = (r) => r.channel;
  const { started, converted } = bucketAcademySeries(
    [
      { channel: 'youtube', trial_start_at: '2026-08-29T10:00:00Z', converted_at: null },
      { channel: 'youtube', trial_start_at: '2026-08-10T10:00:00Z', converted_at: '2026-08-28T10:00:00Z' },
      { channel: 'chatgpt', trial_start_at: '2026-08-29T10:00:00Z', converted_at: null },
    ],
    buckets,
    'youtube',
    channelOf
  );
  assert.equal(started[3], 1, 'only the 29 Aug youtube trial is in the last week');
  assert.equal(converted[3], 1);
  assert.equal(started.reduce((a, b) => a + b, 0), 2);
});

test('youtubeWindowViews will not guess a period from a single snapshot', () => {
  const one = youtubeWindowViews([{ captured_date: '2026-08-29', total_views: 76779 }]);
  assert.equal(one.value, null);
  assert.equal(one.state, 'awaiting_history');
  assert.match(one.note, /second daily snapshot|yt-analytics/);
});

test('youtubeWindowViews differences two snapshots and prefers Analytics when present', () => {
  const delta = youtubeWindowViews([
    { captured_date: '2026-08-29', total_views: 76900 },
    { captured_date: '2026-08-01', total_views: 76779 },
  ]);
  assert.equal(delta.value, 121);

  const analytics = youtubeWindowViews([
    { captured_date: '2026-08-29', total_views: 76900, views_window: 500 },
  ]);
  assert.equal(analytics.value, 500);
  assert.equal(analytics.note, null);
});

test('youtubeWindowViews reports no snapshot rather than zero', () => {
  const none = youtubeWindowViews([]);
  assert.equal(none.value, null);
  assert.equal(none.state, 'awaiting_setup');
  assert.match(none.note, /awaiting YouTube authorisation/);
});

const SOURCES = {
  gscTotals: { clicks: 5916, impressions: 1575519 },
  llmMonthly: {
    chat_gpt: [{ month: '2026-08-01', mentions: 25 }],
    google: [{ month: '2026-08-01', mentions: 258 }],
  },
  llmLatest: {
    chat_gpt: { mentions: 93, own_domain_mentions: 24 },
    google: { mentions: 821, own_domain_mentions: 821 },
  },
  youtubeSnapshots: [{ captured_date: '2026-08-29', total_views: 76779 }],
  academyByChannel: { youtube: { trials: 1, members: 0 } },
};

test('buildChannelRows returns all five channels with native reach units', () => {
  const rows = buildChannelRows(SOURCES);
  assert.equal(rows.length, 5);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

  assert.equal(byKey.google_organic.reach.value, 1575519);
  assert.equal(byKey.google_organic.reach.unit, 'impr');
  assert.equal(byKey.google_organic.visits.value, 5916);

  assert.equal(byKey.chatgpt.reach.value, 25);
  assert.equal(byKey.chatgpt.reach.unit, 'mentions');
  assert.deepEqual(byKey.chatgpt.cited, { value: 24, of: 93 });
});

test('buildChannelRows returns null, never 0, for unmeasurable visits', () => {
  const rows = buildChannelRows(SOURCES);
  for (const key of ['chatgpt', 'google_ai', 'youtube', 'direct_referral']) {
    const row = rows.find((r) => r.key === key);
    assert.equal(row.visits.value, null, `${key} visits must not be a misleading zero`);
    assert.ok(row.visits.note, `${key} must explain why visits are unavailable`);
  }
});

test('bucketGa4Visits keeps bot traffic out of every channel total', () => {
  const out = bucketGa4Visits([
    ga4Row('2026-08-29', 'AI Assistant', 'chatgpt.com', 69),
    ga4Row('2026-08-29', 'AI Assistant', 'gemini.google.com', 32),
    ga4Row('2026-08-29', 'Direct', '(direct)', 6928),
    ga4Row('2026-08-29', 'Referral', 'togdays.co.uk', 28),
    ga4Row('2026-08-29', 'Unassigned', '(not set)', 43407, true),
  ]);
  assert.equal(out.visits.chatgpt, 69);
  assert.equal(out.visits.google_ai, 32);
  assert.equal(out.visits.direct_referral, 6956);
  assert.equal(out.visits.youtube, 0, 'no youtube source means a measured zero');
  assert.equal(out.unattributed_sessions, 43407);
  assert.equal(out.attributed_sessions, 7057);
});

test('bucketGa4Visits matches youtube subdomains but not lookalike hosts', () => {
  const out = bucketGa4Visits([
    ga4Row('2026-08-29', 'Referral', 'm.youtube.com', 5),
    ga4Row('2026-08-29', 'Referral', 'youtube.com', 3),
    ga4Row('2026-08-29', 'Referral', 'notyoutube.com', 99),
  ]);
  assert.equal(out.visits.youtube, 8);
});

test('bucketGa4Series buckets one channel by date and ignores bots', () => {
  const buckets = [
    { label: 'wk-2', start: '2026-08-15', end: '2026-08-21' },
    { label: 'wk-1', start: '2026-08-22', end: '2026-08-28' },
  ];
  const series = bucketGa4Series([
    ga4Row('2026-08-16', 'AI Assistant', 'chatgpt.com', 10),
    ga4Row('2026-08-25', 'AI Assistant', 'chatgpt.com', 7),
    ga4Row('2026-08-25', 'Unassigned', '(not set)', 5000, true),
    ga4Row('2026-08-25', 'Direct', '(direct)', 900),
  ], buckets, 'chatgpt');
  assert.deepEqual(series, [10, 7]);
});

test('buildChannelRows leaves visits null when GA4 has not been pulled', () => {
  const rows = buildChannelRows(SOURCES);
  assert.equal(rows.find((r) => r.key === 'chatgpt').visits.value, null);
  assert.match(rows.find((r) => r.key === 'chatgpt').visits.note, /not measurable/);
});

test('buildChannelRows fills visits from GA4 and keeps organic on GSC clicks', () => {
  const rows = buildChannelRows({
    ...SOURCES,
    ga4: { visits: { chatgpt: 69, google_ai: 32, youtube: 0, direct_referral: 6956 } },
  });
  const by = (k) => rows.find((r) => r.key === k);
  assert.equal(by('chatgpt').visits.value, 69);
  assert.equal(by('google_ai').visits.value, 32);
  assert.equal(by('direct_referral').visits.value, 6956);
  assert.equal(by('youtube').visits.value, 0);
  assert.equal(by('google_organic').visits.value, 5916, 'organic stays on Search Console clicks');
  assert.match(by('google_organic').visits.note, /Search Console/);
  assert.match(by('google_ai').visits.note, /AI Overviews/);
});

test('buildChannelRows separates a connected channel from an unconnected one', () => {
  const connected = buildChannelRows(SOURCES).find((r) => r.key === 'youtube');
  assert.equal(connected.state, 'awaiting_history', 'one snapshot means connected, not unconfigured');
  assert.equal(connected.reach.value, null);
  assert.equal(connected.trials, 1, 'Academy trials are still attributed while reach is missing');

  const unconnected = buildChannelRows({ ...SOURCES, youtubeSnapshots: [] }).find((r) => r.key === 'youtube');
  assert.equal(unconnected.state, 'awaiting_setup');
  assert.equal(unconnected.context, null);
});

test('buildChannelRows carries lifetime YouTube facts while period reach accrues', () => {
  const yt = buildChannelRows({
    ...SOURCES,
    youtubeSnapshots: [{ captured_date: '2026-08-29', total_views: 76800, subscribers: 154, total_videos: 40 }],
  }).find((r) => r.key === 'youtube');
  assert.deepEqual(yt.context, { subscribers: 154, total_views: 76800, total_videos: 40 });
});

test('buildChannelRows computes trial to paid only when there are trials', () => {
  const rows = buildChannelRows({
    ...SOURCES,
    academyByChannel: { youtube: { trials: 4, members: 1 }, chatgpt: { trials: 0, members: 0 } },
  });
  assert.equal(rows.find((r) => r.key === 'youtube').trial_to_paid_pct, 25);
  assert.equal(rows.find((r) => r.key === 'chatgpt').trial_to_paid_pct, null);
});

test('rankChannels ranks on the common denominator, not on reach', () => {
  const rows = buildChannelRows(SOURCES);

  const site = rankChannels(rows, 'site');
  assert.equal(site[0].key, 'google_organic', 'organic has the only measurable visits');

  const academy = rankChannels(rows, 'academy');
  assert.equal(academy[0].members, 0);
  // ChatGPT reach (25) beats YouTube reach (null) but YouTube has the trial,
  // so the Academy lens must not let reach decide the order.
  assert.equal(academy[0].key, 'youtube');
});
