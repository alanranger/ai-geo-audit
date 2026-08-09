/**
 * Align integrity finding suggested_action with work-state + page-audit.
 * Prevents stale "Decision needed" in Action after Alan records decide.
 */
import { assignIntegrityFindingIds } from './findingIds.mjs';

function pathOnly(raw) {
  try {
    if (/^https?:\/\//i.test(raw)) {
      let p = (new URL(raw).pathname || '/').toLowerCase();
      if (p.length > 1) p = p.replace(/\/+$/, '');
      return p || '/';
    }
  } catch { /* ignore */ }
  let p = String(raw || '').toLowerCase().split(/[?#]/)[0] || '/';
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p || '/';
}

/**
 * @param {object[]} findings - enriched integrity findings
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string} propertyUrl
 */
export async function applyWorkStateToFindings(findings, sb, propertyUrl) {
  const list = Array.isArray(findings) ? findings : [];
  if (!list.length || !sb) return list;

  const withIds = assignIntegrityFindingIds(list);

  const { data: states } = await sb
    .from('config_integrity_finding_state')
    .select('finding_key, progress, decision_type, note')
    .eq('property_url', propertyUrl);
  const { data: audits } = await sb
    .from('config_integrity_page_audit')
    .select('finding_key, link_status, sample_anchor')
    .eq('property_url', propertyUrl);

  const stateMap = new Map((states || []).map((s) => [s.finding_key, s]));
  const auditMap = new Map((audits || []).map((a) => [a.finding_key, a]));

  return withIds.map((f) => {
    const id = f.findingId;
    const st = stateMap.get(id);
    const audit = auditMap.get(id);
    const progress = String(st?.progress || 'none').toLowerCase();
    let decision = String(st?.decision_type || '').toLowerCase().trim();
    if (!['accept', 'keep_specialist', 'parked'].includes(decision)) {
      decision = progress === 'parked' ? 'parked' : 'none';
    }
    const link = String(audit?.link_status || '');
    const kw = String(f.subject || '').trim();
    const from = pathOnly(f.preferred_path || '');
    const to = pathOnly(f.assigned_path || '');
    let action = f.suggested_action;

    if (progress === 'done' || progress === 'in_progress' || progress === 'parked' || decision !== 'none') {
      if (decision === 'parked' || progress === 'parked') {
        action = 'Parked — no action until reopened.';
      } else if (decision === 'accept') {
        action =
          'Awaiting recrawl — LOCKED accept recorded; wait for ranking best_url to match assigned target. Not a win yet.';
      } else if (decision === 'keep_specialist') {
        if (link === 'present') {
          action =
            'Link in place — exact-anchor proven; wait for ranking best_url to match LOCKED target. Not a win yet.';
        } else if (link === 'weak') {
          action = `Strengthen — path link exists but weak anchor (sample “${String(audit?.sample_anchor || '').slice(0, 60)}”). Put exact keyword “${kw}” on link from ${from || 'preferred'} → ${to || 'assigned'}.`;
        } else if (link === 'absent') {
          action = `Strengthen — add link from ${from || 'preferred'} → ${to || 'assigned'} with exact keyword “${kw}”.`;
        } else {
          action = `Strengthen — exact-anchor link from preferred page → LOCKED target with keyword “${kw}”. Run Re-check pages after ship.`;
        }
      }
    }

    // Strip ids from persisted findings (stable ids are re-derived in UI)
    const { findingId, findingKeyRaw, ...rest } = f;
    return { ...rest, suggested_action: action };
  });
}
