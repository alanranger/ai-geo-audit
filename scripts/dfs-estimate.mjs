#!/usr/bin/env node
/**
 * State the DataForSEO cost of a non-scheduled batch BEFORE running it (Alan, 2 Nov 2026).
 * Over $1 needs approval via a Claude QUESTION file; then pass that file's name as dfs_approval.
 *   node scripts/dfs-estimate.mjs --keywords=94 --aio [--context=rerun]
 * Exit 0 = may run now; 2 = needs approval first.
 */
import { APPROVAL_LIMIT_USD, estimateSerpBatchUsd } from '../lib/keyword-ranking/dfs-approval-gate.js';

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').split('=')[1] || d;
const keywords = Number(arg('keywords', 0));
const aiOverview = process.argv.includes('--aio');
const context = arg('context', 'test');
const est = estimateSerpBatchUsd(keywords, { aiOverview });
const needs = est > APPROVAL_LIMIT_USD;
console.log(`${context} batch: ${keywords} keyword(s), AI Overview ${aiOverview ? 'on' : 'off'} → estimated $${est.toFixed(2)} (first look; confirmations extra, capped by the run limits).`);
console.log(needs ? `Over $${APPROVAL_LIMIT_USD}: ask for approval in a Claude QUESTION file before running.` : `Within $${APPROVAL_LIMIT_USD}: may run; state this estimate in the response.`);
process.exitCode = needs ? 2 : 0;
