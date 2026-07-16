/**
 * Weekly cron: collect competitor reviews + on-page for gated competitors only.
 * Gate: is_competitor=true (must also pass local_pack + 2+ money kw when ranking data available).
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { COMPETITOR_ANALYSIS_BASELINE } from '../../lib/competitor-analysis/constants.js';
import {
  censusConsistentRivals,
  filterDfsGatedTargets,
} from '../../lib/competitor-analysis/rivals.js';
import { fetchReviewsForDomain, upsertReviewRow } from '../../lib/competitor-analysis/collect-reviews.js';
import { collectOnpageForUrl, upsertOnpageRow } from '../../lib/competitor-analysis/collect-onpage.js';

const MAX_REVIEWS = 5;
const MAX_ONPAGE = 4;
const PAUSE_MS = 900;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function authorise(req) {
  if (req.method === 'GET' && String(req.headers['x-vercel-cron'] || '') === '1') return true;
  const secret = process.env.CRON_SECRET;
  return secret && (req.headers['x-cron-secret'] === secret || req.query?.secret === secret);
}

function loadLockedKeywords() {
  const paths = [
    join(ROOT, 'keyword-tracking-class-LOCKED.json'),
    join(ROOT, 'lib/keyword-ranking/keyword-tracking-class-LOCKED.json'),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    return Object.keys(JSON.parse(readFileSync(p, 'utf8')).by_keyword || {});
  }
  return [];
}

async function loadLatestRankingRows(supabase, propertyUrl, keywords) {
  const { data: dates } = await supabase
    .from('keyword_rankings')
    .select('audit_date')
    .eq('property_url', propertyUrl)
    .order('audit_date', { ascending: false })
    .limit(1);
  const auditDate = dates?.[0]?.audit_date;
  if (!auditDate || !keywords.length) return [];
  const { data } = await supabase
    .from('keyword_rankings')
    .select('keyword, keyword_class, serp_surface_stack')
    .eq('property_url', propertyUrl)
    .eq('audit_date', auditDate)
    .in('keyword', keywords);
  return data || [];
}

async function rivalsNeedingData(supabase) {
  const keywords = loadLockedKeywords();
  const propertyUrl = process.env.CRON_PROPERTY_URL || 'https://www.alanranger.com';
  const rows = await loadLatestRankingRows(supabase, propertyUrl, keywords);
  const consistent = censusConsistentRivals(rows, 'alanranger.com', 2);

  const { data: flagged } = await supabase
    .from('domain_strength_domains')
    .select('domain, is_competitor, domain_type, domain_type_source')
    .eq('is_competitor', true);
  const meta = {};
  for (const row of flagged || []) {
    meta[row.domain] = {
      is_competitor: true,
      domain_type: row.domain_type,
      domain_type_source: row.domain_type_source,
    };
  }

  const gated = filterDfsGatedTargets(consistent, meta).map((r) => r.domain);
  const onpageDomains = consistent
    .filter((r) => meta[r.domain]?.is_competitor)
    .map((r) => r.domain);

  if (!gated.length && !onpageDomains.length) {
    return { reviewTargets: [], onpageTargets: [] };
  }

  const baseline = COMPETITOR_ANALYSIS_BASELINE.baseline_name;
  const { data: revRows } = await supabase
    .from('competitor_local_reviews')
    .select('domain')
    .eq('baseline_name', baseline)
    .in('domain', gated.length ? gated : ['__none__']);
  const haveRev = new Set((revRows || []).map((r) => r.domain));

  const { data: pageRows } = await supabase
    .from('competitor_onpage_snapshots')
    .select('domain')
    .eq('baseline_name', baseline)
    .in('domain', onpageDomains.length ? onpageDomains : ['__none__']);
  const havePage = new Set((pageRows || []).map((r) => r.domain));

  return {
    reviewTargets: gated.filter((d) => !haveRev.has(d)).slice(0, MAX_REVIEWS),
    onpageTargets: onpageDomains.filter((d) => !havePage.has(d)).slice(0, MAX_ONPAGE).map((d) => ({
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
    gate: 'is_competitor=true AND local_pack AND 2+ money kw',
    ...out,
    meta: { generatedAt: new Date().toISOString() },
  });
}
