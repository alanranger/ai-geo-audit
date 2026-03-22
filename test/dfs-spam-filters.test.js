import test from 'node:test';
import assert from 'node:assert/strict';
import { dfsSpamUrlFilters, DFS_SPAM_FILTERS_VERSION } from '../lib/dfs-spam-filters.js';
import { rowHashForBacklink } from '../lib/dfs-domain-backlink-ingest.js';

test('dfsSpamUrlFilters has four not_like clauses and version', () => {
  const f = dfsSpamUrlFilters();
  const likes = f.filter((x) => Array.isArray(x) && x[1] === 'not_like');
  assert.equal(likes.length, 4);
  assert.equal(DFS_SPAM_FILTERS_VERSION, 'v1');
});

test('rowHashForBacklink is stable', () => {
  const a = rowHashForBacklink('ex.com', 'https://a/x', 'https://ex.com/p', 't');
  const b = rowHashForBacklink('ex.com', 'https://a/x', 'https://ex.com/p', 't');
  assert.equal(a, b);
  assert.notEqual(a, rowHashForBacklink('ex.com', 'https://a/x', 'https://ex.com/p', 't2'));
});
