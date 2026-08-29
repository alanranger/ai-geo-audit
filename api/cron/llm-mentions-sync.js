/**
 * Nightly DataForSEO llm_mentions pull for the Acquisition tab's AI channels.
 * Covers chat_gpt + google only — the two platforms this API supports.
 *
 * GET  with x-vercel-cron / ?secret=  — scheduled run
 * POST                                — dashboard audit button / full refresh
 * ?dryRun=true                        — fetch and report without writing
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { collectLlmMentions } from '../../lib/acquisition/llm-mentions.js';
import { detectTriggerSource, isRequestAuthorized, startRun, finishRun } from '../../lib/acquisition/sync-runs.js';

const JOB = 'llm_mentions';

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (!isRequestAuthorized(req)) return send(res, 401, { ok: false, error: 'unauthorized' });

  const dryRun = String(req.query?.dryRun || '') === 'true';
  const triggerSource = detectTriggerSource(req);
  const runId = dryRun ? null : await startRun(JOB, triggerSource);

  try {
    const result = await collectLlmMentions({ persist: !dryRun });
    await finishRun(runId, {
      status: 'ok',
      rows_written: result.rows_written,
      cost_usd: result.cost_usd,
      meta: { platforms: result.platforms.map((p) => ({ platform: p.platform, ok: p.ok, message: p.message })) },
    });
    return send(res, 200, { ok: true, job: JOB, dry_run: dryRun, ...result });
  } catch (err) {
    const message = err?.message || String(err);
    await finishRun(runId, { status: 'error', error_message: message });
    return send(res, 500, { ok: false, job: JOB, error: message });
  }
}
