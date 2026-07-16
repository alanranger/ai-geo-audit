/**
 * Quick unit check for tracked empty-SERP stubs.
 * Usage: node scripts/test-empty-serp-stub.mjs
 */
import {
  applyTrackedEmptySerpStubs,
  isLockedTrackedKeyword,
  EMPTY_SERP_STUB_ERROR,
} from '../lib/keyword-ranking/empty-serp-stub.js';

const tracked = 'camera courses coventry';
const untracked = 'zzzz not a real tracked keyword xyz';

if (!isLockedTrackedKeyword(tracked)) {
  console.error('FAIL: expected locked tracked keyword');
  process.exit(1);
}
if (isLockedTrackedKeyword(untracked)) {
  console.error('FAIL: untracked should not be locked');
  process.exit(1);
}

const [stub] = applyTrackedEmptySerpStubs([{
  keyword: tracked,
  best_rank_group: null,
  best_rank_absolute: null,
  serp_surface_stack: [],
  search_volume: null,
}]);

if (stub.error !== EMPTY_SERP_STUB_ERROR || stub.serp_features?.stub !== true) {
  console.error('FAIL: stub not flagged', stub);
  process.exit(1);
}
if (!stub.keyword_class || stub.class_unmapped !== false) {
  console.error('FAIL: stub missing class', stub.keyword_class, stub.class_unmapped);
  process.exit(1);
}
if (!(stub.search_volume > 0) && stub.search_volume !== 0 && stub.search_volume != null) {
  // volume may be null if KE has no entry; class/location are the hard requirements
}
if (!stub.location_name) {
  console.error('FAIL: stub missing location_name');
  process.exit(1);
}

const [passthrough] = applyTrackedEmptySerpStubs([{
  keyword: untracked,
  best_rank_group: null,
  best_rank_absolute: null,
  serp_surface_stack: [],
}]);
if (passthrough.error) {
  console.error('FAIL: untracked must not be stubbed', passthrough);
  process.exit(1);
}

const [ranked] = applyTrackedEmptySerpStubs([{
  keyword: tracked,
  best_rank_group: 3,
  best_rank_absolute: 3,
  serp_surface_stack: [{ type: 'organic', slot: 3 }],
}]);
if (ranked.error) {
  console.error('FAIL: ranked row must not be stubbed');
  process.exit(1);
}

console.log('PASS empty-serp-stub', {
  keyword: stub.keyword,
  class: stub.keyword_class,
  location: stub.location_name,
  volume: stub.search_volume,
  error: stub.error,
});
