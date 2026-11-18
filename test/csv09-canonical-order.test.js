import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCsv09Body, checkStaleExport, csvHash } from '../lib/configIntegrity/checks.mjs';

const locked = new Map([['alpha', { class: 'A' }]]);
const newestFirst = [
  { page_url: 'https://www.alanranger.com/b', target_keyword: 'beta', target_class: '', notes: '' },
  { page_url: 'https://www.alanranger.com/a', target_keyword: 'alpha', target_class: 'tracked', notes: '' }
];

test('auto-save order and the check hash the same file', () => {
  const saved = buildCsv09Body(newestFirst, locked);
  const checked = buildCsv09Body([...newestFirst].reverse(), locked);
  assert.equal(csvHash(saved), csvHash(checked));
  assert.ok(saved.indexOf('/a,') < saved.indexOf('/b,'));
  assert.equal(checkStaleExport(newestFirst, locked, saved).length, 0);
});

test('a real keyword change still fails the stale-export check', () => {
  const saved = buildCsv09Body(newestFirst, locked);
  const changed = newestFirst.map((r) => (r.page_url.endsWith('/a') ? { ...r, target_keyword: 'other' } : r));
  const findings = checkStaleExport(changed, locked, saved);
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /STALE EXPORT/);
});
