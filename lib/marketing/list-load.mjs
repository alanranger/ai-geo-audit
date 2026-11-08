/**
 * Audience snapshot → Squarespace mailing list, with consent checks (Alan, 7 Nov 2026, option a):
 *   before  — re-read consent from Squarespace; drop anyone not subscribed, suppressed or missing
 *   import  — the collector on Alan's PC creates the list and imports only the people who passed (Squarespace only
 *             accepts a list import with "contacts consent to email marketing" switched on)
 *   after   — re-read consent; anyone switched from not subscribed to subscribed by the import is a flip. The PC sets
 *             them back with Squarespace's own opt-out (which also takes them off the list) and the dashboard confirms
 *             it; until every flip is confirmed unsubscribed again the list is BLOCKED — do not send
 *   pre-send — re-read consent + suppression for everyone imported; PASS is valid for 30 minutes
 *   post-send — recipients of a campaign sent to the list are reconciled against the people who passed
 * Nothing is sent from here.
 */
import { emailHash, finishRun, logRun, selectAll } from './store.mjs';
import { syncProfiles } from './sync.mjs';
import { IMPORT_BLOCK } from './import-block.mjs';

export const PRESEND_VALID_MIN = 30;
export const SEND_RULE = 'Press Pre-send check, then send in Squarespace within 30 minutes';
const PRESEND_LOG_MAX = 50;
const IMPORTED = ['pass', 'forced_test'];

async function consentNow(sb) {
  const sync = await syncProfiles(sb);
  const profiles = await selectAll(sb, 'sqs_profiles', 'profile_id, email, accepts_marketing, missing_since');
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

/** Why a snapshot can't be loaded yet (null = it can). Production loads also need the automations check confirmed. */
export function loadRefusal(exp, opts = {}) {
  if (!['pending_import', 'load_failed'].includes(exp.status)) return `snapshot is ${exp.status}`;
  if (exp.is_test) return exp.list_name?.startsWith('ARP | TEST |') ? null : 'test snapshots load only into "ARP | TEST |" lists';
  if (!exp.campaign_key) return 'only a snapshot tied to a campaign record can be loaded';
  if (IMPORT_BLOCK.production_load_blocked) return IMPORT_BLOCK.production_load_reason;
  return opts.automations_checked ? null : 'confirm the Squarespace automations check first (Marketing → Email Campaigns → Automations: nothing is triggered by joining this list or by a new subscriber)';
}

export async function requestLoad(sb, exportId, by, opts = {}) {
  const exp = await loadExport(sb, exportId);
  const refusal = loadRefusal(exp, opts);
  if (refusal) throw new Error(refusal);
  const at = new Date().toISOString();
  const runId = await logRun(sb, { kind: 'list-load', status: 'queued', host: 'dashboard', items_total: 4, items_done: 0, checkpoint: { export_id: exportId, step: 'waiting for Alan\'s PC' } });
  const note = opts.automations_checked ? 'automations check confirmed by Alan' : null;
  await sb.from('marketing_segment_exports').update({ status: 'load_queued', status_history: [...(exp.status_history || []), { status: 'load_queued', at, by, note }] }).eq('export_id', exportId);
  return { run_id: runId, export_id: exportId };
}

/**
 * Repair queue (V07): every person the import switched on stays `flipped_by_import` in the database until a fresh
 * consent read confirms them unsubscribed again, so a closed browser or a sleeping PC loses nothing. Alan's PC asks
 * for this list on every scheduled run (every 5 minutes) and retries the opt-out until each one is confirmed.
 */
export async function repairQueue(sb) {
  const blocked = await selectAll(sb, 'marketing_segment_exports', 'export_id, list_name, sqs_list_id, load_result, is_test', (q) => q.eq('status', 'blocked_do_not_send'));
  const out = [];
  for (const e of blocked) {
    const flips = await selectAll(sb, 'marketing_segment_export_members', 'person_id, email', (q) => q.eq('export_id', e.export_id).eq('postcheck_state', 'flipped_by_import'));
    if (!flips.length) continue;
    const profiles = await selectAll(sb, 'sqs_profiles', 'profile_id, email', (q) => q.in('email', flips.map((f) => f.email)));
    out.push({ export_id: e.export_id, list_name: e.list_name, list_id: e.sqs_list_id, waiting: flips.length, profile_ids: profiles.map((p) => p.profile_id), attempts: e.load_result?.repair?.attempts || 0 });
  }
  return { items: out };
}

/** A repair attempt that failed before it could be confirmed (kept on the snapshot; the next run retries). */
export async function repairFailed(sb, exportId, error) {
  const exp = await loadExport(sb, exportId);
  const prev = exp.load_result?.repair || {};
  const repair = { ...prev, attempts: (prev.attempts || 0) + 1, last_try_at: new Date().toISOString(), last_error: String(error || '').slice(0, 300), confirmed: false };
  await sb.from('marketing_segment_exports').update({ load_result: { ...(exp.load_result || {}), repair } }).eq('export_id', exportId);
  return { export_id: exportId, repair };
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
  return { ...load, import: rows.filter((r) => IMPORTED.includes(r.precheck_state)).map((r) => ({ email: r.email, first_name: r.first_name, last_name: r.last_name, profile_id: c.byEmail.get(r.email)?.profile_id || null })) };
}

/**
 * After the import. A flip is anyone the import switched to subscribed: either not subscribed at the before-check and
 * subscribed now, or (from the PC) whose subscription record was started by this CSV import — that also catches someone
 * who unsubscribed in the seconds between the check and the import. Flips, or records the PC could not read, block.
 */
export async function postcheck(sb, exportId, b) {
  const { list_id: listId, list_count: listCount, all_subscribers_before: allBefore, all_subscribers_after: allAfter } = b;
  const exp = await loadExport(sb, exportId);
  const members = await selectAll(sb, 'marketing_segment_export_members', 'person_id, email, precheck_state', (q) => q.eq('export_id', exportId));
  const c = await consentNow(sb);
  const switched = new Set(b.switched_ids || []);
  const imported = members.filter((m) => IMPORTED.includes(m.precheck_state));
  const rows = imported.map((m) => {
    const p = c.byEmail.get(m.email);
    const flipped = p?.accepts_marketing && (m.precheck_state !== 'pass' || switched.has(p.profile_id));
    const now = stateOf(m.email, c);
    return { ...m, postcheck_state: flipped ? 'flipped_by_import' : (now === 'pass' ? 'ok' : `after:${now}`) };
  });
  await setMemberStates(sb, exportId, rows, 'postcheck_state');
  const flips = rows.filter((r) => r.postcheck_state === 'flipped_by_import');
  const unreadable = Number(b.unreadable) || 0;
  const status = flips.length || unreadable ? 'blocked_do_not_send' : 'loaded';
  const load = { ...(exp.load_result || {}), postcheck_at: new Date().toISOString(), list_id: listId, list_count: listCount, imported: imported.length, subscribed_after: c.sync.subscribed,
    all_subscribers_before: allBefore ?? null, all_subscribers_after: allAfter ?? null, flips: flips.length, switched_by_csv: switched.size, unreadable, after: tally(rows, 'postcheck_state'),
    action: flipAction(flips.length, unreadable) };
  await sb.from('marketing_segment_exports').update({ status, sqs_list_id: listId, loaded_at: new Date().toISOString(), load_result: load, status_history: [...(exp.status_history || []), { status, at: new Date().toISOString(), by: 'collector (Alan\'s PC)' }] }).eq('export_id', exportId);
  return { status, ...load, fix_ids: flips.map((r) => c.byEmail.get(r.email)?.profile_id).filter(Boolean) };
}

function flipAction(flips, unreadable) {
  if (unreadable) return `Do not send to this list: ${unreadable} person(s)' subscription records could not be read after the import, so a re-subscribe cannot be ruled out. Load it again.`;
  return flips ? UNFIXED_ACTION : null;
}

const UNFIXED_ACTION = 'Do not send to this list. The import switched these people to subscribed and setting them back could not be confirmed. In Squarespace open Contacts → the person → ··· → "Opt out of email marketing" (this also takes them off the list), then run the pre-send check here.';

/** After the PC used Squarespace's opt-out on the flipped people: confirm each is unsubscribed again before unblocking. */
export async function fixFlips(sb, exportId, { list_count: listCount, all_subscribers_after_fix: allAfterFix }) {
  const exp = await loadExport(sb, exportId);
  const flipped = await selectAll(sb, 'marketing_segment_export_members', 'person_id, email, postcheck_state', (q) => q.eq('export_id', exportId).eq('postcheck_state', 'flipped_by_import'));
  const c = await consentNow(sb);
  const fixed = flipped.filter((m) => !c.byEmail.get(m.email)?.accepts_marketing).map((m) => ({ ...m, postcheck_state: 'flipped_fixed' }));
  await setMemberStates(sb, exportId, fixed, 'postcheck_state');
  const all = fixed.length === flipped.length && !exp.load_result?.unreadable;
  const at = new Date().toISOString();
  const status = all ? 'loaded' : 'blocked_do_not_send';
  const prevRepair = exp.load_result?.repair || {};
  const repair = { attempts: (prevRepair.attempts || 0) + 1, last_try_at: at, last_error: all ? null : `${flipped.length - fixed.length} still subscribed after the opt-out`, confirmed: all, waiting: flipped.length - fixed.length };
  const load = { ...(exp.load_result || {}), fixed: (exp.load_result?.fixed || 0) + fixed.length, fixed_at: at, list_count_after_fix: listCount ?? null, subscribed_after_fix: c.sync.subscribed, all_subscribers_after_fix: allAfterFix ?? null, repair,
    fix_note: `${fixed.length} of ${flipped.length} set back to unsubscribed with Squarespace's opt-out (also removed from the list)`, action: all ? null : UNFIXED_ACTION };
  await sb.from('marketing_segment_exports').update({ status, load_result: load, status_history: [...(exp.status_history || []), { status, at, by: 'collector (Alan\'s PC)', note: load.fix_note }] }).eq('export_id', exportId);
  return { status, fixed: fixed.length, flipped: flipped.length };
}

/** Just before the send: everyone imported must still be subscribed, unsuppressed and not a flip. */
export async function presendCheck(sb, exportId) {
  const exp = await loadExport(sb, exportId);
  if (!exp.sqs_list_id) throw new Error('load the snapshot into a Squarespace list first');
  const members = await selectAll(sb, 'marketing_segment_export_members', 'person_id, email, precheck_state, postcheck_state', (q) => q.eq('export_id', exportId));
  const c = await consentNow(sb);
  const rows = members.filter((m) => IMPORTED.includes(m.precheck_state)).map((m) => ({ ...m, reason: presendVerdict(m, c) }));
  const nowFixed = rows.filter((r) => r.reason === REMOVED && r.postcheck_state === 'flipped_by_import').map((r) => ({ ...r, postcheck_state: 'flipped_fixed' }));
  await setMemberStates(sb, exportId, nowFixed, 'postcheck_state');
  const inList = rows.filter((r) => r.reason !== REMOVED);
  const fails = inList.filter((r) => r.reason);
  const result = { result: fails.length ? 'FAIL' : 'PASS', at: new Date().toISOString(), checked: inList.length, opted_out_after_flip: rows.length - inList.length, failures: tally(fails, 'reason'), people: fails.map((f) => ({ person_id: f.person_id, reason: f.reason })) };
  const unblock = exp.status === 'blocked_do_not_send' && !rows.some((r) => r.reason === FLIP_FAIL);
  const presendLog = [...(exp.load_result?.presend_log || []), { at: result.at, result: result.result }].slice(-PRESEND_LOG_MAX);
  const patch = { presend_at: result.at, presend_result: result, load_result: { ...(exp.load_result || {}), presend_log: presendLog }, ...(unblock ? { status: 'loaded', status_history: [...(exp.status_history || []), { status: 'loaded', at: result.at, by: 'pre-send check', note: 'everyone the import switched on is unsubscribed again' }] } : {}) };
  await sb.from('marketing_segment_exports').update(patch).eq('export_id', exportId);
  return result;
}

const REMOVED = 'removed';
const FLIP_FAIL = 'consent switched on by the import';
/** null = fine to send; REMOVED = flipped by the import but opted out again (Squarespace also took them off the list). */
function presendVerdict(m, c) {
  if (m.postcheck_state === 'flipped_fixed') return REMOVED;
  if (m.postcheck_state === 'flipped_by_import') return c.byEmail.get(m.email)?.accepts_marketing ? FLIP_FAIL : REMOVED;
  const s = stateOf(m.email, c);
  return s === 'pass' ? null : s;
}

export function presendState(exp, now = Date.now()) {
  if (!exp?.presend_at) return { state: 'not_checked' };
  const age = (now - Date.parse(exp.presend_at)) / 60000;
  if (exp.presend_result?.result !== 'PASS') return { state: 'fail', at: exp.presend_at };
  return age <= PRESEND_VALID_MIN ? { state: 'pass', at: exp.presend_at, minutes_left: Math.floor(PRESEND_VALID_MIN - age) } : { state: 'not_checked', expired_at: exp.presend_at };
}

/** The latest Pre-send PASS in the 30 minutes before a send, or null (the send skipped the rule). */
export function passBefore(exp, sentOn) {
  const sent = Date.parse(sentOn);
  const latest = exp.presend_at ? [{ at: exp.presend_at, result: exp.presend_result?.result }] : [];
  const inWindow = (x) => x.result === 'PASS' && sent - Date.parse(x.at) >= 0 && sent - Date.parse(x.at) <= PRESEND_VALID_MIN * 60000;
  const ok = [...(exp.load_result?.presend_log || []), ...latest].filter(inWindow).map((x) => x.at).sort();
  return ok.length ? ok[ok.length - 1] : null;
}

/** After a send: campaign recipients reconciled against the people who passed for that list, and whether a PASS preceded it. */
export async function reconcileSends(sb) {
  const exps = (await selectAll(sb, 'marketing_segment_exports', 'export_id, list_name, sqs_list_id, is_test, presend_at, presend_result, load_result', (q) => q.not('sqs_list_id', 'is', null)));
  if (!exps.length) return { checked: 0, flagged: 0, rows: [] };
  const camps = await selectAll(sb, 'sqs_email_campaigns', 'email_id, subject, sent_on, mailing_list_names');
  const suppressed = new Set((await selectAll(sb, 'marketing_suppression', 'email_hash, resolved_at')).filter((s) => !s.resolved_at).map((s) => s.email_hash));
  const rows = [];
  for (const e of exps) {
    for (const c of camps.filter((x) => (x.mailing_list_names || []).includes(e.list_name))) {
      const ok = new Set((await selectAll(sb, 'marketing_segment_export_members', 'email, precheck_state, postcheck_state', (q) => q.eq('export_id', e.export_id))).filter((m) => m.precheck_state === 'pass' && m.postcheck_state !== 'flipped_by_import').map((m) => m.email));
      const sent = await selectAll(sb, 'sqs_email_events', 'email', (q) => q.eq('email_id', c.email_id).eq('event_type', 'DELIVERED'));
      const bad = sent.filter((s) => !ok.has(s.email) || suppressed.has(emailHash(s.email)));
      rows.push({ export_id: e.export_id, list_name: e.list_name, is_test: !!e.is_test, email_id: c.email_id, subject: c.subject, sent_on: c.sent_on, recipients: sent.length, flagged: bad.length, pass_before: passBefore(e, c.sent_on) });
    }
  }
  const noPass = rows.filter((r) => !r.is_test && !r.pass_before).length;
  return { checked: rows.length, flagged: rows.reduce((a, r) => a + r.flagged, 0), no_pass: noPass, rows };
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
