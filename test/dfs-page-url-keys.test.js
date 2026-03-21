import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDfsPageUrl,
  dfsPageUrlWwwLiteralForQuery,
  expandUrlListForBacklinkCacheQuery,
  indexDfsCacheRowsByCanonical
} from '../lib/dfs-page-url-keys.js';

test('normalizeDfsPageUrl strips www, trailing slashes, lowercases host', () => {
  assert.equal(
    normalizeDfsPageUrl('https://WWW.AlanRanger.com/foo//'),
    'https://alanranger.com/foo'
  );
  assert.equal(normalizeDfsPageUrl('https://alanranger.com'), 'https://alanranger.com/');
});

test('dfsPageUrlWwwLiteralForQuery adds www host for bare domain', () => {
  const c = normalizeDfsPageUrl('https://alanranger.com/path/here');
  const w = dfsPageUrlWwwLiteralForQuery(c);
  assert.match(w, /^https:\/\/www\.alanranger\.com\/path\/here$/);
});

test('expandUrlListForBacklinkCacheQuery includes canonical and www literal', () => {
  const c = normalizeDfsPageUrl('https://www.alanranger.com/x');
  const list = expandUrlListForBacklinkCacheQuery([c]);
  assert.ok(list.includes('https://alanranger.com/x'));
  assert.ok(list.some((u) => u.includes('www.')));
});

test('indexDfsCacheRowsByCanonical prefers row with more backlink_rows', () => {
  const rows = [
    { page_url: 'https://www.alanranger.com/a', backlink_rows: [], fetched_at: '2020-01-01T00:00:00.000Z' },
    {
      page_url: 'https://alanranger.com/a',
      backlink_rows: [{ source_url: 'https://ex.com' }],
      fetched_at: '2019-01-01T00:00:00.000Z'
    }
  ];
  const m = indexDfsCacheRowsByCanonical(rows);
  assert.equal(m.get('https://alanranger.com/a').backlink_rows.length, 1);
});
