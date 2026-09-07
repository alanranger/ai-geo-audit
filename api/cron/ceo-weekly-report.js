export const config = { runtime: 'nodejs', maxDuration: 120 };

import { authoriseCron, sendJson, londonWeekStartYmd } from '../../lib/ceo-weekly/shared.js';
import { runCeoWeeklyReport } from '../../lib/ceo-weekly/report.js';

function flag(req, name) {
  const q = req.query?.[name];
  const b = req.body?.[name];
  return String(q ?? b ?? '').toLowerCase() === 'true' || b === true;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (!['GET', 'POST'].includes(req.method)) return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!authoriseCron(req)) return sendJson(res, 401, { error: 'unauthorized' });

  try {
    const weekStart = String(req.query?.weekStart || req.body?.weekStart || '').trim() || londonWeekStartYmd();
    const result = await runCeoWeeklyReport({
      weekStart,
      dryRun: flag(req, 'dryRun'),
      forceFailSafe: flag(req, 'forceFailSafe'),
      // Full Refresh (manual or Monday) — skip gate; always re-send so every Full produces an email
      skipGate: flag(req, 'skipGate') || flag(req, 'fromFullRefresh'),
      forceResend: flag(req, 'forceResend') || flag(req, 'fromFullRefresh'),
      failReason: req.query?.failReason || req.body?.failReason || undefined,
      refreshLog: req.body?.refreshLog || null
    });
    return sendJson(res, 200, result);
  } catch (err) {
    return sendJson(res, 500, { error: 'ceo_weekly_report_failed', message: err?.message || String(err) });
  }
}
