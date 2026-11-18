/**
 * Manual ChatGPT / LLM visibility collect (no cron).
 * Used by Full refresh + Ranking & AI scan progress steps.
 * GET/POST ?dryRun=1 — load prompt bank only (no DFS spend).
 */
export const config = {
  runtime: 'nodejs',
  maxDuration: 300,
  // Ensure LOCKED CSV is traced into this lambda (NFT often misses dynamic path reads).
  includeFiles: ['config/keyword-tracking-locations-and-class-LOCKED-v*.csv'],
};

import { loadFlaggedPromptBank } from '../../lib/llm-visibility/collect-core.js';
import { tickLlmVisibility } from '../../lib/llm-visibility/run-tick.js';

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
};

function wantsDryRun(req) {
  const q = req.query?.dryRun ?? req.query?.dry_run;
  if (q === '1' || q === 'true') return true;
  const b = req.body;
  if (b && typeof b === 'object' && (b.dryRun === true || b.dryRun === 1 || b.dry_run === true)) return true;
  return false;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST' && req.method !== 'GET') {
    return send(res, 405, { error: 'method_not_allowed' });
  }

  const started = Date.now();
  try {
    if (wantsDryRun(req)) {
      const bank = await loadFlaggedPromptBank();
      return send(res, 200, {
        ok: true,
        dry_run: true,
        source: bank.source,
        prompts_total: bank.prompts.length,
        prompts: bank.prompts.map((p) => p.keyword),
        meta: bank.meta || null,
        duration_ms: Date.now() - started,
      });
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const tick = await tickLlmVisibility({ force: body.force === true, budgetMs: 240000 });
    return send(res, 200, { ...tick, duration_ms: Date.now() - started });
  } catch (err) {
    return send(res, 500, {
      ok: false,
      error: String(err?.message || err),
      duration_ms: Date.now() - started,
    });
  }
}
