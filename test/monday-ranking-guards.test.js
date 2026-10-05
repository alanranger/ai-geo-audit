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

test('slimRankingForPersist drops bulk but keeps resume fields', () => {
  const slim = slimRankingForPersist({
    phase: 'serp',
    auditDate: '2026-10-05',
    keywords: ['a', 'b'],
    serpBatchIndex: 3,
    aiBatchIndex: 0,
    spendState: { attempts_used: 4 },
    serpRows: [{ keyword: 'a', best_rank_group: 1, huge: 'x'.repeat(1000) }],
    aiRows: []
  });
  assert.equal(slim.serpBatchIndex, 3);
  assert.equal(slim.serpRows[0].keyword, 'a');
  assert.equal(slim.serpRows[0].huge, undefined);
  assert.equal(slim.spendState.attempts_used, 4);
});
