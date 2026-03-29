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
