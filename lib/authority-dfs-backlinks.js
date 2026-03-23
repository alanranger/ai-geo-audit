/**
 * Aggregate spam-filtered DFS domain index rows for Authority backlink metrics.
 */

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

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} domainHost normalized e.g. alanranger.com
 * @returns {Promise<{ referringDomains: number, totalBacklinks: number, followRatio: number, dofollow: number, nofollow: number, unknown: number, generatedAt: string, source: string, domainHost: string } | null>}
 */
export async function aggregateDfsBacklinksForDomain(supabase, domainHost) {
  const dom = String(domainHost || '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
  if (!dom) return null;

  const domains = new Set();
  let from = 0;
  let totalRows = 0;
  let df = 0;
  let nf = 0;
  let unk = 0;

  while (totalRows < MAX_SCAN) {
    const { data, error } = await supabase
      .from('dfs_domain_backlink_rows')
      .select('url_from, dofollow')
      .eq('domain_host', dom)
      .range(from, from + PAGE - 1);

    if (error) throw new Error(String(error.message || error));
    if (!data || data.length === 0) break;

    for (let i = 0; i < data.length; i += 1) {
      const row = data[i];
      totalRows += 1;
      const h = hostFromUrl(row?.url_from);
      if (h) domains.add(h);
      if (row?.dofollow === true) df += 1;
      else if (row?.dofollow === false) nf += 1;
      else unk += 1;
    }

    if (data.length < PAGE) break;
    from += PAGE;
  }

  if (totalRows === 0) return null;

  const known = df + nf;
  const followRatio = known > 0 ? df / known : 0;

  return {
    referringDomains: domains.size,
    totalBacklinks: totalRows,
    followRatio,
    dofollow: df,
    nofollow: nf,
    unknown: unk,
    generatedAt: new Date().toISOString(),
    source: 'dfs_supabase',
    domainHost: dom
  };
}
