import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePath, resolvePolicy, isPolicyActive } from '../lib/page-indexability-policy.js';

const SEED = [
  {
    url_or_prefix: '/photographic-workshops-near-me',
    match_type: 'prefix',
    policy: 'intentional_noindex',
    redirect_target: null,
    effective_date: null,
    note: 'prefix seed'
  },
  {
    url_or_prefix: '/one-day-landscape-photography-workshops',
    match_type: 'exact',
    policy: 'retired_redirect',
    redirect_target: '/landscape-photography-workshops',
    effective_date: null,
    note: 'exact seed'
  }
];

test('normalizePath strips host, query, trailing slash; keeps leading slash', () => {
  assert.equal(
    normalizePath('https://www.alanranger.com/one-day-landscape-photography-workshops/?query=1'),
    '/one-day-landscape-photography-workshops'
  );
});

test('resolvePolicy precedence and null cases', () => {
  const case1 = resolvePolicy('https://www.alanranger.com/photographic-workshops-near-me/some-event-2025-09', SEED);
  assert.equal(case1?.policy, 'intentional_noindex');

  const case2 = resolvePolicy('https://www.alanranger.com/one-day-landscape-photography-workshops', SEED);
  assert.equal(case2?.policy, 'retired_redirect');
  assert.equal(case2?.redirect_target, '/landscape-photography-workshops');

  assert.equal(resolvePolicy('https://www.alanranger.com/landscape-photography-workshops', SEED), null);

  const case5 = resolvePolicy('https://www.alanranger.com/PHOTOGRAPHIC-WORKSHOPS-NEAR-ME/event', SEED);
  assert.equal(case5?.policy, 'intentional_noindex');
});

test('isPolicyActive is false when effective_date is null', () => {
  const row = resolvePolicy('https://www.alanranger.com/photographic-workshops-near-me/x', SEED);
  assert.equal(isPolicyActive(row, '2026-05-29'), false);
});
