import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLinkHttpStatus,
  collectBrokenLinkProbeTargets,
  evaluatePageBrokenLinks,
  isBrokenHttpStatus,
  probeUrlHttpStatus
} from '../lib/traditional-seo-broken-links.js';

test('collectBrokenLinkProbeTargets scopes to one page only', () => {
  const many = Array.from({ length: 600 }, (_, i) => `https://www.alanranger.com/other-${i}`);
  const rows = [
    {
      url: 'https://www.alanranger.com/photography-services-near-me/2hr-private-photography-classes-2hr',
      seoInternalLinkTargets: [
        'https://www.alanranger.com/a',
        'https://www.alanranger.com/b',
        'https://alanranger.com/c'
      ]
    },
    {
      url: 'https://www.alanranger.com/blog-on-photography/tripods-gitzo-vs-benro-review',
      seoInternalLinkTargets: many
    }
  ];
  const scoped = collectBrokenLinkProbeTargets(rows, [
    'https://alanranger.com/photography-services-near-me/2hr-private-photography-classes-2hr'
  ]);
  assert.equal(scoped.length, 3);
  assert.ok(scoped.length < 20);
  const all = collectBrokenLinkProbeTargets(rows, []);
  assert.ok(all.length >= 600);
});

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

test('evaluatePageBrokenLinks pass when some links unconfirmed', () => {
  const status = {
    'https://www.alanranger.com/ok': { kind: 'ok' },
    'https://www.alanranger.com/slow': { kind: 'unknown' }
  };
  const out = evaluatePageBrokenLinks(
    ['https://www.alanranger.com/ok', 'https://www.alanranger.com/slow'],
    (url) => status[url]
  );
  assert.equal(out.status, 'pass');
  assert.equal(out.unknownCount, 1);
  assert.match(out.note, /unconfirmed/);
});

test('evaluatePageBrokenLinks warn only when every link unconfirmed', () => {
  const out = evaluatePageBrokenLinks(
    ['https://www.alanranger.com/a', 'https://www.alanranger.com/b'],
    () => ({ kind: 'unknown' })
  );
  assert.equal(out.status, 'warn');
});

test('evaluatePageBrokenLinks pass and warn', () => {
  const pass = evaluatePageBrokenLinks(
    ['https://www.alanranger.com/a'],
    () => ({ kind: 'ok' })
  );
  assert.equal(pass.status, 'pass');

  const empty = evaluatePageBrokenLinks([], () => ({ kind: 'ok' }));
  assert.equal(empty.status, 'pass');
});

test('probeUrlHttpStatus trusts HEAD 404 without GET', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(opts.method);
    return { status: 404 };
  };
  const out = await probeUrlHttpStatus('https://example.com/gone', fetchImpl, 2000);
  assert.deepEqual(calls, ['HEAD']);
  assert.equal(out.kind, 'broken');
  assert.equal(out.statusCode, 404);
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
