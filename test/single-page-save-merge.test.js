import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeEvaluationRows, normalizeEvaluationRows } from '../api/aigeo/traditional-seo-evaluation-cache.js';
import { mergePayloadRowsByUrl } from '../api/aigeo/impl-snapshots.js';

const A = 'https://www.alanranger.com/blog-on-photography/student-photo-essay';
const B = 'https://www.alanranger.com/photography-courses-coventry';

test('evaluation save merges one page: other pages and site-wide rows untouched', () => {
  const stored = [
    { url: A, rule_key: 'h1', status: 'fail', tier: 'blog' },
    { url: A, rule_key: 'k1', status: 'warn', tier: 'blog' },
    { url: B, rule_key: 'h1', status: 'pass', tier: 'landing' },
    { url: 'https://www.alanranger.com', rule_key: 'robots', status: 'pass', tier: 'sitewide' },
  ];
  const fresh = [
    { url: A, rule_key: 'h1', status: 'pass', tier: 'blog' },
    { url: A, rule_key: 'k1', status: 'pass', tier: 'blog' },
  ];
  const merged = mergeEvaluationRows(stored, [A], fresh);
  assert.equal(merged.length, 4);
  assert.deepEqual(merged.filter((r) => r.url === A).map((r) => r.status), ['pass', 'pass']);
  assert.equal(merged.find((r) => r.url === B).status, 'pass');
  assert.ok(merged.some((r) => r.tier === 'sitewide'));
});

test('evaluation merge replaces the www copy when the re-audit saves the bare-host form', () => {
  const bare = A.replace('www.', '');
  const stored = [
    { url: A, rule_key: 'h1', status: 'fail', tier: 'blog' },
    { url: `${bare}/`, rule_key: 'h1', status: 'fail', tier: 'blog' },
    { url: B, rule_key: 'h1', status: 'pass', tier: 'landing' },
  ];
  const merged = mergeEvaluationRows(stored, [bare], [{ url: bare, rule_key: 'h1', status: 'pass', tier: 'blog' }]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((r) => r.url), [B, bare]);
});

test('every save keeps one row per page+rule (www/bare, slash, /home) — newest wins, www form', () => {
  const PROP = 'https://alanranger.com/';
  const bare = A.replace('www.', '');
  const rows = [
    { url: A, rule_key: 'h1', status: 'fail', tier: 'blog' },
    { url: 'https://www.alanranger.com/', rule_key: 'robots', status: 'pass', tier: 'sitewide' },
    { url: 'https://www.alanranger.com/', rule_key: 'h1', status: 'fail', tier: 'landing' },
    { url: 'https://alanranger.com/home', rule_key: 'h1', status: 'warn', tier: 'landing' },
    { url: `${bare}/`, rule_key: 'h1', status: 'pass', tier: 'blog' },
    { url: 'https://other.example/x', rule_key: 'h1', status: 'pass', tier: 'blog' },
  ];
  const out = normalizeEvaluationRows(rows, PROP);
  assert.deepEqual(out.map((r) => `${r.url}|${r.rule_key}|${r.status}`), [
    'https://www.alanranger.com/|robots|pass',
    'https://www.alanranger.com/|h1|warn',
    `${A}|h1|pass`,
    'https://other.example/x|h1|pass',
  ]);
});

test('evaluation merge refuses when nothing is stored (caller sends a full save)', () => {
  assert.equal(mergeEvaluationRows([], [A], [{ url: A }]), null);
});

test('page-content save replaces only that page (URL match ignores www / trailing slash)', () => {
  const stored = {
    status: 'ok',
    data: { rows: [{ url: `${A}/`, title: 'old' }, { url: B, title: 'keep' }], pagesChecked: 2 },
    meta: { generatedAt: '2026-10-19T00:00:00Z' },
  };
  const merged = mergePayloadRowsByUrl(stored, { data: { rows: [{ url: A.replace('www.', ''), title: 'new' }] } });
  assert.deepEqual(merged.data.rows.map((r) => r.title), ['new', 'keep']);
  assert.equal(merged.data.pagesChecked, 2);
  assert.ok(merged.meta.lastRowMergeAt);
});

test('page-content merge adds a page that was not stored yet', () => {
  const stored = { status: 'ok', data: { rows: [{ url: B, title: 'keep' }] } };
  const merged = mergePayloadRowsByUrl(stored, { data: { rows: [{ url: A, title: 'new page' }] } });
  assert.deepEqual(merged.data.rows.map((r) => r.title), ['keep', 'new page']);
});
