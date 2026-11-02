/**
 * get-latest-audit used to cut serp_features with more than 10 keys down to 4 (ai_overview, local_pack,
 * people_also_ask, featured_snippet), so every 2 Nov row lost capture_status and the Ranking table showed
 * "legacy quality unavailable" on all 94 rows. The fixture has the 26 keys stored on 2 Nov.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { compactSerpFeatures, MAX_CONFIRMATION_OBSERVATIONS } from '../lib/keyword-ranking/compact-serp-features.js';

const obs = (n) => Array.from({ length: n }, (_, i) => ({ role: i ? 'confirmation' : 'primary', best_rank_group: null, capture_status: 'complete_no_match' }));
const nov2 = {
  capture_checked_at: '2026-11-02T10:56:01.000Z', capture_status: 'complete_no_match', confirmation_observations: obs(2),
  confirmation_state: 'confirmed_change', crawl_incomplete: false, dfs_cost: 0.0085, dfs_task_id: 'x', featured_snippet: false,
  featured_snippet_domain: null, featured_snippet_ours: false, geo_method: 'gbp_pin', kp_ours: true, kp_present: true,
  last_confirmed_at: '2026-10-26', last_confirmed_geo_method: 'gbp_pin', last_confirmed_rank_absolute: 2, last_confirmed_rank_group: 1,
  last_confirmed_url: 'https://www.alanranger.com/photography-courses-coventry', local_pack: false, local_pack_position: null,
  method_version: 'local_gbp_pin_v1', organic_count: 49, paa_ours: false, people_also_ask: false, se_results_count: 145, serp_depth_requested: 50,
};

test('a 26-key 2 Nov serp_features keeps capture_status, confirmation_state and every other field', () => {
  assert.equal(Object.keys(nov2).length, 26);
  const out = compactSerpFeatures(nov2);
  assert.deepEqual(out, nov2);
  assert.equal(out.capture_status, 'complete_no_match');
  assert.equal(out.confirmation_state, 'confirmed_change');
});

test('only a long confirmation_observations list is capped (latest kept); bad input gives {}', () => {
  const out = compactSerpFeatures({ ...nov2, confirmation_observations: obs(6) });
  assert.equal(out.confirmation_observations.length, MAX_CONFIRMATION_OBSERVATIONS);
  assert.deepEqual(compactSerpFeatures(JSON.stringify({ capture_status: 'complete_ranked' })), { capture_status: 'complete_ranked' });
  assert.deepEqual(compactSerpFeatures('not json'), {});
  assert.deepEqual(compactSerpFeatures(null), {});
  assert.deepEqual(compactSerpFeatures([1]), {});
});
