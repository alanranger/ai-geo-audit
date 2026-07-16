/**
 * Tier-2 backfill: DFS-gated reviews + on-page for confirmed competitors only.
 *
 * Reviews gate (DFS credits): is_competitor=true AND local_pack presence AND 2+ money kw.
 * On-page (live DOM, no credits): is_competitor=true ranking pages only.
 *
 * Usage:
 *   node scripts/competitor-tier2-backfill.mjs              # gated count + cost estimate
 *   node scripts/competitor-tier2-backfill.mjs --run-reviews  # after Alan approves cost
 *   node scripts/competitor-tier2-backfill.mjs --run-onpage
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  censusConsistentRivals,
  filterDfsGatedTargets,
} from '../lib/competitor-analysis/rivals.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'alanranger.com';
const REVIEW_COST = 0.0125;
const PAUSE_MS = 900;

for (const envFile of ['.env.local', '.env']) {
  const p = join(ROOT, envFile);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadLockedKeywordConfig() {
  const paths = [
    join(ROOT, 'keyword-tracking-class-LOCKED.json'),
    join(ROOT, 'lib/keyword-ranking/keyword-tracking-class-LOCKED.json'),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    const by = parsed.by_keyword || {};
    return Object.entries(by).map(([keyword, cfg]) => ({
      keyword,
      keyword_class: cfg.keyword_class || 'national-money',
    }));
  }
  throw new Error('Could not load locked keyword config');
}

async function loadRankingRows(sb, propertyUrl, auditDate, kwConfig) {
  const kws = kwConfig.map((k) => k.keyword);
  const { data, error } = await sb
    .from('keyword_rankings')
    .select('keyword, keyword_class, serp_surface_stack')
    .eq('property_url', propertyUrl)
    .eq('audit_date', auditDate)
    .in('keyword', kws);
  if (error) throw error;
  const classByKw = new Map(kwConfig.map((k) => [k.keyword.toLowerCase(), k.keyword_class]));
  return (data || []).map((r) => ({
    ...r,
    keyword_class: r.keyword_class || classByKw.get(String(r.keyword).toLowerCase()) || 'national-money',
  }));
}

async function fetchMeta(sb, domains) {
  const out = {};
  for (let i = 0; i < domains.length; i += 80) {
    const slice = domains.slice(i, i + 80);
    const { data } = await sb
      .from('domain_strength_domains')
      .select('domain, is_competitor, domain_type, domain_type_source')
      .in('domain', slice);
    for (const row of data || []) {
      out[row.domain] = {
        is_competitor: row.is_competitor === true,
        domain_type: row.domain_type,
        domain_type_source: row.domain_type_source,
      };
    }
  }
  return out;
}

async function main() {
  const runAll = process.argv.includes('--run');
  const runOnpage = runAll || process.argv.includes('--run-onpage');
  const runReviews = runAll || process.argv.includes('--run-reviews');

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');

  const propertyUrl = process.env.CRON_PROPERTY_URL || 'https://www.alanranger.com';
  const auditDate = process.argv.find((a) => a.startsWith('--audit-date='))?.slice(13) || '2026-07-14';

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const kwConfig = loadLockedKeywordConfig();
  const keywords = kwConfig.map((k) => k.keyword);
  const rows = await loadRankingRows(sb, propertyUrl, auditDate, kwConfig);
  const consistent = censusConsistentRivals(rows, SELF, 2);
  const meta = await fetchMeta(sb, consistent.map((r) => r.domain));

  const reviewTargets = filterDfsGatedTargets(consistent, meta);
  const onpageTargets = consistent
    .filter((r) => meta[r.domain]?.is_competitor === true)
    .map((r) => r.domain);

  const reviewDomains = reviewTargets.map((r) => r.domain);
  const { data: revExisting } = await sb
    .from('competitor_local_reviews')
    .select('domain')
    .eq('baseline_name', 'competitor-analysis-v1')
    .in('domain', reviewDomains.length ? reviewDomains : ['__none__']);
  const { data: pageExisting } = await sb
    .from('competitor_onpage_snapshots')
    .select('domain')
    .eq('baseline_name', 'competitor-analysis-v1')
    .in('domain', onpageTargets.length ? onpageTargets : ['__none__']);

  const haveRev = new Set((revExisting || []).map((r) => r.domain));
  const havePage = new Set((pageExisting || []).map((r) => r.domain));
  const needRev = reviewDomains.filter((d) => !haveRev.has(d));
  const needPage = onpageTargets.filter((d) => !havePage.has(d));

  const report = {
    auditDate,
    lockedKeywords: keywords.length,
    consistentRivals: consistent.length,
    dfsGate: 'is_competitor=true AND local_pack AND 2+ money kw',
    reviewTargetCount: reviewDomains.length,
    reviewTargets: reviewDomains,
    onpageTargetCount: onpageTargets.length,
    onpageTargets,
    needReviews: needRev.length,
    needOnpage: needPage.length,
    estimatedReviewCostUsd: Number((needRev.length * REVIEW_COST).toFixed(4)),
    excludedSample: consistent
      .filter((r) => !reviewDomains.includes(r.domain))
      .slice(0, 15)
      .map((r) => ({ domain: r.domain, reason: meta[r.domain]?.is_competitor ? 'no local_pack' : 'not is_competitor' })),
  };
  console.log(JSON.stringify(report, null, 2));

  if (!runReviews && !runOnpage) {
    console.log('\nDry run. Reviews need Alan approval before --run-reviews.');
    return;
  }

  const out = { reviews: [], onpage: [] };

  if (runReviews) {
    const { fetchReviewsForDomain, upsertReviewRow } = await import('../lib/competitor-analysis/collect-reviews.js');
    for (const domain of needRev) {
      try {
        const row = await fetchReviewsForDomain(domain, null);
        if (row.collected) await upsertReviewRow(url, key, row);
        out.reviews.push(row);
      } catch (e) {
        out.reviews.push({ domain, collected: false, reason: e.message });
      }
      await sleep(PAUSE_MS);
    }
  }

  if (runOnpage) {
    const { collectOnpageForUrl, upsertOnpageRow } = await import('../lib/competitor-analysis/collect-onpage.js');
    for (const domain of needPage) {
      try {
        const row = await collectOnpageForUrl(domain, `https://www.${domain}/`, null);
        if (row.collected) await upsertOnpageRow(url, key, row);
        out.onpage.push(row);
      } catch (e) {
        out.onpage.push({ domain, collected: false, reason: e.message });
      }
      await sleep(PAUSE_MS);
    }
  }

  console.log('\nCollect results:', JSON.stringify({
    reviewsCollected: out.reviews.filter((r) => r.collected).length,
    onpageCollected: out.onpage.filter((r) => r.collected).length,
    backfillDate: new Date().toISOString(),
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
