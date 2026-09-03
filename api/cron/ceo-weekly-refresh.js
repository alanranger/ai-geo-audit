export const config = { runtime: 'nodejs', maxDuration: 300 };

import { authoriseCron, sendJson, londonWeekStartYmd } from '../../lib/ceo-weekly/shared.js';
import { runCeoWeeklyRefresh } from '../../lib/ceo-weekly/refresh.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (!['GET', 'POST'].includes(req.method)) return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!authoriseCron(req)) return sendJson(res, 401, { error: 'unauthorized' });

  try {
    const weekStart = String(req.query?.weekStart || '').trim() || londonWeekStartYmd();
    const result = await runCeoWeeklyRefresh({ weekStart });
    return sendJson(res, result.criticalFail ? 500 : 200, {
      status: result.run?.status || 'ok',
      weekStart: result.weekStart,
      runId: result.run?.id,
      failed: result.failed,
      criticalFail: result.criticalFail,
      steps: result.run?.steps
    });
  } catch (err) {
    return sendJson(res, 500, { error: 'ceo_weekly_refresh_failed', message: err?.message || String(err) });
  }
}
