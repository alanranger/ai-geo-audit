/**
 * Persist-only bridge: dfs_backlink_summary_cache → audit_results scalars
 * + append-only domain_rank_history snapshot.
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
 * domain_rank_history: append only — never update/delete prior rows.
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

function asIntOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
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
  const rank = asIntOrNull(data.rank);
  const rd = asIntOrNull(data.referring_domains);
  if (rank == null && rd == null) return null;
  return { domain_rating: rank, referring_domains: rd };
}

/**
 * Append one domain_rank_history row from current dfs_backlink_summary_cache.
 * Does not call DFS. Does not write any other table.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ domainHost: string, auditId?: string|null }} opts
 */
export async function appendDomainRankHistoryFromCache(supabase, opts) {
  const host = normalizeDomainHost(opts?.domainHost || '');
  if (!host) return { inserted: 0, reason: 'no_host' };

  const { data: cache, error: readErr } = await supabase
    .from('dfs_backlink_summary_cache')
    .select('rank, backlinks, referring_domains, backlinks_spam_score, crawled_pages')
    .eq('domain_host', host)
    .maybeSingle();
  if (readErr) throw new Error(String(readErr.message || readErr));
  if (!cache) return { inserted: 0, reason: 'no_cache' };

  const row = {
    audit_id: opts?.auditId || null,
    domain: host,
    rank: asIntOrNull(cache.rank),
    backlinks: asIntOrNull(cache.backlinks),
    referring_domains: asIntOrNull(cache.referring_domains),
    backlinks_spam_score: asIntOrNull(cache.backlinks_spam_score),
    crawled_pages: asIntOrNull(cache.crawled_pages),
    created_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('domain_rank_history')
    .insert(row)
    .select('id, domain, rank, backlinks, referring_domains, backlinks_spam_score, crawled_pages, created_at, audit_id')
    .single();
  if (error) throw new Error(String(error.message || error));
  return { inserted: 1, row: data };
}

/**
 * Copy current DFS summary scalars onto the audit_results row for auditDate
 * (default: today UTC). Historical rows are never invented.
 * Then append one domain_rank_history snapshot from the same cache values.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ domainHost: string, propertyUrl?: string, auditDate?: string, auditId?: string|null }} opts
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
  if (!propertyUrl) {
    let history = null;
    try {
      history = await appendDomainRankHistoryFromCache(supabase, {
        domainHost: host,
        auditId: opts?.auditId || null
      });
    } catch (err) {
      console.warn('[DFS scalars] domain_rank_history append skipped:', err?.message || err);
    }
    return { updated: 0, reason: 'no_audit_row', auditDate, history, ...scalars };
  }

  const { data, error } = await supabase
    .from('audit_results')
    .update({
      domain_rating: scalars.domain_rating,
      referring_domains: scalars.referring_domains,
      updated_at: new Date().toISOString()
    })
    .eq('property_url', propertyUrl)
    .eq('audit_date', auditDate)
    .select('id, audit_date');
  if (error) throw new Error(String(error.message || error));

  const auditId = opts?.auditId || (Array.isArray(data) && data[0]?.id) || null;
  let history = null;
  try {
    history = await appendDomainRankHistoryFromCache(supabase, {
      domainHost: host,
      auditId
    });
  } catch (err) {
    console.warn('[DFS scalars] domain_rank_history append skipped:', err?.message || err);
  }

  return {
    updated: Array.isArray(data) ? data.length : 0,
    propertyUrl,
    auditDate,
    auditId,
    history,
    ...scalars
  };
}

export { normalizeDomainHost };
