import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSlugAliasMap,
  resolveCanonicalSlug,
  DEFAULT_SLUG_ALIAS_MAP,
  STATIC_SLUG_ALIASES
} from '../lib/canonical-slug.js';
import { isRetiredMoneyPath } from '../lib/retired-money-pages.mjs';
import { resolveNavHubSlug } from '../lib/revenue-stream-gsc-roles.js';

test('static aliases include the one-day landscape merge', () => {
  assert.equal(
    STATIC_SLUG_ALIASES['one-day-landscape-photography-workshops'],
    'landscape-photography-workshops'
  );
});

test('buildSlugAliasMap normalises and seeds from static aliases', () => {
  const map = buildSlugAliasMap(null);
  assert.equal(map.get('one-day-landscape-photography-workshops'), 'landscape-photography-workshops');
});

test('buildSlugAliasMap reads exact retired_redirect policy rows', () => {
  const rows = [
    { policy: 'retired_redirect', match_type: 'exact', url_or_prefix: '/old-page', redirect_target: '/new-page' },
    { policy: 'intentional_noindex', match_type: 'exact', url_or_prefix: '/noindex', redirect_target: null },
    { policy: 'retired_redirect', match_type: 'prefix', url_or_prefix: '/skip-prefix', redirect_target: '/x' }
  ];
  const map = buildSlugAliasMap(rows, {});
  assert.equal(map.get('old-page'), 'new-page');
  assert.equal(map.has('noindex'), false);
  assert.equal(map.has('skip-prefix'), false, 'prefix rows excluded from hot-path map');
});

test('buildSlugAliasMap ignores self-referential and empty aliases', () => {
  const map = buildSlugAliasMap(
    [{ policy: 'retired_redirect', match_type: 'exact', url_or_prefix: '/same', redirect_target: '/same' }],
    {}
  );
  assert.equal(map.size, 0);
});

test('resolveCanonicalSlug remaps retired slug, passes through others', () => {
  assert.equal(resolveCanonicalSlug('/one-day-landscape-photography-workshops'), 'landscape-photography-workshops');
  assert.equal(resolveCanonicalSlug('one-day-landscape-photography-workshops'), 'landscape-photography-workshops');
  assert.equal(resolveCanonicalSlug('/landscape-photography-workshops'), 'landscape-photography-workshops');
  assert.equal(resolveCanonicalSlug('some-other-page'), 'some-other-page');
});

test('resolveCanonicalSlug follows chains without infinite loop', () => {
  const map = new Map([['a', 'b'], ['b', 'c'], ['c', 'a']]);
  // cycle a->b->c->a: stops once a slug repeats
  assert.ok(['a', 'b', 'c'].includes(resolveCanonicalSlug('a', map)));
});

test('DEFAULT_SLUG_ALIAS_MAP is prebuilt from static aliases', () => {
  assert.equal(DEFAULT_SLUG_ALIAS_MAP.get('one-day-landscape-photography-workshops'), 'landscape-photography-workshops');
});

test('resolveNavHubSlug remaps the retired one-day workshops hub', () => {
  assert.equal(
    resolveNavHubSlug('/one-day-landscape-photography-workshops'),
    'landscape-photography-workshops'
  );
  assert.equal(resolveNavHubSlug('landscape-photography-workshops'), 'landscape-photography-workshops');
  assert.equal(resolveNavHubSlug(''), null);
});

test('isRetiredMoneyPath flags the retired one-day workshops URL', () => {
  assert.equal(isRetiredMoneyPath('/one-day-landscape-photography-workshops'), true);
  assert.equal(isRetiredMoneyPath('https://www.alanranger.com/one-day-landscape-photography-workshops'), true);
  assert.equal(isRetiredMoneyPath('/one-day-landscape-photography-workshops/'), true);
  assert.equal(isRetiredMoneyPath('/landscape-photography-workshops'), false);
});
