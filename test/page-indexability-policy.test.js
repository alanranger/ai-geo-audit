import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePath,
  resolvePolicy,
  isPolicyActive,
  policyPeriodStatus,
  isRowIndexable
} from '../lib/page-indexability-policy.js';

const SEED = [
  {
    url_or_prefix: '/beginners-photography-lessons',
    match_type: 'prefix',
    policy: 'intentional_noindex',
    redirect_target: null,
    effective_date: '2026-06-01',
    note: 'beginners prefix seed'
  },
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
  const beginners = resolvePolicy(
    'https://www.alanranger.com/beginners-photography-lessons/camera-courses-for-beginners-coventry-oct1',
    SEED
  );
  assert.equal(beginners?.policy, 'intentional_noindex');
  assert.equal(beginners?.url_or_prefix, '/beginners-photography-lessons');

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

test('policyPeriodStatus — 15 locked cases', () => {
  assert.equal(policyPeriodStatus('2025-09-01', null), 'inactive');
  assert.equal(policyPeriodStatus('2025-09-01', undefined), 'inactive');
  assert.equal(policyPeriodStatus('2025-09-01', ''), 'inactive');
  assert.equal(policyPeriodStatus('2025-09-01', '2025-12-01'), 'pre');
  assert.equal(policyPeriodStatus('2025-09-01', '2025-10-01'), 'pre');
  assert.equal(policyPeriodStatus('2025-09-01', '2025-09-30'), 'straddle');
  assert.equal(policyPeriodStatus('2025-09-01', '2025-09-15'), 'straddle');
  assert.equal(policyPeriodStatus('2025-09-01', '2025-09-01'), 'post');
  assert.equal(policyPeriodStatus('2025-09-01', '2025-08-15'), 'post');
  assert.equal(policyPeriodStatus('2025-09-01', '2024-01-01'), 'post');
  assert.equal(policyPeriodStatus('2025-12-01', '2026-01-01'), 'pre');
  assert.equal(policyPeriodStatus('2025-12-01', '2025-12-15'), 'straddle');
  assert.equal(policyPeriodStatus('2025-12-01', '2026-01-15'), 'pre');
  assert.throws(() => policyPeriodStatus('2025-13-01', '2025-09-01'));
  assert.throws(() => policyPeriodStatus('', '2025-09-01'));
});

test('isRowIndexable — 11 locked cases', () => {
  assert.equal(isRowIndexable({ policy_value: null, period_start: '2025-09-01', policy_effective_date: null }), true);
  assert.equal(isRowIndexable({ policy_value: null, period_start: '2025-09-01', policy_effective_date: '2025-09-01' }), true);
  assert.equal(isRowIndexable({ policy_value: 'indexed', period_start: '2025-09-01', policy_effective_date: '2025-08-01' }), true);
  assert.equal(isRowIndexable({ policy_value: 'other', period_start: '2025-09-01', policy_effective_date: null }), false);
  assert.equal(isRowIndexable({ policy_value: 'intentional_noindex', period_start: '2025-09-01', policy_effective_date: null }), true);
  assert.equal(isRowIndexable({ policy_value: 'intentional_noindex', period_start: '2025-06-01', policy_effective_date: '2025-09-15' }), true);
  assert.equal(isRowIndexable({ policy_value: 'intentional_noindex', period_start: '2025-09-01', policy_effective_date: '2025-09-15' }), false);
  assert.equal(isRowIndexable({ policy_value: 'intentional_noindex', period_start: '2025-10-01', policy_effective_date: '2025-09-15' }), false);
  assert.equal(isRowIndexable({ policy_value: 'retired_redirect', period_start: '2025-10-01', policy_effective_date: '2025-09-15' }), false);
  assert.equal(isRowIndexable({ policy_value: 'retired_redirect', period_start: '2025-06-01', policy_effective_date: '2025-09-15' }), true);
  assert.equal(isRowIndexable(null), true);
});
