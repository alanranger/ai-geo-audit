import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLinkHttpStatus,
  evaluatePageBrokenLinks,
  isBrokenHttpStatus,
  probeUrlHttpStatus
} from '../lib/traditional-seo-broken-links.js';

test('isBrokenHttpStatus only 404/410', () => {
  assert.equal(isBrokenHttpStatus(404), true);
  assert.equal(isBrokenHttpStatus(410), true);
  assert.equal(isBrokenHttpStatus(200), false);
  assert.equal(isBrokenHttpStatus(500), false);
});

test('classifyLinkHttpStatus', () => {
  assert.equal(classifyLinkHttpStatus(200), 'ok');
  assert.equal(classifyLinkHttpStatus(301), 'ok');
  assert.equal(classifyLinkHttpStatus(404), 'broken');
  assert.equal(classifyLinkHttpStatus(500), 'unknown');
  assert.equal(classifyLinkHttpStatus(null, 'timeout'), 'unknown');
});

test('evaluatePageBrokenLinks fail on 404', () => {
  const status = {
    'https://www.alanranger.com/ok': { kind: 'ok' },
    'https://www.alanranger.com/missing': { kind: 'broken' }
  };
  const out = evaluatePageBrokenLinks(
    ['https://www.alanranger.com/ok', 'https://www.alanranger.com/missing'],
    (url) => status[url]
  );
  assert.equal(out.status, 'fail');
  assert.equal(out.brokenUrls.length, 1);
  assert.match(out.note, /404\/410/);
});

test('evaluatePageBrokenLinks pass and warn', () => {
  const pass = evaluatePageBrokenLinks(
    ['https://www.alanranger.com/a'],
    () => ({ kind: 'ok' })
  );
  assert.equal(pass.status, 'pass');

  const empty = evaluatePageBrokenLinks([], () => ({ kind: 'ok' }));
  assert.equal(empty.status, 'pass');

  const warn = evaluatePageBrokenLinks(
    ['https://www.alanranger.com/x'],
    () => ({ kind: 'unknown' })
  );
  assert.equal(warn.status, 'warn');
});

test('probeUrlHttpStatus uses HEAD then GET on 405', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(opts.method);
    if (opts.method === 'HEAD') return { status: 405 };
    return { status: 404 };
  };
  const out = await probeUrlHttpStatus('https://example.com/gone', fetchImpl, 2000);
  assert.deepEqual(calls, ['HEAD', 'GET']);
  assert.equal(out.kind, 'broken');
  assert.equal(out.statusCode, 404);
});
