/**
 * Audit UI status merge vs DB for latest integrity run.
 * node scripts/audit-integrity-ui-status-vs-db.mjs
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { assignIntegrityFindingIds } from '../lib/configIntegrity/findingIds.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

const PROPERTY = 'https://www.alanranger.com';
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });

function deriveIntegrityStatus(finding) {
  const check = Number(finding?.check || 0);
  const action = String(finding?.suggested_action || '');
  if (check && check !== 3) {
    return { key: 'other', label: 'Other/config' };
  }
  const linkStatus = String(finding?.pageAudit?.link_status || finding?.linkStatus || '');
  if (linkStatus === 'present') {
    return { key: 'awaiting', label: 'Link in place — awaiting recrawl' };
  }
  if (linkStatus === 'weak') {
    return { key: 'weak', label: 'Link present, weak anchor' };
  }
  if (linkStatus === 'absent') {
    return { key: 'fix', label: 'Fix needed' };
  }
  if (linkStatus === 'error') {
    return { key: 'unchecked', label: 'Page fetch error' };
  }
  if (/decision needed/i.test(action)) {
    return { key: 'decision', label: 'Decision needed' };
  }
  return { key: 'unchecked', label: 'Not page-checked' };
}

function statusFromWorkDecision(autoKey, progress, decisionType, linkStatus) {
  if (progress === 'parked' || decisionType === 'parked') {
    return { key: 'parked', label: 'Parked' };
  }
  if (progress !== 'done' && progress !== 'in_progress') return null;
  if (decisionType === 'accept') {
    return { key: 'awaiting_accept', label: 'Awaiting recrawl' };
  }
  if (decisionType === 'keep_specialist') {
    const linkOk = linkStatus === 'present' || autoKey === 'awaiting';
    if (linkOk) {
      return { key: 'awaiting', label: 'Link in place — awaiting recrawl' };
    }
    return { key: 'strengthen', label: 'Strengthen — on-page/anchor' };
  }
  return null;
}

const { data: run, error: rErr } = await sb
  .from('config_integrity_runs')
  .select('findings, run_at, chip_rag, stats')
  .eq('property_url', PROPERTY)
  .order('run_at', { ascending: false })
  .limit(1)
  .maybeSingle();
if (rErr) throw rErr;

const findings = assignIntegrityFindingIds(Array.isArray(run?.findings) ? run.findings : []);

const { data: states } = await sb
  .from('config_integrity_finding_state')
  .select('finding_key, progress, decision_type, note, cleared_at, worked_at')
  .eq('property_url', PROPERTY);

const { data: audits } = await sb
  .from('config_integrity_page_audit')
  .select('finding_key, link_status, sample_anchor, from_path, to_path, checked_at')
  .eq('property_url', PROPERTY);

const stateMap = new Map((states || []).map((s) => [s.finding_key, s]));
const auditMap = new Map((audits || []).map((a) => [a.finding_key, a]));

const rows = findings.map((f) => {
  const id = f.findingId;
  const audit = auditMap.get(id) || null;
  const withAudit = { ...f, pageAudit: audit, linkStatus: audit?.link_status };
  const auto = deriveIntegrityStatus(withAudit);
  const st = stateMap.get(id) || null;
  const progress = String(st?.progress || 'none').toLowerCase();
  let decisionType = String(st?.decision_type || '').toLowerCase().trim();
  if (!['accept', 'keep_specialist', 'parked'].includes(decisionType)) {
    decisionType = progress === 'parked' ? 'parked' : 'none';
  }
  const linkSt = String(audit?.link_status || '');
  const ov = statusFromWorkDecision(auto.key, progress, decisionType, linkSt);
  const finalKey = ov ? ov.key : auto.key;
  const finalLabel = ov ? ov.label : auto.label;
  const actionIsDecision = /decision needed/i.test(String(f.suggested_action || ''));
  return {
    id,
    check: Number(f.check || 0),
    keyword: f.subject,
    preferred: f.preferred_path || null,
    assigned: f.assigned_path || null,
    actionTemplate: String(f.suggested_action || '').slice(0, 100),
    actionIsDecision,
    link_status: linkSt || null,
    sample_anchor: audit?.sample_anchor || null,
    progress,
    decision_type: decisionType,
    auto_status: auto.key,
    final_status: finalKey,
    final_label: finalLabel,
    note: st?.note ? String(st.note).slice(0, 80) : null,
    severity: f.severity
  };
});

const byStatus = {};
for (const r of rows) {
  byStatus[r.final_status] = (byStatus[r.final_status] || 0) + 1;
}

// Anomalies
const decisionStillOpen = rows.filter((r) => r.final_status === 'decision');
const actionSaysDecisionButCleared = rows.filter(
  (r) => r.actionIsDecision && r.final_status !== 'decision' && r.decision_type !== 'none'
);
const actionSaysDecisionNoState = rows.filter(
  (r) => r.actionIsDecision && r.decision_type === 'none' && r.final_status === 'decision'
);
const keepNoPresent = rows.filter(
  (r) => r.decision_type === 'keep_specialist' && r.final_status === 'strengthen'
);
const acceptRows = rows.filter((r) => r.final_status === 'awaiting_accept');
const linkInPlace = rows.filter((r) => r.final_status === 'awaiting');
const weak = rows.filter((r) => r.final_status === 'weak');
const other = rows.filter((r) => r.final_status === 'other' || r.check !== 3);
const orphanStatesWithDecision = (states || []).filter((s) => {
  const d = String(s.decision_type || '');
  if (!['accept', 'keep_specialist', 'parked'].includes(d)) return false;
  if (s.progress === 'done' && s.cleared_at) return false;
  // not in open findings
  return !findings.some((f) => f.findingId === s.finding_key);
});

console.log(
  JSON.stringify(
    {
      integrityRunAt: run?.run_at,
      chip_rag: run?.chip_rag,
      stats: run?.stats,
      openFindings: rows.length,
      byFinalStatus: byStatus,
      stillDecisionNeeded: decisionStillOpen.map((r) => ({
        id: r.id,
        kw: r.keyword,
        preferred: r.preferred,
        assigned: r.assigned,
        progress: r.progress,
        decision_type: r.decision_type,
        link_status: r.link_status
      })),
      keepSpecialistStillStrengthen: keepNoPresent.map((r) => ({
        id: r.id,
        kw: r.keyword,
        link_status: r.link_status,
        sample_anchor: r.sample_anchor
      })),
      awaitingRecrawlAccept: acceptRows.map((r) => ({ id: r.id, kw: r.keyword, assigned: r.assigned })),
      linkInPlaceAwaiting: linkInPlace.map((r) => ({
        id: r.id,
        kw: r.keyword,
        decision_type: r.decision_type,
        link_status: r.link_status
      })),
      weakAnchor: weak.map((r) => ({
        id: r.id,
        kw: r.keyword,
        decision_type: r.decision_type,
        from: r.preferred,
        to: r.assigned,
        sample: r.sample_anchor
      })),
      otherConfig: other.map((r) => ({
        id: r.id,
        check: r.check,
        kw: r.keyword,
        severity: r.severity,
        action: r.actionTemplate
      })),
      actionTemplateStaleButUiClear: actionSaysDecisionButCleared.length,
      orphanStatesNotInOpenFindings: orphanStatesWithDecision.length
    },
    null,
    2
  )
);
