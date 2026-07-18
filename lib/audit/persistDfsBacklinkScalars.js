/**
 * Persist-only bridge: dfs_backlink_summary_cache → audit_results scalars.
 *
 * Mapping (product naming):
 *   cache.rank              → audit_results.domain_rating
 *   cache.referring_domains → audit_results.referring_domains
 *
 * IMPORTANT: `domain_rating` stores DataForSEO summary **domain rank**
 * (typically 0–100 via rank_scale=one_hundred). It is NOT Moz/Ahrefs
 * Domain Rating (DR). UI must label it "DFS domain rank", never "Domain Rating (DR)".
 *
 * Does not touch authority_* or any other score columns.
 */

function normalizeDomainHost(raw) {
  let s = String(raw || '')
    .trim()
    .toLowerCase();
  s = s.replace(/^https?:\/\//i, '');
  s = s.split('/')[0].replace(/^www\./, '');
  return s.replace(/:\d+$/, '');
}

function todayUtcDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} domainHost
 * @returns {Promise<{ domain_rating: number|null, referring_domains: number|null }|null>}
 */
export async function readDfsBacklinkScalars(supabase, domainHost) {
  const host = normalizeDomainHost(domainHost);
  if (!host) return null;
  const { data, error } = await supabase
    .from('dfs_backlink_summary_cache')
    .select('rank, referring_domains')
    .eq('domain_host', host)
    .maybeSingle();
  if (error) throw new Error(String(error.message || error));
  if (!data) return null;
  const rank = data.rank != null && Number.isFinite(Number(data.rank)) ? Math.round(Number(data.rank)) : null;
  const rd =
    data.referring_domains != null && Number.isFinite(Number(data.referring_domains))
      ? Math.round(Number(data.referring_domains))
      : null;
  if (rank == null && rd == null) return null;
  return { domain_rating: rank, referring_domains: rd };
}

/**
 * Copy current DFS summary scalars onto the audit_results row for auditDate
 * (default: today UTC). Historical rows are never invented.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ domainHost: string, propertyUrl?: string, auditDate?: string }} opts
 */
export async function persistDfsBacklinkScalarsToAuditResults(supabase, opts) {
  const host = normalizeDomainHost(opts?.domainHost || opts?.propertyUrl || '');
  if (!host) return { updated: 0, reason: 'no_host' };
  const scalars = await readDfsBacklinkScalars(supabase, host);
  if (!scalars) return { updated: 0, reason: 'no_cache' };

  const auditDate = String(opts?.auditDate || todayUtcDate()).slice(0, 10);
  let propertyUrl = opts?.propertyUrl ? String(opts.propertyUrl).trim() : '';
  if (!propertyUrl) {
    const { data: rows } = await supabase
      .from('audit_results')
      .select('property_url')
      .eq('audit_date', auditDate)
      .ilike('property_url', `%${host}%`)
      .limit(1);
    propertyUrl = rows?.[0]?.property_url || '';
  }
  if (!propertyUrl) return { updated: 0, reason: 'no_audit_row', auditDate, ...scalars };

  const { data, error } = await supabase
    .from('audit_results')
    .update({
      domain_rating: scalars.domain_rating,
      referring_domains: scalars.referring_domains,
      updated_at: new Date().toISOString()
    })
    .eq('property_url', propertyUrl)
    .eq('audit_date', auditDate)
    .select('audit_date');
  if (error) throw new Error(String(error.message || error));
  return {
    updated: Array.isArray(data) ? data.length : 0,
    propertyUrl,
    auditDate,
    ...scalars
  };
}

export { normalizeDomainHost };
