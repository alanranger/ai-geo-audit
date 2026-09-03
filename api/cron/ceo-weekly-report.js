export const config = { runtime: 'nodejs', maxDuration: 120 };

import { authoriseCron, sendJson, londonWeekStartYmd } from '../../lib/ceo-weekly/shared.js';
import { runCeoWeeklyReport } from '../../lib/ceo-weekly/report.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (!['GET', 'POST'].includes(req.method)) return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!authoriseCron(req)) return sendJson(res, 401, { error: 'unauthorized' });

  try {
    const weekStart = String(req.query?.weekStart || '').trim() || londonWeekStartYmd();
    const dryRun = String(req.query?.dryRun || '').toLowerCase() === 'true'
      || req.body?.dryRun === true;
    const forceFailSafe = String(req.query?.forceFailSafe || '').toLowerCase() === 'true';
    const skipGate = String(req.query?.skipGate || '').toLowerCase() === 'true';
    const result = await runCeoWeeklyReport({
      weekStart,
      dryRun,
      forceFailSafe,
      skipGate,
      failReason: req.query?.failReason || undefined
    });
    return sendJson(res, 200, result);
  } catch (err) {
    return sendJson(res, 500, { error: 'ceo_weekly_report_failed', message: err?.message || String(err) });
  }
}
