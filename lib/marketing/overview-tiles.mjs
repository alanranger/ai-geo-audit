/** Server-side facts for the Marketing Overview tiles (counts only, no personal data). */

/** Clean-up manifests frozen and waiting for Alan's approval (tile 7 decision list). Unreadable shows as null, never 0. */
export async function cleanupDecisions(sb) {
  const { data, error } = await sb.from('marketing_cleanup_manifests').select('manifest_id, created_at, mode, action, counts').eq('status', 'frozen').order('created_at', { ascending: true }).limit(50);
  if (error) return { frozen: null, error: error.message };
  return { frozen: (data || []).map((m) => ({ manifest_id: m.manifest_id, created_at: m.created_at, mode: m.mode, action: m.action, people: m.counts?.eligible ?? null })) };
}

export async function overviewTileFacts(sb) {
  return { cleanup: await cleanupDecisions(sb) };
}
