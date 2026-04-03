import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGscSiteUrlCandidates,
  isGscInspectQuotaExceeded,
  resolveGscSiteUrlForInspect,
} from '../api/aigeo/lib/gscInspectSiteUrls.js';

test('buildGscSiteUrlCandidates: property URL first, sc-domain later', () => {
  const out = buildGscSiteUrlCandidates(
    'https://www.alanranger.com/',
    'https://www.alanranger.com/about-alan-ranger'
  );
  assert.equal(out[0], 'https://www.alanranger.com/');
  assert.ok(out.includes('sc-domain:alanranger.com'));
});

test('isGscInspectQuotaExceeded: detects 429/resource exhausted shapes', () => {
  assert.equal(
    isGscInspectQuotaExceeded({ error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }),
    true
  );
  assert.equal(isGscInspectQuotaExceeded({ error: { code: 403, status: 'PERMISSION_DENIED' } }), false);
});

test('resolveGscSiteUrlForInspect: retries after quota and succeeds on next candidate', async () => {
  const calls = [];
  const inspectOne = async (_token, siteUrl, inspectionUrl) => {
    calls.push({ siteUrl, inspectionUrl });
    if (siteUrl.startsWith('https://www.')) {
      return {
        inspectionUrl,
        httpOk: true,
        verdict: 'PASS',
        coverageState: 'Submitted and indexed',
      };
    }
    return {
      inspectionUrl,
      httpOk: false,
      error: { code: 429, message: 'Quota exceeded for sc-domain:alanranger.com.', status: 'RESOURCE_EXHAUSTED' },
    };
  };

  const r = await resolveGscSiteUrlForInspect(
    'token',
    inspectOne,
    'sc-domain:alanranger.com',
    'https://www.alanranger.com/about-alan-ranger',
    0
  );

  assert.equal(r.siteUrl, 'https://www.alanranger.com/');
  assert.equal(String(r.row?.coverageState || ''), 'Submitted and indexed');
  assert.ok(calls.length >= 2);
});
