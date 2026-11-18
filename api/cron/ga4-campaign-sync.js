/** Nightly ChatGPT-ad GA4 pull. GET cron, POST from the dashboard refresh. */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { collectGa4Campaigns } from '../../lib/acquisition/ga4-campaign-collect.js';
import { isRequestAuthorized } from '../../lib/acquisition/sync-runs.js';

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (!isRequestAuthorized(req)) return send(res, 401, { ok: false, error: 'unauthorized' });
  try {
    const result = await collectGa4Campaigns({ days: 90, persist: true });
    return send(res, 200, { ok: true, job: 'ga4_campaign', ...result });
  } catch (err) {
    return send(res, 500, { ok: false, error: err?.message || String(err) });
  }
}
