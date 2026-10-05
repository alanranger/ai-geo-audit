/**
 * Monday Full Refresh step + manual probe:
 * optional Academy Memberstack cache refresh, then Academy weekly metrics.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { authoriseCron, sendJson } from '../../lib/ceo-weekly/shared.js';
import { refreshAcademyMemberCache, buildAcademyWeeklyMetrics } from '../../lib/ceo-weekly/academy.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (!['GET', 'POST'].includes(req.method)) return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!authoriseCron(req)) return sendJson(res, 401, { error: 'unauthorized' });

  try {
    const refreshCache = String(req.query?.refreshCache || req.body?.refreshCache || 'true').toLowerCase() !== 'false';
    let refresh = null;
    if (refreshCache) {
      refresh = await refreshAcademyMemberCache();
    }
    const metrics = await buildAcademyWeeklyMetrics();
    return sendJson(res, 200, {
      ok: true,
      refresh,
      academy: metrics
    });
  } catch (err) {
    return sendJson(res, 500, {
      ok: false,
      error: 'academy_weekly_refresh_failed',
      message: err?.message || String(err)
    });
  }
}
