import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveGscUrlIndexedStatus } from '../api/aigeo/lib/gscInspectAuditStatus.js';

const page = 'https://alanranger.com/example';

test('deriveGscUrlIndexedStatus: URL unknown to Google => fail (matches dashboard rule)', () => {
  assert.equal(
    deriveGscUrlIndexedStatus(page, {
      httpOk: true,
      coverageState: 'URL is unknown to Google',
      verdict: 'NEUTRAL',
      pageFetchState: 'PAGE_FETCH_STATE_UNSPECIFIED',
    }),
    'fail'
  );
});

test('deriveGscUrlIndexedStatus: submitted and indexed => pass', () => {
  assert.equal(
    deriveGscUrlIndexedStatus(page, {
      httpOk: true,
      coverageState: 'Submitted and indexed',
      verdict: 'PASS',
    }),
    'pass'
  );
});

test('deriveGscUrlIndexedStatus: indexed but not submitted phrase (sitemap variant) => pass', () => {
  assert.equal(
    deriveGscUrlIndexedStatus(page, {
      httpOk: true,
      coverageState: 'Indexed, not submitted in sitemap',
      verdict: 'NEUTRAL',
    }),
    'pass'
  );
});

test('deriveGscUrlIndexedStatus: no payload => fail', () => {
  assert.equal(deriveGscUrlIndexedStatus(page, null), 'fail');
});

test('deriveGscUrlIndexedStatus: API http not ok => fail', () => {
  assert.equal(
    deriveGscUrlIndexedStatus(page, { httpOk: false, coverageState: null }),
    'fail'
  );
});

test('deriveGscUrlIndexedStatus: crawled not indexed => fail', () => {
  assert.equal(
    deriveGscUrlIndexedStatus(page, {
      httpOk: true,
      coverageState: 'Crawled - currently not indexed',
    }),
    'fail'
  );
});

test('deriveGscUrlIndexedStatus: Page with redirect (GSC canonical state) => pass', () => {
  assert.equal(
    deriveGscUrlIndexedStatus(page, {
      httpOk: true,
      coverageState: 'Page with redirect',
      verdict: 'NEUTRAL',
      pageFetchState: 'SUCCESSFUL',
      googleCanonical: 'https://www.alanranger.com/photography-courses-coventry',
    }),
    'pass'
  );
});

test('deriveGscUrlIndexedStatus: redirect error style => fail when not page-with-redirect', () => {
  assert.equal(
    deriveGscUrlIndexedStatus(page, {
      httpOk: true,
      coverageState: 'Redirect error',
      verdict: 'FAIL',
    }),
    'fail'
  );
});

test('deriveGscUrlIndexedStatus: empty api error object is ignored', () => {
  assert.equal(
    deriveGscUrlIndexedStatus(page, {
      httpOk: true,
      apiError: {},
      coverageState: 'Submitted and indexed',
    }),
    'pass'
  );
});

test('deriveGscUrlIndexedStatus: BLOCKED_BY_META_TAG => pass (intentional noindex)', () => {
  assert.equal(
    deriveGscUrlIndexedStatus(page, {
      httpOk: true,
      indexingState: 'BLOCKED_BY_META_TAG',
      verdict: 'NEUTRAL',
    }),
    'pass'
  );
});

test('deriveGscUrlIndexedStatus: httpStatus 200 without httpOk boolean => pass', () => {
  assert.equal(
    deriveGscUrlIndexedStatus(page, {
      httpStatus: 200,
      coverageState: 'Submitted and indexed',
    }),
    'pass'
  );
});
