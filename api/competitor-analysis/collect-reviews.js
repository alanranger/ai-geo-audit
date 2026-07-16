/**
 * POST /api/competitor-analysis/collect-reviews
 * Body: { domains: [{ domain, keyword? }], max?: number }
 */
import { fetchReviewsForDomain, upsertReviewRow } from '../../lib/competitor-analysis/collect-reviews.js';

export const config = { runtime: 'nodejs', maxDuration: 120 };

const PAUSE_MS = 800;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Use POST' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ status: 'error', message: 'Supabase not configured' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const list = Array.isArray(body?.domains) ? body.domains : [];
  const max = Math.min(Number(body?.max) || 8, 15);
  const results = [];

  for (let i = 0; i < Math.min(list.length, max); i += 1) {
    const item = list[i];
    const domain = String(item?.domain || item || '').trim();
    const keyword = item?.keyword || null;
    if (!domain) continue;
    try {
      const row = await fetchReviewsForDomain(domain, keyword);
      if (row.collected) await upsertReviewRow(supabaseUrl, supabaseKey, row);
      results.push(row);
    } catch (e) {
      results.push({ domain, collected: false, reason: e.message });
    }
    if (i < list.length - 1) await sleep(PAUSE_MS);
  }

  return res.status(200).json({
    status: 'ok',
    processed: results.length,
    results,
    meta: { generatedAt: new Date().toISOString(), cost_note: '~$0.0125 per DFS SERP call' },
  });
}
