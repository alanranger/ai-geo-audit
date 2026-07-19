/**
 * GET /api/aigeo/pages-master-tier-lookup
 * Dashboard / TradSEO tier column SoT (pages_master).
 */
import { fetchPagesMasterEntries } from '../../lib/pagesMaster.js';

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }
  try {
    const propertyUrl = String(req.query?.propertyUrl || 'https://www.alanranger.com').trim();
    const entries = await fetchPagesMasterEntries({ propertyUrl });
    const lookup = {};
    for (const row of entries) {
      if (row.path) lookup[row.path] = row.tier;
    }
    sendJson(res, 200, {
      ok: true,
      source: 'pages_master',
      count: entries.length,
      lookup,
      entries: entries.map((e) => ({ url: e.url, tier: e.tier }))
    });
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
