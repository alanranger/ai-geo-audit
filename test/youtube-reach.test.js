import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseReportCsv,
  aggregateReachRows,
  normaliseCtrToRatio,
  selectReportsForWindow,
} from '../lib/acquisition/youtube-reach.js';
import { youtubeReach, youtubeEngagement } from '../lib/acquisition/channels-report.js';

test('parseReportCsv splits a bulk report into headers and rows', () => {
  const { headers, rows } = parseReportCsv(
    'date,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr\n'
    + '20260829,abc,1000,0.05\n'
    + '20260829,def,500,0.10\n'
  );
  assert.deepEqual(headers, ['date', 'video_id', 'video_thumbnail_impressions', 'video_thumbnail_impressions_ctr']);
  assert.equal(rows.length, 2);
});

test('parseReportCsv returns empty for a header-only report', () => {
  const { headers, rows } = parseReportCsv('date,video_id,video_thumbnail_impressions\n');
  assert.equal(headers.length, 3);
  assert.equal(rows.length, 0);
});

test('parseReportCsv survives empty input', () => {
  assert.deepEqual(parseReportCsv(''), { headers: [], rows: [] });
  assert.deepEqual(parseReportCsv(null), { headers: [], rows: [] });
});

// A CTR is a ratio of totals. Averaging per-row ratios would let a video with
// 3 impressions count as much as one with 30,000.
test('aggregateReachRows derives CTR from summed clicks over summed impressions', () => {
  const agg = aggregateReachRows(parseReportCsv(
    'video_thumbnail_impressions,video_thumbnail_impressions_ctr\n'
    + '1000,0.10\n'
    + '9000,0.01\n'
  ));
  assert.equal(agg.impressions, 10000);
  assert.equal(agg.clicks, 190);
  assert.ok(Math.abs(agg.ctr_pct - 1.9) < 1e-9, `expected 1.9%, got ${agg.ctr_pct}`);
});

test('aggregateReachRows would differ from a naive mean of ratios', () => {
  const csv = 'video_thumbnail_impressions,video_thumbnail_impressions_ctr\n1000,0.10\n9000,0.01\n';
  const agg = aggregateReachRows(parseReportCsv(csv));
  const naiveMean = ((0.10 + 0.01) / 2) * 100;
  assert.notEqual(agg.ctr_pct.toFixed(2), naiveMean.toFixed(2));
});

test('aggregateReachRows reports null impressions when the column is absent', () => {
  const agg = aggregateReachRows(parseReportCsv('date,video_id\n20260829,abc\n'));
  assert.equal(agg.impressions, null);
  assert.equal(agg.ctr_pct, null);
});

test('aggregateReachRows skips unparseable impression cells', () => {
  const agg = aggregateReachRows(parseReportCsv(
    'video_thumbnail_impressions,video_thumbnail_impressions_ctr\n100,0.5\nn/a,0.5\n'
  ));
  assert.equal(agg.impressions, 100);
});

test('aggregateReachRows gives no CTR when nothing was impressed', () => {
  const agg = aggregateReachRows(parseReportCsv(
    'video_thumbnail_impressions,video_thumbnail_impressions_ctr\n0,0\n'
  ));
  assert.equal(agg.impressions, 0);
  assert.equal(agg.ctr_pct, null, 'no impressions means no rate, not a zero rate');
});

// Google's docs call this column both a 0-1 float and "a percentage". The two
// readings differ by 100x, so the guard matters.
test('normaliseCtrToRatio treats <=1 as a ratio and >1 as an already-percent value', () => {
  assert.equal(normaliseCtrToRatio(0.05), 0.05);
  assert.equal(normaliseCtrToRatio(1), 1);
  assert.ok(Math.abs(normaliseCtrToRatio(5) - 0.05) < 1e-9);
  assert.equal(normaliseCtrToRatio('bad'), 0);
  assert.equal(normaliseCtrToRatio(-3), 0);
});

test('selectReportsForWindow keeps only reports inside the window, newest first', () => {
  const now = Date.parse('2026-08-30T00:00:00Z');
  const picked = selectReportsForWindow([
    { startTime: '2026-08-29T00:00:00Z' },
    { startTime: '2026-06-01T00:00:00Z' },
    { startTime: '2026-08-20T00:00:00Z' },
  ], 28, now);
  assert.equal(picked.length, 2);
  assert.equal(picked[0].startTime, '2026-08-29T00:00:00Z');
});

test('youtubeReach prefers impressions and labels the unit impr', () => {
  const reach = youtubeReach([
    { captured_date: '2026-08-30', total_views: 76814, views_window: 123, impressions_window: 41000 },
  ]);
  assert.equal(reach.value, 41000);
  assert.equal(reach.unit, 'impr');
  assert.equal(reach.state, 'ok');
});

test('youtubeReach falls back to views and says the unit is not impressions', () => {
  const reach = youtubeReach([
    { captured_date: '2026-08-30', total_views: 76814, views_window: 123, impressions_window: null },
  ]);
  assert.equal(reach.value, 123);
  assert.equal(reach.unit, 'views');
  assert.match(reach.note, /impressions pending/);
});

test('youtubeReach reports awaiting_setup with no snapshots at all', () => {
  const reach = youtubeReach([]);
  assert.equal(reach.value, null);
  assert.equal(reach.state, 'awaiting_setup');
});

test('youtubeEngagement takes each field from the newest row carrying it', () => {
  // Impressions are written by a different job from views, so the newest row
  // can legitimately have watch time but no impressions yet.
  const eng = youtubeEngagement([
    { captured_date: '2026-08-30', views_window: 123, watch_time_minutes_window: 265, window_days: 28 },
    { captured_date: '2026-08-29', impressions_window: 41000, impressions_ctr_window: 3.4 },
  ]);
  assert.equal(eng.views, 123);
  assert.equal(eng.watch_time_minutes, 265);
  assert.equal(eng.impressions, 41000);
  assert.equal(eng.impressions_ctr_pct, 3.4);
});

test('youtubeEngagement is null when no window metric has landed', () => {
  assert.equal(youtubeEngagement([]), null);
  assert.equal(youtubeEngagement([{ captured_date: '2026-08-30', total_views: 76814 }]), null);
});

test('youtubeEngagement keeps a measured zero rather than dropping it', () => {
  const eng = youtubeEngagement([{ captured_date: '2026-08-30', clicks_to_site_window: 0, window_days: 28 }]);
  assert.equal(eng.clicks_to_site, 0);
});
