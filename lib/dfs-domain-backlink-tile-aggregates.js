/**
 * One-pass scan of dfs_domain_backlink_rows for Backlinks dashboard tiles:
 * follow split, referring domains, ref. domain rank bands, dofollow by page segment tier (target URL path).
 */

import { dfsBacklinkPageTierFromTargetUrl } from './dfs-backlink-page-tier.js';

const PAGE = 800;
const MAX_SCAN = 120000;

function hostFromUrl(raw) {
  const u = String(raw || '').trim();
  if (!u) return null;
  try {
    const url = new URL(u.includes('://') ? u : `https://${u}`);
    let h = url.hostname.toLowerCase();
    if (h.startsWith('www.')) h = h.slice(4);
    return h || null;
  } catch {
    return null;
  }
}

function bucketDomainRank(value) {
  if (value == null || value === '') return 'r_null';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'r_null';
  if (n >= 80) return 'r80_100';
  if (n >= 50) return 'r50_79';
  if (n >= 30) return 'r30_49';
  if (n >= 20) return 'r20_29';
  return 'r_lt20';
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} domainHost normalized e.g. alanranger.com
 */
export async function aggregateDfsBacklinkTileStats(supabase, domainHost) {
  const dom = String(domainHost || '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
  if (!dom) return null;

  const domains = new Set();
  let from = 0;
  let totalRows = 0;
  let dofollow = 0;
  let nofollow = 0;
  let unknown = 0;
  const emptyBands = () => ({
    r80_100: 0,
    r50_79: 0,
    r30_49: 0,
    r20_29: 0,
    r_lt20: 0,
    r_null: 0
  });
  const bands = emptyBands();
  const bandsDf = emptyBands();
  const bandsNf = emptyBands();
  const bandsUn = emptyBands();
  const pageTierDf = { landing: 0, product: 0, event: 0, blog: 0, academy: 0, unmapped: 0 };

  while (totalRows < MAX_SCAN) {
    const { data, error } = await supabase
      .from('dfs_domain_backlink_rows')
      .select('url_from, url_to, dofollow, domain_from_rank')
      .eq('domain_host', dom)
      .range(from, from + PAGE - 1);

    if (error) throw new Error(String(error.message || error));
    if (!data || data.length === 0) break;

    for (let i = 0; i < data.length; i += 1) {
      const row = data[i];
      totalRows += 1;
      const h = hostFromUrl(row?.url_from);
      if (h) domains.add(h);
      if (row?.dofollow === true) dofollow += 1;
      else if (row?.dofollow === false) nofollow += 1;
      else unknown += 1;
      const key = bucketDomainRank(row?.domain_from_rank);
      bands[key] = (bands[key] || 0) + 1;
      if (row?.dofollow === true) bandsDf[key] = (bandsDf[key] || 0) + 1;
      else if (row?.dofollow === false) bandsNf[key] = (bandsNf[key] || 0) + 1;
      else bandsUn[key] = (bandsUn[key] || 0) + 1;
      if (row?.dofollow === true) {
        const pt = dfsBacklinkPageTierFromTargetUrl(row?.url_to);
        if (pageTierDf[pt] != null) pageTierDf[pt] += 1;
        else pageTierDf.unmapped += 1;
      }
    }

    if (data.length < PAGE) break;
    from += PAGE;
  }

  const known = dofollow + nofollow;
  const followRatio = known > 0 ? dofollow / known : 0;

  return {
    domainHost: dom,
    totalBacklinks: totalRows,
    referringDomains: domains.size,
    dofollow,
    nofollow,
    unknown,
    followRatio,
    rankBands: bands,
    rankBandsDofollow: bandsDf,
    rankBandsNofollow: bandsNf,
    rankBandsUnknown: bandsUn,
    pageTierDofollow: pageTierDf,
    generatedAt: new Date().toISOString(),
    source: 'dfs_supabase_tile_scan',
    truncated: totalRows >= MAX_SCAN
  };
}
