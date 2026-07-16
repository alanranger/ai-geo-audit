/**
 * POST /api/competitor-analysis/enqueue-snapshot
 * Body: { domain } — queue domain strength snapshot (reuse pending queue).
 */
import { enqueuePending } from '../../lib/domainStrength/domains.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Use POST' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const domain = String(body?.domain || '').trim();
  if (!domain) {
    return res.status(400).json({ status: 'error', message: 'domain required' });
  }

  const n = await enqueuePending([domain], { engine: 'google', source: 'competitor-analysis-tab' });
  return res.status(200).json({
    status: 'ok',
    domain,
    enqueued: n > 0,
    meta: { generatedAt: new Date().toISOString(), hint: 'Run Domain Strength snapshot from Authority tab' },
  });
}
