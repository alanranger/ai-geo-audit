/**
 * GET/POST — generate 09-url-target-keywords.csv from DB overrides + LOCKED-v12.
 * Used to clear config-integrity check 6 (STALE EXPORT) after locked-set culls.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { buildIntegrityContext } from '../../lib/configIntegrity/runIntegrityCheck.mjs';
import { buildCsv09Body, loadLocked } from '../../lib/configIntegrity/checks.mjs';

const send = (res, status, body, headers = {}) => {
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(body);
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, 'ok');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return send(res, 405, JSON.stringify({ status: 'error', message: 'GET or POST' }), {
      'Content-Type': 'application/json',
    });
  }
  try {
    const propertyUrl = String(
      req.query?.propertyUrl || req.body?.propertyUrl || 'https://www.alanranger.com'
    ).trim();
    const ctx = await buildIntegrityContext({ propertyUrl });
    const lockedByKw = loadLocked();
    const csv = buildCsv09Body(ctx.overrides || [], lockedByKw);
    const asJson = String(req.query?.format || '') === 'json';
    if (asJson) {
      return send(res, 200, JSON.stringify({
        status: 'ok',
        rows: (ctx.overrides || []).length,
        lockedCount: lockedByKw.size,
        csv,
      }), { 'Content-Type': 'application/json; charset=utf-8' });
    }
    return send(res, 200, csv, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="09-url-target-keywords.csv"',
    });
  } catch (err) {
    return send(res, 500, JSON.stringify({
      status: 'error',
      message: err.message || String(err),
    }), { 'Content-Type': 'application/json' });
  }
}
