/**
 * Weekly cron: collect competitor reviews + on-page for top rivals missing data.
 * Schedule: Sunday 06:30 UTC (add to vercel.json).
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { createClient } from '@supabase/supabase-js';
import { COMPETITOR_ANALYSIS_BASELINE } from '../../lib/competitor-analysis/constants.js';
import { fetchReviewsForDomain, upsertReviewRow } from '../../lib/competitor-analysis/collect-reviews.js';
import { collectOnpageForUrl, upsertOnpageRow } from '../../lib/competitor-analysis/collect-onpage.js';

const MAX_REVIEWS = 5;
const MAX_ONPAGE = 4;
const PAUSE_MS = 900;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function authorise(req) {
  if (req.method === 'GET' && String(req.headers['x-vercel-cron'] || '') === '1') return true;
  const secret = process.env.CRON_SECRET;
  return secret && (req.headers['x-cron-secret'] === secret || req.query?.secret === secret);
}

async function rivalsNeedingData(supabase) {
  const { data: flagged } = await supabase
    .from('domain_strength_domains')
    .select('domain')
    .eq('is_competitor', true)
    .limit(20);
  const domains = (flagged || []).map((r) => r.domain).filter(Boolean);
  if (!domains.length) return { reviewTargets: [], onpageTargets: [] };

  const baseline = COMPETITOR_ANALYSIS_BASELINE.baseline_name;
  const { data: revRows } = await supabase
    .from('competitor_local_reviews')
    .select('domain')
    .eq('baseline_name', baseline)
    .in('domain', domains);
  const haveRev = new Set((revRows || []).map((r) => r.domain));

  const { data: pageRows } = await supabase
    .from('competitor_onpage_snapshots')
    .select('domain')
    .eq('baseline_name', baseline)
    .in('domain', domains);
  const havePage = new Set((pageRows || []).map((r) => r.domain));

  return {
    reviewTargets: domains.filter((d) => !haveRev.has(d)).slice(0, MAX_REVIEWS),
    onpageTargets: domains.filter((d) => !havePage.has(d)).slice(0, MAX_ONPAGE).map((d) => ({
      domain: d,
      url: `https://www.${d}/`,
    })),
  };
}

export default async function handler(req, res) {
  if (!authorise(req)) {
    return res.status(401).json({ status: 'error', message: 'unauthorised' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return res.status(500).json({ status: 'error', message: 'Supabase not configured' });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { reviewTargets, onpageTargets } = await rivalsNeedingData(supabase);
  const out = { reviews: [], onpage: [] };

  for (const domain of reviewTargets) {
    try {
      const row = await fetchReviewsForDomain(domain, null);
      if (row.collected) await upsertReviewRow(url, key, row);
      out.reviews.push(row);
    } catch (e) {
      out.reviews.push({ domain, collected: false, reason: e.message });
    }
    await sleep(PAUSE_MS);
  }

  for (const item of onpageTargets) {
    try {
      const row = await collectOnpageForUrl(item.domain, item.url, null);
      if (row.collected) await upsertOnpageRow(url, key, row);
      out.onpage.push(row);
    } catch (e) {
      out.onpage.push({ domain: item.domain, collected: false, reason: e.message });
    }
    await sleep(PAUSE_MS);
  }

  return res.status(200).json({
    status: 'ok',
    baseline: COMPETITOR_ANALYSIS_BASELINE,
    ...out,
    meta: { generatedAt: new Date().toISOString() },
  });
}
