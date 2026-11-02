/**
 * DataForSEO spending guard for testing and re-runs (Alan, 2 Nov 2026):
 * any non-scheduled call batch (tests, previews, re-runs) states its estimated cost first, and anything over
 * $1 needs approval via a Claude QUESTION file. Scheduled runs (Monday cron) and Alan's own dashboard button
 * are not affected: they send no x-dfs-context header and run on production.
 */
import { estimateDfsCallCost, getDfsSpendLimits } from './dfs-spend-limits.js';

export const APPROVAL_LIMIT_USD = 1;
const CONTEXTS = new Set(['test', 'preview', 'rerun']);
const APPROVAL_RE = /^QUESTION-\d{4}-\d{2}-\d{2}-[\w.-]+$/;

/** First look per keyword; confirmations come on top, capped by the run limits. */
export function estimateSerpBatchUsd(keywordCount, { aiOverview = false } = {}, limits = getDfsSpendLimits()) {
  return Math.round(keywordCount * estimateDfsCallCost(limits, { expandAiOverview: aiOverview }) * 1000) / 1000;
}

/**
 * A batch spans several requests (serp-rank-test takes at most 20 keywords each), so the estimate is the whole batch:
 * spend so far in this logical run (spend_state) + this request, or the declared plan (dfs_batch_keywords) if larger.
 */
export function batchEstimateUsd({ keywordCount, aiOverview = false, priorSpendUsd = 0, plannedKeywords = 0 }) {
  const sofar = (Number(priorSpendUsd) || 0) + estimateSerpBatchUsd(keywordCount, { aiOverview });
  const planned = Number(plannedKeywords) > 0 ? estimateSerpBatchUsd(Number(plannedKeywords), { aiOverview }) : 0;
  return Math.round(Math.max(sofar, planned) * 1000) / 1000;
}

/** 'test' | 'preview' | 'rerun' for non-scheduled calls; null for scheduled / dashboard calls on production. */
export function unscheduledContext({ vercelEnv, header } = {}) {
  const h = String(header || '').trim().toLowerCase();
  if (CONTEXTS.has(h)) return h;
  return vercelEnv === 'preview' ? 'preview' : null;
}

export function dfsApprovalGate({ estimateUsd, context, approval, limitUsd = APPROVAL_LIMIT_USD }) {
  const base = { context, estimate_usd: estimateUsd, limit_usd: limitUsd };
  if (!context || estimateUsd <= limitUsd) return { ok: true, ...base };
  const name = String(approval || '').trim().replace(/\.md$/i, '');
  if (APPROVAL_RE.test(name)) return { ok: true, ...base, approval: name };
  return { ok: false, ...base,
    reason: `Estimated $${estimateUsd.toFixed(2)} for a ${context} batch is over $${limitUsd}: needs approval in a Claude QUESTION file (send dfs_approval: "QUESTION-…").` };
}
