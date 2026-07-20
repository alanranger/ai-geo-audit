import assert from 'node:assert/strict';
import {
  enrichFindings, parseGooglePrefers, tagWorkstream, COURSES_HUB
} from '../lib/configIntegrity/enrichFindings.mjs';

const pagesMap = new Map([
  [COURSES_HUB, { tier: 'A_landing' }],
  ['/beginners-photography-classes', { tier: 'B_product' }],
  ['/blog-on-photography/photography-lessons-for-beginners', { tier: 'D_blog' }]
]);

const ctx = {
  pagesMap,
  volumeByKw: new Map([['beginner photography classes', 720]]),
  gscByPath: new Map([['/beginners-photography-classes', { clicks_28d: 12, impressions_28d: 400 }]])
};

const hubFinding = {
  check: 3,
  severity: 'amber',
  subject: 'beginner photography classes',
  detail: `Google prefers ${COURSES_HUB}; assigned page /beginners-photography-classes`
};

const enriched = enrichFindings([hubFinding], ctx)[0];
assert.match(enriched.meaning, /Searchers for 'beginner photography classes'/);
assert.match(enriched.at_stake, /720/);
assert.match(enriched.at_stake, /12 clicks/);
assert.equal(enriched.workstream, 'WS1');
assert.match(enriched.suggested_action, /WS1/);

const blogFinding = {
  check: 3,
  severity: 'amber',
  subject: 'basic photography course',
  detail: 'Google prefers /blog-on-photography/photography-lessons-for-beginners; assigned page /beginners-photography-classes'
};
const blogEnriched = enrichFindings([blogFinding], ctx)[0];
assert.equal(blogEnriched.workstream, 'WS3');
assert.match(blogEnriched.suggested_action, /cross-link/);

const parsed = parseGooglePrefers(hubFinding.detail);
assert.equal(parsed.preferred, COURSES_HUB);
assert.equal(parsed.assigned, '/beginners-photography-classes');
assert.equal(tagWorkstream('x', COURSES_HUB, '/beginners-photography-classes', new Set()), 'WS1');

console.log('enrichFindings tests OK');
