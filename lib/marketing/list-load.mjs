/**
 * Audience snapshot → Squarespace mailing list, with consent checks (Alan, 7 Nov 2026, option a):
 *   before  — re-read consent from Squarespace; drop anyone not subscribed, suppressed or missing
 *   import  — the collector on Alan's PC creates the list and imports only the people who passed (Squarespace only
 *             accepts a list import with "contacts consent to email marketing" switched on)
 *   after   — re-read consent; anyone switched from not subscribed to subscribed by the import is a flip. Squarespace
 *             has no supported route to unsubscribe or remove them, so the list is BLOCKED — do not send
 *   pre-send — re-read consent + suppression for everyone imported; PASS is valid for 30 minutes
 *   post-send — recipients of a campaign sent to the list are reconciled against the people who passed
 * Nothing is sent from here.
 */
import { emailHash, finishRun, logRun, selectAll } from './store.mjs';
import { syncProfiles } from './sync.mjs';

export const PRESEND_VALID_MIN = 30;
const IMPORTED = ['pass', 'forced_test'];

async function consentNow(sb) {
  const sync = await syncProfiles(sb);
  const profiles = await selectAll(sb, 'sqs_profiles', 'email, accepts_marketing, missing_since');
  const suppressed = new Set((await selectAll(sb, 'marketing_suppression', 'email_hash, resolved_at')).filter((s) => !s.resolved_at).map((s) => s.email_hash));
  return { sync, byEmail: new Map(profiles.map((p) => [p.email, p])), suppressed };
}

/** One person's state right now: pass, or the reason they can't be emailed. */
export function stateOf(email, c) {
  const p = c.byEmail.get(String(email || '').toLowerCase());
  if (!p || p.missing_since) return 'missing';
  if (c.suppressed.has(emailHash(email))) return 'suppressed';
  return p.accepts_marketing ? 'pass' : 'not_subscribed';
}

const tally = (rows, k) => rows.reduce((m, r) => ({ ...m, [r[k]]: (m[r[k]] || 0) + 1 }), {});

async function loadExport(sb, id) {
  const { data, error } = await sb.from('marketing_segment_exports').select('*').eq('export_id', id).maybeSingle();
  if (error || !data) throw new Error('snapshot not found');
  return data;
}

async function setMemberStates(sb, exportId, rows, col) {
  const groups = new Map();
  for (const r of rows) { if (!groups.has(r[col])) groups.set(r[col], []); groups.get(r[col]).push(r.person_id); }
  for (const [state, ids] of groups) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await sb.from('marketing_segment_export_members').update({ [col]: state }).eq('export_id', exportId).in('person_id', ids.slice(i, i + 200));
      if (error) throw new Error(error.message);
    }
  }
}

export async function requestLoad(sb, exportId, by) {
  const exp = await loadExport(sb, exportId);
  if (!exp.is_test && !exp.campaign_key) throw new Error('only a snapshot tied to a campaign record can be loaded');
  if (!['pending_import', 'load_failed'].includes(exp.status)) throw new Error(`snapshot is ${exp.status}`);
  const runId = await logRun(sb, { kind: 'list-load', status: 'queued', host: 'dashboard', items_total: 4, items_done: 0, checkpoint: { export_id: exportId, step: 'waiting for Alan\'s PC' } });
  await sb.from('marketing_segment_exports').update({ status: 'load_queued', status_history: [...(exp.status_history || []), { status: 'load_queued', at: new Date().toISOString(), by }] }).eq('export_id', exportId);
  return { run_id: runId, export_id: exportId };
}

/** The PC job runner claims the oldest queued load. */
export async function nextLoad(sb) {
  const { data } = await sb.from('marketing_collector_runs').select('run_id, checkpoint').eq('kind', 'list-load').eq('status', 'queued').order('started_at').limit(1).maybeSingle();
  if (!data) return { job: null };
  await sb.from('marketing_collector_runs').update({ status: 'running', heartbeat_at: new Date().toISOString(), host: 'alan-pc' }).eq('run_id', data.run_id);
  const exp = await loadExport(sb, data.checkpoint.export_id);
  return { job: { run_id: data.run_id, export_id: exp.export_id, list_name: exp.list_name } };
}

/** Before the import: fresh consent for every member; only those who pass go in the CSV. */
export async function precheck(sb, exportId) {
  const exp = await loadExport(sb, exportId);
  const members = await selectAll(sb, 'marketing_segment_export_members', 'person_id, email, first_name, last_name', (q) => q.eq('export_id', exportId));
  const c = await consentNow(sb);
  const force = new Set(exp.is_test ? exp.definition_snapshot?.test_force_include || [] : []);
  const rows = members.map((m) => {
    const s = stateOf(m.email, c);
    return { ...m, precheck_state: s === 'pass' ? 'pass' : (force.has(emailHash(m.email)) ? 'forced_test' : `dropped:${s}`) };
  });
  await setMemberStates(sb, exportId, rows, 'precheck_state');
  const load = { precheck_at: new Date().toISOString(), subscribed_before: c.sync.subscribed, members: rows.length, passed: rows.filter((r) => IMPORTED.includes(r.precheck_state)).length, dropped: tally(rows.filter((r) => r.precheck_state.startsWith('dropped')), 'precheck_state') };
  await sb.from('marketing_segment_exports').update({ status: 'loading', load_result: load }).eq('export_id', exportId);
  return { ...load, import: rows.filter((r) => IMPORTED.includes(r.precheck_state)).map((r) => ({ email: r.email, first_name: r.first_name, last_name: r.last_name })) };
}

/** After the import: anyone not subscribed before and subscribed now was switched on by the import → BLOCKED. */
export async function postcheck(sb, exportId, { list_id: listId, list_count: listCount, all_subscribers_before: allBefore, all_subscribers_after: allAfter }) {
  const exp = await loadExport(sb, exportId);
  const members = await selectAll(sb, 'marketing_segment_export_members', 'person_id, email, precheck_state', (q) => q.eq('export_id', exportId));
  const c = await consentNow(sb);
  const imported = members.filter((m) => IMPORTED.includes(m.precheck_state));
  const rows = imported.map((m) => {
    const now = stateOf(m.email, c);
    const flipped = m.precheck_state !== 'pass' && c.byEmail.get(m.email)?.accepts_marketing;
    return { ...m, postcheck_state: flipped ? 'flipped_by_import' : (now === 'pass' ? 'ok' : `after:${now}`) };
  });
  await setMemberStates(sb, exportId, rows, 'postcheck_state');
  const flips = rows.filter((r) => r.postcheck_state === 'flipped_by_import');
  const status = flips.length ? 'blocked_do_not_send' : 'loaded';
  const load = { ...(exp.load_result || {}), postcheck_at: new Date().toISOString(), list_id: listId, list_count: listCount, imported: imported.length, subscribed_after: c.sync.subscribed,
    all_subscribers_before: allBefore ?? null, all_subscribers_after: allAfter ?? null, flips: flips.length, after: tally(rows, 'postcheck_state'),
    action: flips.length ? 'Squarespace has no supported way to unsubscribe or remove them from here: do not send to this list. Unsubscribe the people below in Squarespace (Contacts → person → unsubscribe) and remove them from the list, then re-run the pre-send check.' : null };
  await sb.from('marketing_segment_exports').update({ status, sqs_list_id: listId, loaded_at: new Date().toISOString(), load_result: load, status_history: [...(exp.status_history || []), { status, at: new Date().toISOString(), by: 'collector (Alan\'s PC)' }] }).eq('export_id', exportId);
  return { status, ...load };
}

/** Just before the send: everyone imported must still be subscribed, unsuppressed and not a flip. */
export async function presendCheck(sb, exportId) {
  const exp = await loadExport(sb, exportId);
  if (!exp.sqs_list_id) throw new Error('load the snapshot into a Squarespace list first');
  const members = await selectAll(sb, 'marketing_segment_export_members', 'person_id, email, precheck_state, postcheck_state', (q) => q.eq('export_id', exportId));
  const c = await consentNow(sb);
  const rows = members.filter((m) => IMPORTED.includes(m.precheck_state)).map((m) => {
    const s = stateOf(m.email, c);
    return { person_id: m.person_id, reason: m.postcheck_state === 'flipped_by_import' ? 'consent switched on by the import' : (s === 'pass' ? null : s) };
  });
  const fails = rows.filter((r) => r.reason);
  const result = { result: fails.length ? 'FAIL' : 'PASS', at: new Date().toISOString(), checked: rows.length, failures: tally(fails, 'reason'), people: fails.map((f) => ({ person_id: f.person_id, reason: f.reason })) };
  await sb.from('marketing_segment_exports').update({ presend_at: result.at, presend_result: result }).eq('export_id', exportId);
  return result;
}

export function presendState(exp, now = Date.now()) {
  if (!exp?.presend_at) return { state: 'not_checked' };
  const age = (now - Date.parse(exp.presend_at)) / 60000;
  if (exp.presend_result?.result !== 'PASS') return { state: 'fail', at: exp.presend_at };
  return age <= PRESEND_VALID_MIN ? { state: 'pass', at: exp.presend_at, minutes_left: Math.floor(PRESEND_VALID_MIN - age) } : { state: 'not_checked', expired_at: exp.presend_at };
}

/** After a send: campaign recipients reconciled against the people who passed for that list. */
export async function reconcileSends(sb) {
  const exps = (await selectAll(sb, 'marketing_segment_exports', 'export_id, list_name, sqs_list_id, is_test', (q) => q.not('sqs_list_id', 'is', null)));
  if (!exps.length) return { checked: 0, flagged: 0, rows: [] };
  const camps = await selectAll(sb, 'sqs_email_campaigns', 'email_id, subject, sent_on, mailing_list_names');
  const suppressed = new Set((await selectAll(sb, 'marketing_suppression', 'email_hash, resolved_at')).filter((s) => !s.resolved_at).map((s) => s.email_hash));
  const rows = [];
  for (const e of exps) {
    for (const c of camps.filter((x) => (x.mailing_list_names || []).includes(e.list_name))) {
      const ok = new Set((await selectAll(sb, 'marketing_segment_export_members', 'email, precheck_state, postcheck_state', (q) => q.eq('export_id', e.export_id))).filter((m) => m.precheck_state === 'pass' && m.postcheck_state !== 'flipped_by_import').map((m) => m.email));
      const sent = await selectAll(sb, 'sqs_email_events', 'email', (q) => q.eq('email_id', c.email_id).eq('event_type', 'DELIVERED'));
      const bad = sent.filter((s) => !ok.has(s.email) || suppressed.has(emailHash(s.email)));
      rows.push({ export_id: e.export_id, list_name: e.list_name, email_id: c.email_id, subject: c.subject, sent_on: c.sent_on, recipients: sent.length, flagged: bad.length });
    }
  }
  return { checked: rows.length, flagged: rows.reduce((a, r) => a + r.flagged, 0), rows };
}

export async function runProgress(sb, runId, patch) {
  const { error } = await sb.from('marketing_collector_runs').update({ heartbeat_at: new Date().toISOString(), ...patch }).eq('run_id', runId);
  if (error) throw new Error(error.message);
  return { run_id: runId };
}

export async function finishLoad(sb, { run_id: runId, export_id: exportId, status, summary, error }) {
  await finishRun(sb, runId, { status, summary: summary || null, error: error ? String(error).slice(0, 500) : null, ...(status === 'ok' ? { items_done: 4 } : {}) });
  if (status !== 'ok' && exportId) {
    const exp = await loadExport(sb, exportId);
    if (['load_queued', 'loading'].includes(exp.status)) {
      const at = new Date().toISOString();
      await sb.from('marketing_segment_exports').update({ status: 'load_failed', status_history: [...(exp.status_history || []), { status: 'load_failed', at, by: 'collector (Alan\'s PC)', note: String(error || '').slice(0, 300) }] }).eq('export_id', exportId);
    }
  }
  return { run_id: runId, status };
}
