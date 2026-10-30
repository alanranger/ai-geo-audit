/**
 * GET — CSV download (debug). POST — write config/09-url-target-keywords.csv
 * to GitHub and re-run integrity so Traditional SEO system health clears.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { buildIntegrityContext, runIntegrityCheck } from '../../lib/configIntegrity/runIntegrityCheck.mjs';
import { buildCsv09Body, loadLocked } from '../../lib/configIntegrity/checks.mjs';
import { commitCsv09 } from '../../lib/commit-09-csv.mjs';

const send = (res, status, body, headers = {}) => {
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(body);
};

async function buildCsv(propertyUrl) {
  const ctx = await buildIntegrityContext({ propertyUrl });
  const lockedByKw = loadLocked();
  const csv = buildCsv09Body(ctx.overrides || [], lockedByKw);
  return { csv, rows: (ctx.overrides || []).length, lockedCount: lockedByKw.size };
}

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
    const wantCommit = req.method === 'POST'
      || String(req.query?.commit || req.body?.commit || '') === '1';
    const { csv, rows, lockedCount } = await buildCsv(propertyUrl);
    if (wantCommit) {
      const gh = await commitCsv09(csv, 'chore(seo): save 09-url-target-keywords.csv from Traditional SEO');
      await runIntegrityCheck({
        persist: true,
        csv09Disk: csv,
        runSource: 'export-09-commit'
      });
      return send(res, 200, JSON.stringify({
        status: 'ok',
        message: 'Saved and committed — 09 is now in sync',
        rows,
        lockedCount,
        unchanged: Boolean(gh.unchanged),
        commit: gh.commit || null,
        html_url: gh.html_url || null
      }), { 'Content-Type': 'application/json; charset=utf-8' });
    }
    if (String(req.query?.format || '') === 'json') {
      return send(res, 200, JSON.stringify({ status: 'ok', rows, lockedCount, csv }), {
        'Content-Type': 'application/json; charset=utf-8',
      });
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
