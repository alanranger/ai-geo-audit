/**
 * Unit tests: surface score curves + weight redistribution.
 * Run: node scripts/test-surface-scores.mjs
 */
import {
  scoreOrganic,
  scorePack,
  scoreAio,
  scoreFsPaa,
  scoreKp,
  redistributeWeights,
  computeKeywordSurfaceScore,
  computeSurfaceVisibilityRollup,
  CLASS_WEIGHTS,
} from '../lib/audit/surfaceScores.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${b}, got ${a}`);
}

// Organic curve
assertEq(scoreOrganic(1), 100, 'org1');
assertEq(scoreOrganic(2), 90, 'org2');
assertEq(scoreOrganic(3), 80, 'org3');
assertEq(scoreOrganic(4), 75, 'org4');
assertEq(scoreOrganic(10), 50, 'org10');
assertEq(scoreOrganic(11), 45, 'org11');
assertEq(scoreOrganic(20), 20, 'org20');
assertEq(scoreOrganic(null), 0, 'org null');

// Pack
assertEq(scorePack(1), 100, 'pack1');
assertEq(scorePack(2), 70, 'pack2');
assertEq(scorePack(3), 50, 'pack3');
assertEq(scorePack(4), 30, 'pack4');
assertEq(scorePack(null), 0, 'pack absent');

// AIO / FS / KP
assertEq(scoreAio(2), 100, 'aio2');
assertEq(scoreAio(1), 80, 'aio1');
assertEq(scoreAio(0), 0, 'aio0');
assertEq(scoreFsPaa(true, false), 100, 'fs');
assertEq(scoreFsPaa(false, true), 60, 'paa');
assertEq(scoreFsPaa(false, false), 0, 'neither');
assertEq(scoreKp(true), 100, 'kp');
assertEq(scoreKp(false), 0, 'kp miss');

// Redistribution: brand with no KP served → kp weight redistributes
{
  const served = { organic: true, pack: true, aio: true, fs_paa: false, kp: false };
  const w = redistributeWeights(CLASS_WEIGHTS.brand, served);
  const sum = Object.values(w).reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - 100) < 0.01, 'weights sum 100');
  assertEq(w.kp, 0, 'kp weight 0 when unserved');
  assert(w.organic > CLASS_WEIGHTS.brand.organic, 'organic boosted');
}

// Local-money keyword with pack #1, organic #4, no AIO
{
  const row = {
    keyword: 'photography lessons near me',
    keyword_class: 'local-money',
    best_rank_group: 4,
    local_pack_present_any: true,
    local_pack_position: 1,
    has_ai_overview: false,
    featured_snippet_present_any: false,
    paa_present_any: false,
    kp_present: false,
  };
  const s = computeKeywordSurfaceScore(row);
  // served: organic+pack only → weights 30+35=65 → organic 30/65, pack 35/65
  // score ≈ (30/65)*75 + (35/65)*100
  const expected = Math.round((30 / 65) * 75 + (35 / 65) * 100);
  assertEq(s.score, expected, 'local-money pack+organic');
  assert(s.subscores.aio === null, 'aio not scored when unserved');
}

// Brand with KP ours + organic #1
{
  const row = {
    keyword: 'alan ranger',
    keyword_class: 'brand',
    best_rank_group: 1,
    local_pack_present_any: false,
    has_ai_overview: false,
    featured_snippet_present_any: false,
    paa_present_any: false,
    kp_present: true,
    kp_ours: true,
  };
  const s = computeKeywordSurfaceScore(row);
  // organic 35 + kp 40 = 75 → org 35/75*100 + kp 40/75*100
  const expected = Math.round((35 / 75) * 100 + (40 / 75) * 100);
  assertEq(s.score, expected, 'brand kp+organic');
  assert(s.score >= 85 && s.score <= 100, 'brand dial ballpark');
}

// Rollup
{
  const rows = [
    {
      keyword: 'alan ranger',
      keyword_class: 'brand',
      best_rank_group: 1,
      kp_present: true,
      kp_ours: true,
      search_volume: 100,
    },
    {
      keyword: 'photography lessons near me',
      keyword_class: 'local-money',
      best_rank_group: 4,
      local_pack_present_any: true,
      local_pack_position: 1,
      search_volume: 50,
    },
  ];
  const roll = computeSurfaceVisibilityRollup(rows);
  assertEq(roll.schema_version, 2, 'schema v2');
  assert(roll.overall > 0, 'overall');
  assert(roll.byClass.brand.count === 1, 'brand count');
  assert(roll.byClass['local-money'].count === 1, 'local count');
}

console.log('surface-scores tests OK');
