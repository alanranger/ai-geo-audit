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

const check1 = enrichFindings([{
  check: 1, severity: 'red', subject: 'workshop photography',
  detail: 'target_page /foo missing from pages_master'
}], ctx)[0];
assert.match(check1.meaning, /missing from pages_master|not in pages_master/);
assert.ok(check1.suggested_action);

const check4 = enrichFindings([{
  check: 4, severity: 'red', subject: '/some-page',
  detail: 'utility/none_utility page contributing to money headline input'
}], ctx)[0];
assert.match(check4.meaning, /utility/);
assert.equal(check4.workstream, 'WS6');

const check5 = enrichFindings([{
  check: 5, severity: 'amber', subject: '12 pages', detail: 'Tier F count=12'
}], ctx)[0];
assert.match(check5.meaning, /12/);

const check6 = enrichFindings([{
  check: 6, severity: 'red', subject: '09-url-target-keywords.csv',
  detail: 'STALE EXPORT: repo hash abc ≠ DB hash def'
}], ctx)[0];
assert.match(check6.suggested_action, /Regenerate/);

console.log('enrichFindings tests OK');
