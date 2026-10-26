import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCombinedRows } from '../lib/keyword-ranking/refresh-core.js';
import { slimRankingForPersist } from '../lib/ceo-weekly/monday-ranking-guards.js';

const pinRow = {
  keyword: 'photography lessons near me',
  best_rank_group: 1,
  best_rank_absolute: 2,
  best_url: 'https://www.alanranger.com/photography-courses-coventry',
  location_code: 9215523,
  location_coordinate: '52.3991769,-1.5937149,14z',
  organic_count: 49,
  serp_surface_stack: [{ slot: 1, type: 'organic', ours: true, our_position: 1, owners: [] }],
  serp_features: {
    geo_method: 'gbp_pin',
    method_version: 'local_gbp_pin_v1',
    capture_status: 'complete_ranked',
  },
};

test('finalize re-save of a slimmed GBP-pin row keeps gbp_pin (not city code)', () => {
  const slim = slimRankingForPersist({ serpRows: [pinRow], aiRows: [] }).serpRows[0];
  assert.equal(slim.location_coordinate, pinRow.location_coordinate);
  const [combined] = buildCombinedRows([slim], []);
  assert.equal(combined.serp_features.geo_method, 'gbp_pin');
  assert.equal(combined.serp_features.method_version, 'local_gbp_pin_v1');
});

test('row that lost its coordinate still keeps the recorded gbp_pin method', () => {
  const noCoord = { ...pinRow, location_coordinate: null };
  const [combined] = buildCombinedRows([noCoord], []);
  assert.equal(combined.serp_features.geo_method, 'gbp_pin');
});
