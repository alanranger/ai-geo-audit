import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  policyPeriodStatus,
  applyPolicyVisibilityLossRowGuard
} from '../lib/page-indexability-policy.js';

const EFFECTIVE = '2025-09-15';
const SLUG = 'photographic-workshops-near-me/event-1';

function row(periodStart, visibilityLoss = true) {
  return {
    page_slug: SLUG,
    period_start: periodStart,
    policy_effective_date: EFFECTIVE,
    visibility_loss: visibilityLoss
  };
}

test('synthetic activation guard — 6 monthly rows', () => {
  const cases = [
    { period_start: '2025-06-01', status: 'pre', visibility_loss: true, reason: null },
    { period_start: '2025-07-01', status: 'pre', visibility_loss: true, reason: null },
    { period_start: '2025-08-01', status: 'pre', visibility_loss: true, reason: null },
    { period_start: '2025-09-01', status: 'straddle', visibility_loss: false, reason: 'policy_transition_month' },
    { period_start: '2025-10-01', status: 'post', visibility_loss: false, reason: 'expected_zero_per_policy' },
    { period_start: '2025-11-01', status: 'post', visibility_loss: false, reason: 'expected_zero_per_policy' }
  ];

  for (const c of cases) {
    const input = row(c.period_start, true);
    assert.equal(policyPeriodStatus(c.period_start, EFFECTIVE), c.status, c.period_start);
    const out = applyPolicyVisibilityLossRowGuard(input);
    assert.equal(out.visibility_loss, c.visibility_loss, `${c.period_start} visibility_loss`);
    assert.equal(out.policy_suppression_reason, c.reason, `${c.period_start} reason`);
    console.log(`PASS  ${c.period_start}  status=${c.status}  visibility_loss=${out.visibility_loss}  reason=${out.policy_suppression_reason ?? 'null'}`);
  }
});
