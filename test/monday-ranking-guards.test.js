import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isHaltRequested,
  rankingWallExceeded,
  rankingTicksExceeded,
  slimRankingForPersist,
  RANKING_WALL_MS,
  MAX_RANKING_MULTI_TICKS,
  CRON_SERP_BATCH_SIZE
} from '../lib/ceo-weekly/monday-ranking-guards.js';
import { scoreSurfaceAndTop } from '../lib/keyword-ranking/ranking-dial-scores.js';
import { computeTopOfPageRollup } from '../lib/audit/topOfPage.js';

test('halt when cancelled or done+email_sent', () => {
  assert.equal(isHaltRequested({ state: 'cancelled' }, {}), true);
  assert.equal(isHaltRequested({ state: 'done' }, { email_sent: true }), true);
  assert.equal(isHaltRequested({ state: 'running' }, { cancelled: true }), true);
  assert.equal(isHaltRequested({ state: 'running' }, { email_sent: false }), false);
  assert.equal(isHaltRequested({ state: 'done' }, { email_sent: true }, { forceRestart: true }), false);
});

test('ranking wall clock matches ~90m dashboard ceiling', () => {
  const started = new Date(Date.now() - RANKING_WALL_MS - 1000).toISOString();
  assert.equal(rankingWallExceeded({ ranking_started_at: started }), true);
  assert.equal(rankingWallExceeded({ ranking_started_at: new Date().toISOString() }), false);
  assert.equal(rankingWallExceeded({}), false);
});

test('ranking multi-tick abort', () => {
  assert.equal(rankingTicksExceeded({ multi_ticks: MAX_RANKING_MULTI_TICKS }), true);
  assert.equal(rankingTicksExceeded({ multi_ticks: 2 }), false);
});

test('cron SERP batches are smaller than dashboard 20', () => {
  assert.equal(CRON_SERP_BATCH_SIZE, 5);
});

test('slimRankingForPersist keeps serp_surface_stack for Top dial', () => {
  const slim = slimRankingForPersist({
    phase: 'serp',
    auditDate: '2026-10-05',
    keywords: ['a'],
    serpBatchIndex: 1,
    aiBatchIndex: 0,
    spendState: { attempts_used: 4 },
    serpRows: [{
      keyword: 'photography courses coventry',
      keyword_class: 'local-money',
      best_rank_group: 1,
      search_volume: 100,
      huge: 'x'.repeat(1000),
      serp_surface_stack: [{ type: 'organic', slot: 1, ours: true, our_position: 1 }]
    }],
    aiRows: []
  });
  assert.equal(slim.serpRows[0].huge, undefined);
  assert.ok(Array.isArray(slim.serpRows[0].serp_surface_stack));
  assert.equal(slim.serpRows[0].serp_surface_stack[0].type, 'organic');
  const top = computeTopOfPageRollup(slim.serpRows).overall;
  assert.ok(top > 0, `expected top>0 from slimmed stack, got ${top}`);
});

test('scoreSurfaceAndTop returns nulls for empty', () => {
  const empty = scoreSurfaceAndTop([]);
  assert.equal(empty.surface, null);
  assert.equal(empty.top, null);
});
