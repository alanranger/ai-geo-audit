/**
 * Repair Surface / Top dials on audit_results from keyword_rankings (dashboard truth).
 * POST /api/aigeo/repair-ranking-dials?auditDate=YYYY-MM-DD
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { authoriseCron, sendJson, DEFAULT_PROPERTY } from '../../lib/ceo-weekly/shared.js';
import { upsertRankingDialScores } from '../../lib/keyword-ranking/ranking-dial-scores.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (!['GET', 'POST'].includes(req.method)) return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!authoriseCron(req)) return sendJson(res, 401, { error: 'unauthorized' });

  try {
    const propertyUrl = String(req.query?.propertyUrl || req.body?.propertyUrl || DEFAULT_PROPERTY).trim();
    const auditDate = String(
      req.query?.auditDate || req.body?.auditDate || new Date().toISOString().slice(0, 10)
    ).slice(0, 10);
    const scored = await upsertRankingDialScores({ propertyUrl, auditDate });
    return sendJson(res, 200, {
      ok: true,
      propertyUrl,
      auditDate,
      surface_visibility_score: scored.surface,
      top_of_page_score: scored.top,
      measured_rows: scored.measured
    });
  } catch (err) {
    return sendJson(res, 500, {
      ok: false,
      error: 'repair_ranking_dials_failed',
      message: err?.message || String(err)
    });
  }
}
