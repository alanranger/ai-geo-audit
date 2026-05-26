// Live-page regression fixture for /photography-courses-coventry.
//
// 2026-05-26: the synthetic fixture in aio-page-liability-fixture.test.js
// PASSED the detectors while the LIVE Coventry page produced ZERO
// REMEDIATE tasks. Root cause was three deployment-only bugs that the
// synthetic fixture didn't surface:
//
//   1. Squarespace doesn't use <nav> tags for its main menu, so
//      bodyText was dominated by "Cart 0 Sign In My Account..." cruft
//      and the fluffy-opener detector judged the wrong text.
//   2. <main> sat ~123KB into the raw HTML and the body snippet
//      capped at 60KB — the allbachelordegrees.com citation at offset
//      136KB inside <main> was never reached by the link detector.
//   3. NUMERIC_CLAIM_RE's 120-char distance limit was too tight for
//      the real "With 30% of UK adults now actively pursuing
//      photography as a hobby..." sentence (142 chars).
//
// To prevent regressions THIS test loads the actual saved HTML the
// live page returned (test/fixtures/photography-courses-coventry.html,
// 381KB) and asserts the detectors fire on it the same way they fire
// in production.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanLiabilities } from '../lib/revenue-funnel-page-liability.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'photography-courses-coventry.html');

function loadLiveHtml() {
  if (!fs.existsSync(FIXTURE_PATH)) {
    throw new Error('Missing test fixture: ' + FIXTURE_PATH);
  }
  return fs.readFileSync(FIXTURE_PATH, 'utf8');
}

test('live Coventry HTML: scanLiabilities fires on real Squarespace markup', () => {
  const html = loadLiveHtml();
  const result = scanLiabilities(html);
  assert.equal(result.audit_status, 'ok');
  const remediate = result.unsourced_stats.length
    + result.weak_citations.length
    + result.duplicate_claims.length;
  assert.ok(
    remediate >= 2,
    `live Coventry page must yield >=2 REMEDIATE-worthy issues; got ${remediate}`
  );
});

test('live Coventry HTML: detects "30% of UK adults" duplicate claim', () => {
  const html = loadLiveHtml();
  const result = scanLiabilities(html);
  assert.ok(
    result.duplicate_claims.some(d => /30\s?%/.test(d.snippet) && d.count >= 2),
    'must detect the "30% of UK adults" repeated claim with count >= 2.'
  );
});

test('live Coventry HTML: flags allbachelordegrees.com as weak citation', () => {
  const html = loadLiveHtml();
  const result = scanLiabilities(html);
  assert.ok(
    result.weak_citations.some(w => w.domain.includes('allbachelordegrees')),
    'must flag allbachelordegrees.com — proves the body-HTML snippet '
    + 'cap is wide enough to reach the citation at ~136KB inside <main>.'
  );
});

test('live Coventry HTML: opener is judged fluffy (rhetorical + aspirational)', () => {
  const html = loadLiveHtml();
  const result = scanLiabilities(html);
  assert.equal(
    result.fluffy.isFluffy,
    true,
    'opener must be judged fluffy — proves the bodyText extractor '
    + 'is scoping to <main> and the rhetorical opener check covers '
    + '>=250 chars (the live page emits H1+tagline before the ? mark).'
  );
  assert.ok(
    result.fluffy.signals.includes('rhetorical_question_open'),
    'fluffy signals must include rhetorical_question_open.'
  );
});
