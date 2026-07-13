/**
 * Unit tests: Top-of-Page score (schema_version 3).
 * Run: node scripts/test-top-of-page.mjs
 */
import { buildSerpSurfaceStack } from '../lib/keyword-ranking/serp-surface-stack.js';
import {
  slotValue,
  packMultiplier,
  organicMultiplier,
  surfaceMultiplier,
  computeKeywordTopOfPageScore,
  computeTopOfPageRollup,
  TOP_OF_PAGE_SCHEMA_VERSION,
} from '../lib/audit/topOfPage.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${b}, got ${a}`);
}

// Slot decay
assertEq(slotValue(1), 100, 'slot1');
assertEq(slotValue(2), 75, 'slot2');
assertEq(slotValue(3), 55, 'slot3');
assertEq(slotValue(6), 22, 'slot6');
assertEq(slotValue(7), 15, 'slot7 floor');
assertEq(slotValue(10), 15, 'slot10 floor');

// Ownership multipliers
assertEq(packMultiplier(1), 1.0, 'pack1');
assertEq(packMultiplier(2), 0.85, 'pack2');
assertEq(packMultiplier(3), 0.7, 'pack3');
assertEq(packMultiplier(4), 0.5, 'pack4');
assertEq(packMultiplier(null), 0, 'pack absent');
assertEq(organicMultiplier(1), 1.0, 'org norm 1');
assertEq(Math.round(organicMultiplier(4) * 100), 75, 'org norm 4');

// Organic block collapsing
{
  const items = [
    { type: 'ai_overview', rank_absolute: 1, references: [{ domain: 'wikipedia.org', url: 'https://wikipedia.org' }] },
    { type: 'local_pack', title: 'Alan Ranger Photography', rank_absolute: 2, rank_group: 1 },
    { type: 'local_pack', title: 'Other', domain: 'other.com', rank_absolute: 3, rank_group: 2 },
    { type: 'organic', domain: 'other.com', rank_absolute: 4, rank_group: 1 },
    { type: 'organic', domain: 'alanranger.com', rank_absolute: 5, rank_group: 2 },
    { type: 'organic', domain: 'third.com', rank_absolute: 6, rank_group: 3 },
  ];
  const stack = buildSerpSurfaceStack(items);
  assertEq(stack.length, 3, 'three vertical slots');
  assertEq(stack[0].type, 'ai_overview', 'aio first');
  assertEq(stack[1].type, 'local_pack', 'pack collapsed');
  assertEq(stack[1].our_position, 1, 'pack pos 1');
  assertEq(stack[2].type, 'organic', 'organic collapsed');
  assertEq(stack[2].our_position, 2, 'organic our pos 2');
}

// Brand KP override
{
  const row = {
    keyword: 'alan ranger photography',
    keyword_class: 'brand',
    kp_ours: true,
    serp_surface_stack: [{ slot: null, type: 'knowledge_panel', ours: true }],
  };
  const s = computeKeywordTopOfPageScore(row);
  assertEq(s.score, 100, 'brand kp override');
  assertEq(s.best_surface, 'knowledge_panel', 'kp surface');
}

// Best single appearance + breadth cap
{
  const row = {
    keyword: 'photography lessons near me',
    keyword_class: 'local-money',
    serp_surface_stack: [
      { slot: 1, type: 'ai_overview', ours: false, our_position: null },
      { slot: 2, type: 'local_pack', ours: true, our_position: 1 },
      { slot: 3, type: 'organic', ours: true, our_position: 4 },
      { slot: 4, type: 'people_also_ask', ours: true, our_position: null },
    ],
  };
  const s = computeKeywordTopOfPageScore(row);
  // best: pack slot2 75*1.0=75; organic 55*0.75=41.25; paa 40*0.6=24
  assertEq(s.score, 85, 'best 75 + breadth 10 (2 extra owned)');
  assertEq(s.best_surface, 'local_pack', 'best is pack');
}

// Exclusion: unserved surfaces not penalised (score from what is served)
{
  const row = {
    keyword: 'test',
    keyword_class: 'national-money',
    serp_surface_stack: [
      { slot: 1, type: 'organic', ours: true, our_position: 10 },
    ],
  };
  const s = computeKeywordTopOfPageScore(row);
  assert(s.score > 0 && s.score < 60, 'organic only, no penalty for missing aio/pack');
}

// Demand weighting rollup
{
  const rows = [
    {
      keyword: 'high vol',
      keyword_class: 'local-money',
      search_volume: 1000,
      serp_surface_stack: [{ slot: 1, type: 'local_pack', ours: true, our_position: 1 }],
    },
    {
      keyword: 'low vol',
      keyword_class: 'local-money',
      search_volume: null,
      serp_surface_stack: [{ slot: 1, type: 'organic', ours: true, our_position: 20 }],
    },
  ];
  const roll = computeTopOfPageRollup(rows);
  assertEq(roll.schema_version, TOP_OF_PAGE_SCHEMA_VERSION, 'schema v3');
  assert(roll.overall > 50, 'demand weighted toward high vol pack');
  assertEq(roll.byClass['local-money'].count, 2, 'class count');
}

// surfaceMultiplier spot checks
assertEq(surfaceMultiplier({ type: 'featured_snippet', ours: true }), 1.0, 'fs ours');
assertEq(surfaceMultiplier({ type: 'people_also_ask', ours: true }), 0.6, 'paa ours');
assertEq(surfaceMultiplier({ type: 'ai_overview', ours: false }), 0, 'aio uncited');

console.log('top-of-page tests OK');
