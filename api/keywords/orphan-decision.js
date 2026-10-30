/**
 * POST /api/keywords/orphan-decision
 * Body: { keyword, action: 'keep'|'drop' }
 */
import { decideTrackedKeywordOrphan } from '../../lib/keyword-ranking/sync-tracked-page-keywords.mjs';

export const config = { runtime: 'nodejs', maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'POST only' });
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const out = await decideTrackedKeywordOrphan({
      keyword: body?.keyword,
      action: body?.action,
      propertyUrl: body?.propertyUrl || 'https://www.alanranger.com',
    });
    return res.status(200).json({ status: 'ok', ...out });
  } catch (e) {
    return res.status(400).json({ status: 'error', message: e.message || String(e) });
  }
}
