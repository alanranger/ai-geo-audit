import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliseAggregated,
  normaliseHistorical,
  UK_LOCATION_CODE,
} from '../lib/acquisition/llm-mentions.js';
import {
  normaliseChannel,
  normaliseVideos,
  normaliseAnalyticsWindow,
  missingSetup,
} from '../lib/acquisition/youtube-stats.js';
import {
  channelForSource,
  summariseByChannel,
  UNATTRIBUTED,
} from '../lib/acquisition/academy-signup-source.js';

// Shape copied from a live DataForSEO ai_optimization/llm_mentions
// aggregated_metrics/live response for alanranger.com.
const AGGREGATED = [
  {
    total: {
      location: [
        { key: '2840', mentions: 350, ai_search_volume: 213420 },
        { key: '2826', mentions: 271, ai_search_volume: 86680 },
      ],
      platform: [{ key: 'google', mentions: 821, ai_search_volume: 419720 }],
      sources_domain: [
        { key: 'www.alanranger.com', mentions: 821, ai_search_volume: 419720 },
        { key: 'www.youtube.com', mentions: 120, ai_search_volume: 5000 },
      ],
    },
  },
];

test('normaliseAggregated emits a rolled-up row plus the UK slice', () => {
  const rows = normaliseAggregated(AGGREGATED, 'google', '2026-08-29', 0.101);
  assert.equal(rows.length, 2);

  const total = rows[0];
  assert.equal(total.location_code, null);
  assert.equal(total.mentions, 821);
  assert.equal(total.ai_search_volume, 419720);
  assert.equal(total.own_domain_mentions, 821);
  assert.equal(total.cost_usd, 0.101);
  assert.equal(total.top_sources.length, 2);

  const uk = rows[1];
  assert.equal(uk.location_code, UK_LOCATION_CODE);
  assert.equal(uk.mentions, 271);
  assert.equal(uk.ai_search_volume, 86680);
});

test('normaliseAggregated separates own-domain citations from total mentions', () => {
  const chatGpt = [
    {
      total: {
        location: [],
        platform: [{ key: 'chat_gpt', mentions: 93, ai_search_volume: 2153 }],
        sources_domain: [
          { key: 'www.alanranger.com', mentions: 24, ai_search_volume: 525 },
          { key: 'www.reddit.com', mentions: 19, ai_search_volume: 248 },
        ],
      },
    },
  ];
  const rows = normaliseAggregated(chatGpt, 'chat_gpt', '2026-08-29');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mentions, 93);
  assert.equal(rows[0].own_domain_mentions, 24);
});

test('normaliseAggregated returns nothing when the payload has no totals', () => {
  assert.deepEqual(normaliseAggregated(null, 'google', '2026-08-29'), []);
  assert.deepEqual(normaliseAggregated([{}], 'google', '2026-08-29'), []);
});

test('normaliseHistorical keys months on the first of the month', () => {
  const rows = normaliseHistorical(
    [
      {
        items: [
          { year: 2026, month: 8, metrics: { mentions: 258, ai_search_volume: 68210 } },
          { year: 2025, month: 12, metrics: { mentions: 224, ai_search_volume: 205410 } },
          { year: null, month: null, metrics: {} },
        ],
      },
    ],
    'google'
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].month, '2026-08-01');
  assert.equal(rows[0].mentions, 258);
  assert.equal(rows[1].month, '2025-12-01');
  assert.equal(rows[1].platform, 'google');
});

test('normaliseChannel maps Data API statistics and leaves owner-only metrics null', () => {
  const row = normaliseChannel(
    {
      id: 'UC123',
      snippet: { title: 'Alan Ranger Photography' },
      statistics: { subscriberCount: '5120', viewCount: '840000', videoCount: '312' },
    },
    '2026-08-29',
    28,
    'data_api'
  );
  assert.equal(row.channel_id, 'UC123');
  assert.equal(row.subscribers, 5120);
  assert.equal(row.total_views, 840000);
  assert.equal(row.total_videos, 312);
  assert.equal(row.impressions_window, null);
  assert.equal(row.clicks_to_site_window, null);
  assert.equal(row.source, 'data_api');
});

test('normaliseVideos drops entries with no video id', () => {
  const rows = normaliseVideos(
    [
      { id: 'v1', snippet: { title: 'A', publishedAt: '2026-01-01T00:00:00Z' }, statistics: { viewCount: '10' } },
      { snippet: { title: 'no id' }, statistics: {} },
    ],
    'UC123',
    '2026-08-29'
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].video_id, 'v1');
  assert.equal(rows[0].views, 10);
  assert.equal(rows[0].likes, null);
});

test('normaliseAnalyticsWindow reads metrics positionally from column headers', () => {
  const mapped = normaliseAnalyticsWindow({
    columnHeaders: [
      { name: 'views' },
      { name: 'estimatedMinutesWatched' },
      { name: 'impressions' },
      { name: 'impressionsClickThroughRate' },
      { name: 'cardClicks' },
    ],
    rows: [[1200, 4300, 50000, 3.4, 27]],
  });
  assert.equal(mapped.views_window, 1200);
  assert.equal(mapped.impressions_window, 50000);
  assert.equal(mapped.impressions_ctr_window, 3.4);
  assert.equal(mapped.clicks_to_site_window, 27);
});

test('normaliseAnalyticsWindow returns empty when the report has no rows', () => {
  assert.deepEqual(normaliseAnalyticsWindow({ columnHeaders: [], rows: [] }), {});
});

test('missingSetup names the YouTube credentials still owed', () => {
  const missing = missingSetup({
    apiKey: '',
    channelId: '',
    handle: '',
    analytics: { refreshToken: '' },
  });
  assert.equal(missing.length, 3);
  assert.ok(missing[0].includes('YOUTUBE_API_KEY'));
  assert.ok(missing[2].includes('YOUTUBE_REFRESH_TOKEN'));
});

test('channelForSource maps known marketing sources and falls back safely', () => {
  assert.equal(channelForSource('YouTube'), 'youtube');
  assert.equal(channelForSource('chatgpt'), 'chatgpt');
  assert.equal(channelForSource('referral'), 'direct_referral');
  assert.equal(channelForSource('some-newsletter'), 'other');
  assert.equal(channelForSource(null), UNATTRIBUTED);
  assert.equal(channelForSource('   '), UNATTRIBUTED);
});

test('summariseByChannel counts trials and conversions per channel', () => {
  const since = '2026-08-01T00:00:00.000Z';
  const { rows } = summariseByChannel(
    [
      { trial_start_at: '2026-08-29T10:00:00Z', signup_source: 'youtube', converted_at: '2026-08-30T10:00:00Z' },
      { trial_start_at: '2026-08-29T11:00:00Z', signup_source: 'youtube', converted_at: null },
      { trial_start_at: '2026-08-20T11:00:00Z', signup_source: null, converted_at: null },
      { trial_start_at: '2026-07-01T11:00:00Z', signup_source: 'youtube', converted_at: null },
    ],
    since
  );
  const youtube = rows.find((r) => r.channel === 'youtube');
  assert.equal(youtube.trials, 2, 'the July trial is outside the window');
  assert.equal(youtube.members, 1);
  assert.equal(youtube.trial_to_paid_pct, 50);

  const unattributed = rows.find((r) => r.channel === UNATTRIBUTED);
  assert.equal(unattributed.trials, 1);
  assert.equal(unattributed.trial_to_paid_pct, 0);
});

test('summariseByChannel flags trials that predate attribution capture', () => {
  const { pre_attribution_trials: pre } = summariseByChannel(
    [
      { trial_start_at: '2026-08-01T10:00:00Z', signup_source: null, converted_at: null },
      { trial_start_at: '2026-08-29T10:00:00Z', signup_source: 'youtube', converted_at: null },
    ],
    '2026-07-01T00:00:00.000Z'
  );
  assert.equal(pre, 1);
});
