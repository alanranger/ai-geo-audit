/**
 * Ad-hoc LLM visibility collect (Bearer CRON_SECRET or the dashboard admin key).
 * Weekly vercel.json schedule REMOVED — use Full refresh / Ranking & AI /
 * POST /api/aigeo/llm-visibility-collect instead.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { collectLlmVisibilitySnapshot } from '../../lib/llm-visibility/collect-core.js';
import { cronOrAdmin } from '../../lib/api/cronAuth.js';

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).send(JSON.stringify(body));
};

const authorise = (req) => !!cronOrAdmin(req);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  if (!authorise(req)) return send(res, 401, { error: 'unauthorized' });

  const started = Date.now();
  try {
    const result = await collectLlmVisibilitySnapshot({ cadence: 'manual', persist: true });
    return send(res, 200, {
      ok: true,
      id: result.id,
      run_at: result.run_at,
      cost_usd: result.snapshot.cost_usd,
      named: result.snapshot.meta.named_of_prompts,
      duration_ms: Date.now() - started,
    });
  } catch (err) {
    return send(res, 500, { ok: false, error: String(err?.message || err), duration_ms: Date.now() - started });
  }
}
