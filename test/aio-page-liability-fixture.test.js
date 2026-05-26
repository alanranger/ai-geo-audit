// AIO page-liability detector — fixture-driven integration test.
//
// 2026-05-26 defect-1 regression test. Locks in three things the
// detector engine MUST do on a fixture modelled on
// /photography-courses-coventry:
//
//   1. detectFluffyOpener flags rhetorical/aspirational opening copy.
//   2. scanLiabilities returns >=1 weak outbound citation (the
//      allbachelordegrees.com case the user surfaced).
//   3. scanLiabilities returns >=1 duplicate unsourced numeric claim
//      ("30% of UK adults" repeated twice).
//   4. ON EMPTY INPUT the detectors FAIL LOUD — they log a warning AND
//      return an `audit_status: 'incomplete'` marker rather than
//      silently emitting a neutral pass.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scanLiabilities,
  detectFluffyOpener,
  detectUnsourcedStats,
  detectWeakOutboundCitations,
  detectDuplicateClaims
} from '../lib/revenue-funnel-page-liability.js';

const FIXTURE_HTML = `
<html>
  <head><title>Photography Courses in Coventry</title></head>
  <body>
    <main>
      <h1>Photography Courses in Coventry</h1>
      <p>Ready to capture the world through your lens? Discover the journey to unleash your inner artist and unlock the beautiful, stunning, magical art of photography in our amazing beginner-friendly courses. Imagine the incredible images you could create.</p>
      <p>Around 30% of UK adults own a camera but never learn to use it properly.</p>
      <p>For context, 30% of UK adults own a camera yet never read the manual.</p>
      <p>For further reading on photography degrees, see <a href="https://allbachelordegrees.com/photography-degrees">All Bachelor Degrees</a>.</p>
      <h2>FAQs</h2>
      <p>Is photography difficult to learn? It depends on you.</p>
    </main>
  </body>
</html>
`;

const FIXTURE_BODY_TEXT = 'Ready to capture the world through your lens? Discover the journey to unleash your inner artist and unlock the beautiful, stunning, magical art of photography in our amazing beginner-friendly courses. Imagine the incredible images you could create.';

test('detectFluffyOpener flags the rhetorical Coventry opener', () => {
  const result = detectFluffyOpener(FIXTURE_BODY_TEXT);
  assert.equal(result.audit_status, 'ok');
  assert.equal(result.isFluffy, true, 'Coventry-style opener must be flagged as fluffy.');
  assert.ok(result.signals.length >= 2, 'opener should trip at least 2 fluffy signals.');
});

test('detectUnsourcedStats catches the "30% of UK adults" claim', () => {
  const stats = detectUnsourcedStats(FIXTURE_HTML);
  const real = stats.filter(s => !s._audit_status);
  assert.ok(real.length >= 1, 'should detect at least 1 unsourced stat.');
  assert.ok(real.some(s => /30\s?%/.test(s.snippet)), 'should detect "30%" statistical claim.');
});

test('detectWeakOutboundCitations flags allbachelordegrees.com', () => {
  const weak = detectWeakOutboundCitations(FIXTURE_HTML);
  const real = weak.filter(w => !w._audit_status);
  assert.ok(real.length >= 1, 'should detect at least 1 weak outbound citation.');
  assert.ok(real.some(w => w.domain.includes('allbachelordegrees')), 'should flag allbachelordegrees.com specifically.');
});

test('detectDuplicateClaims catches the repeated "30% of UK adults" claim', () => {
  const dups = detectDuplicateClaims(FIXTURE_HTML);
  const real = dups.filter(d => !d._audit_status);
  assert.ok(real.length >= 1, 'should detect at least 1 duplicate claim.');
});

test('scanLiabilities aggregates >=2 REMEDIATE-worthy issues on Coventry fixture', () => {
  const result = scanLiabilities(FIXTURE_HTML);
  assert.equal(result.audit_status, 'ok');
  const remediateIssues = result.unsourced_stats.length
    + result.weak_citations.length
    + result.duplicate_claims.length;
  assert.ok(
    remediateIssues >= 2,
    `Coventry fixture must yield >=2 REMEDIATE-worthy issues; got ${remediateIssues}`
  );
  assert.equal(result.fluffy.isFluffy, true, 'Coventry fixture must trigger REWRITE opener task.');
});

test('detectors FAIL LOUD on empty input — never silently return neutral', () => {
  const fluffy = detectFluffyOpener('');
  assert.equal(fluffy.audit_status, 'incomplete', 'fluffy detector must mark audit_status=incomplete on empty input.');
  assert.equal(fluffy.audit_reason, 'no_body_text');

  const stats = detectUnsourcedStats('');
  assert.ok(stats[0] && stats[0]._audit_status === 'incomplete', 'unsourced-stats detector must surface incomplete marker.');

  const weak = detectWeakOutboundCitations('');
  assert.ok(weak[0] && weak[0]._audit_status === 'incomplete', 'weak-citations detector must surface incomplete marker.');

  const agg = scanLiabilities('');
  assert.equal(agg.audit_status, 'incomplete');
  assert.ok(agg.audit_reasons.length >= 1, 'aggregate must list >=1 audit_reasons.');
});
