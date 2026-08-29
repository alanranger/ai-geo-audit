import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalisePeriod,
  monthsForPeriod,
  monthKeysBack,
  weekBuckets,
  bucketGscSeries,
  bucketMonthlyFlat,
  bucketAcademySeries,
  youtubeWindowViews,
  buildChannelRows,
  rankChannels,
} from '../lib/acquisition/channels-report.js';

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
  assert.equal(buckets[0].label, 'wk-4');
  assert.equal(buckets[3].label, 'wk-1');
  assert.equal(buckets[3].end, '2026-08-29');
  assert.equal(buckets[3].start, '2026-08-23');
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

test('buildChannelRows marks YouTube as awaiting setup while reach is unknown', () => {
  const rows = buildChannelRows(SOURCES);
  const yt = rows.find((r) => r.key === 'youtube');
  assert.equal(yt.state, 'awaiting_setup');
  assert.equal(yt.reach.value, null);
  assert.equal(yt.trials, 1, 'Academy trials are still attributed while reach is missing');
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
