import test from 'node:test';
import assert from 'node:assert/strict';
import { batchEstimateUsd, dfsApprovalGate, estimateSerpBatchUsd, unscheduledContext } from '../lib/keyword-ranking/dfs-approval-gate.js';

test('the batch estimate is cumulative across requests (20 keywords max each) or the declared plan', () => {
  assert.equal(batchEstimateUsd({ keywordCount: 20, aiOverview: true }), 0.5, 'one request alone stays under $1');
  assert.equal(batchEstimateUsd({ keywordCount: 20, aiOverview: true, priorSpendUsd: 0.6 }), 1.1, 'third request of a re-run crosses $1');
  assert.equal(batchEstimateUsd({ keywordCount: 20, aiOverview: true, plannedKeywords: 94 }), 2.35, 'a declared 94-keyword plan is judged up front');
});

test('estimate: 94 keywords with AI Overview ≈ $2.35; 5 keywords ≈ $0.13', () => {
  assert.equal(estimateSerpBatchUsd(94, { aiOverview: true }), 2.35);
  assert.equal(estimateSerpBatchUsd(5, { aiOverview: true }), 0.125);
  assert.equal(estimateSerpBatchUsd(5), 0.04);
});

test('scheduled / dashboard calls on production are not gated; previews and marked tests/re-runs are', () => {
  assert.equal(unscheduledContext({ vercelEnv: 'production' }), null);
  assert.equal(unscheduledContext({ vercelEnv: 'preview' }), 'preview');
  assert.equal(unscheduledContext({ vercelEnv: 'production', header: 'rerun' }), 'rerun');
  assert.equal(dfsApprovalGate({ estimateUsd: 2.35, context: null }).ok, true);
});

test('over $1 without a Claude QUESTION approval is refused; with one it runs; under $1 always runs', () => {
  const no = dfsApprovalGate({ estimateUsd: 2.35, context: 'rerun' });
  assert.equal(no.ok, false);
  assert.match(no.reason, /QUESTION/);
  assert.equal(dfsApprovalGate({ estimateUsd: 2.35, context: 'rerun', approval: 'QUESTION-2026-11-09-ranking-rerun.md' }).ok, true);
  assert.equal(dfsApprovalGate({ estimateUsd: 2.35, context: 'rerun', approval: 'yes please' }).ok, false);
  assert.equal(dfsApprovalGate({ estimateUsd: 0.13, context: 'preview' }).ok, true);
});
