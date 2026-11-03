/**
 * Monday brief backlinks basis (QUESTION 2026-11-03 item 1). Every backlinks figure in the brief comes from the
 * live-only dfs_domain_backlink_rows index (spam filters v1, rebuilt by the Monday `full` step). Each week's
 * figures are stored with their basis tag; next week compares against that row, never against older sources.
 */
export const BACKLINK_SOURCE = 'dfs_domain_backlink_rows';

/** e.g. "dfs_domain_backlink_rows:v1:live-full" — the definition, not the date, so weekly full refreshes compare. */
export function basisTag(state) {
  if (!state) return null;
  const mode = state.last_ingest_action === 'full' ? 'live-full' : (state.last_ingest_action || 'unknown');
  return `${BACKLINK_SOURCE}:${state.filters_version || 'unknown'}:${mode}`;
}

/** The figures next week's deltas are taken against. */
export function snapshotFigures(bl) {
  return {
    referring_domains: bl.referring_domains,
    backlinks: bl.backlinks,
    dofollow: bl.dofollow,
    nofollow: bl.nofollow,
    da_bands: (bl.da_bands || []).map((b) => ({ key: b.key, label: b.label, dofollow: b.dofollow, nofollow: b.nofollow })),
    high_da_dofollow_keys: bl.high_da_dofollow_keys || []
  };
}

export async function loadBasisSnapshot(supabase, propertyUrl, weekStart) {
  if (!weekStart) return null;
  const { data } = await supabase.from('ceo_backlink_basis_snapshots').select('week_start, basis_tag, ingest_run_at, figures')
    .eq('property_url', propertyUrl).eq('week_start', weekStart).maybeSingle();
  return data || null;
}

/** Written after a real Monday send (and once by hand for 2 Nov). */
export async function saveBasisSnapshot(supabase, propertyUrl, weekStart, bl) {
  if (!bl?.index_basis?.tag || bl.backlinks == null) return { written: 0, reason: 'no basis tag' };
  const { error } = await supabase.from('ceo_backlink_basis_snapshots').upsert({
    property_url: propertyUrl,
    week_start: weekStart,
    basis_tag: bl.index_basis.tag,
    ingest_run_at: bl.index_basis.last_full_at || null,
    figures: snapshotFigures(bl),
    captured_at: new Date().toISOString()
  }, { onConflict: 'property_url,week_start' });
  if (error) throw new Error(`backlink_basis_snapshot:${error.message}`);
  return { written: 1 };
}
