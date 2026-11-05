import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isExcludedUrl, loadExclusionPrefixes, prefixesFrom, resetExclusionCache, withoutExcludedUrls } from '../lib/shared-url-exclusions.js';

const SHARED_FILE = new URL('../../alan-shared-resources/config/url-exclusions.json', import.meta.url);
const config = JSON.parse(readFileSync(SHARED_FILE, 'utf8'));
const fakeFetch = async () => ({ ok: true, json: async () => config });
const SITE = 'https://www.alanranger.com';

beforeEach(() => resetExclusionCache());

test('reads the shared rule: every form of a guest blog URL is excluded; the main blog is not', async () => {
  const prefixes = await loadExclusionPrefixes({ fetchFn: fakeFetch });
  assert.deepEqual(prefixes, prefixesFrom(config));
  for (const u of [`${SITE}/guest-blog-posts`, `${SITE}/guest-blog-posts/`, `${SITE}/guest-blog-posts/any-post`, `${SITE}/guest-blog-posts?format=json`]) {
    assert.equal(isExcludedUrl(u, prefixes), true, u);
  }
  assert.equal(isExcludedUrl(`${SITE}/blog-on-photography/a-post`, prefixes), false);
});

test('a site URL list loses guest pages and keeps its count otherwise', async () => {
  const list = [`${SITE}/`, `${SITE}/guest-blog-posts/x`, `${SITE}/blog-on-photography/a`];
  assert.deepEqual(await withoutExcludedUrls(list, undefined, { fetchFn: fakeFetch }), [`${SITE}/`, `${SITE}/blog-on-photography/a`]);
});

test('GSC page rows are filtered by their page key', async () => {
  const rows = [{ keys: [`${SITE}/guest-blog-posts/x`] }, { keys: [`${SITE}/a`] }];
  const out = await withoutExcludedUrls(rows, (r) => r.keys[0], { fetchFn: fakeFetch });
  assert.deepEqual(out.map((r) => r.keys[0]), [`${SITE}/a`]);
});

test('if the shared file cannot be read, nothing is dropped', async () => {
  const failing = async () => { throw new Error('offline'); };
  const list = [`${SITE}/a`];
  assert.deepEqual(await withoutExcludedUrls(list, undefined, { fetchFn: failing }), list);
});
