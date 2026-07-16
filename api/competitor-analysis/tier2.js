/**
 * GET /api/competitor-analysis/tier2?domains=a.com,b.com
 * Returns stored competitor reviews + on-page snapshots for baseline v1.
 */
import { COMPETITOR_ANALYSIS_BASELINE } from '../../lib/competitor-analysis/constants.js';

function parseDomains(raw) {
  return String(raw || '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^www\./, ''))
    .filter(Boolean);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ status: 'error', message: 'Use GET' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ status: 'error', message: 'Supabase not configured' });
  }

  const domains = parseDomains(req.query.domains);
  const baseline = COMPETITOR_ANALYSIS_BASELINE.baseline_name;
  const headers = {
    'Content-Type': 'application/json',
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };

  let reviews = [];
  let onpage = [];
  const inFilter = domains.length
    ? `&domain=in.(${domains.map((d) => `"${d}"`).join(',')})`
    : '';

  const revUrl = `${supabaseUrl}/rest/v1/competitor_local_reviews?baseline_name=eq.${baseline}${inFilter}&select=*`;
  const revResp = await fetch(revUrl, { headers });
  if (revResp.ok) reviews = await revResp.json();

  const pageUrl = `${supabaseUrl}/rest/v1/competitor_onpage_snapshots?baseline_name=eq.${baseline}${inFilter}&select=*&order=collected_at.desc`;
  const pageResp = await fetch(pageUrl, { headers });
  if (pageResp.ok) onpage = await pageResp.json();

  return res.status(200).json({
    status: 'ok',
    baseline: COMPETITOR_ANALYSIS_BASELINE,
    reviews: Array.isArray(reviews) ? reviews : [],
    onpage: Array.isArray(onpage) ? onpage : [],
    meta: { generatedAt: new Date().toISOString() },
  });
}
