/**
 * Monday: force GSC & Backlink Audit (same core as Dashboard Full / Standard audit_scan).
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { authoriseCron, sendJson, DEFAULT_PROPERTY } from '../../lib/ceo-weekly/shared.js';

function baseUrl(req) {
  return (
    process.env.CEO_WEEKLY_BASE_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
    || (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`)
    || (req.headers?.host && `https://${req.headers.host}`)
    || 'https://ai-geo-audit.vercel.app'
  ).replace(/\/$/, '');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (!['GET', 'POST'].includes(req.method)) return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!authoriseCron(req)) return sendJson(res, 401, { error: 'unauthorized' });

  const propertyUrl = String(req.query?.propertyUrl || DEFAULT_PROPERTY).trim();
  const secret = process.env.CRON_SECRET;
  const headers = secret ? { 'x-cron-secret': secret } : {};
  const url = `${baseUrl(req)}/api/cron/daily-gsc-backlink?force=1&propertyUrl=${encodeURIComponent(propertyUrl)}`;
  try {
    const r = await fetch(url, { method: 'GET', headers });
    const body = await r.json().catch(() => ({}));
    return sendJson(res, r.ok ? 200 : 500, { ok: r.ok, step: 'gsc_backlink_audit', ...body });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err?.message || String(err) });
  }
}
