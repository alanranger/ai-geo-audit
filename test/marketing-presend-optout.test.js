/**
 * QUESTION-2026-11-12 presend-check-later-unsubscribes: someone in a frozen list who opted out in Squarespace after the
 * list was saved is an expected removal (PASS with a note) only when Squarespace's own current recipient count already
 * leaves them out (native = manifest − opt-outs); otherwise FAIL. Flip cases unchanged. The check writes only its own
 * result on the export (the previous full receipt is kept); no consent, contact or audience field changes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { emailHash } from '../lib/marketing/store.mjs';
import { presendCheck, presendResult, reconcileOptOuts } from '../lib/marketing/list-load.mjs';

const AT = '2026-11-12T17:30:00.000Z';
const OUT = 'p-optout';
/** 576 people in the frozen list (575 + business copy); OUT has since unsubscribed from a campaign in Squarespace. */
function cohort(size = 576, extra = []) {
  const members = Array.from({ length: size - 1 }, (_, i) => ({ person_id: `p${i}`, email: `p${i}@x.test`, precheck_state: 'pass', postcheck_state: null }));
  members.push({ person_id: OUT, email: 'out@x.test', precheck_state: 'pass', postcheck_state: null }, ...extra);
  const profiles = members.map((m) => ({ profile_id: m.person_id, email: m.email, accepts_marketing: m.person_id !== OUT, missing_since: null }));
  return { members, consent: { sync: { subscribed: size - 1 }, byEmail: new Map(profiles.map((p) => [p.email, p])), suppressed: new Set([emailHash('out@x.test')]) } };
}
const verdictRows = (members, c, reason = (m) => {
  const p = c.byEmail.get(m.email);
  if (m.postcheck_state === 'flipped_fixed') return 'removed';
  if (m.postcheck_state === 'flipped_by_import') return p?.accepts_marketing ? 'consent switched on by the import' : 'removed';
  if (c.suppressed.has(emailHash(m.email))) return 'suppressed';
  return p?.accepts_marketing ? null : 'not_subscribed';
}) => members.map((m) => ({ ...m, reason: reason(m) }));
const EXP = { export_id: 'e19nov', status: 'loaded', sqs_list_id: 'L575' };

test('reconcileOptOuts: the rule (native = manifest − opt-outs, no pending import) and every FAIL reason', () => {
  assert.deepEqual(reconcileOptOuts({ checked: 576, optOuts: 1, native: { recipients: 575 } }), { ok: true, note: '1 later opt-out, already excluded by Squarespace (native 575 = manifest 576 − 1)', recipients_now: 575 });
  assert.equal(reconcileOptOuts({ checked: 313, optOuts: 1, native: { recipients: 312 } }).note, '1 later opt-out, already excluded by Squarespace (native 312 = manifest 313 − 1)');
  assert.equal(reconcileOptOuts({ checked: 576, optOuts: 2, native: { recipients: 574 } }).note, '2 later opt-outs, already excluded by Squarespace (native 574 = manifest 576 − 2)');
  const stale = reconcileOptOuts({ checked: 576, optOuts: 1, native: { recipients: 576 } });
  assert.deepEqual([stale.ok, stale.note], [false, '1 later opt-out not reflected in Squarespace\'s count: native 576 ≠ manifest 576 − 1 (575)']);
  assert.equal(reconcileOptOuts({ checked: 576, optOuts: 1, native: null }).ok, false);
  assert.match(reconcileOptOuts({ checked: 576, optOuts: 1, native: null }).note, /no current Squarespace recipient count/);
  assert.match(reconcileOptOuts({ checked: 576, optOuts: 1, native: { recipients: 575 }, importPending: true }).note, /an import of this list is pending/);
  assert.deepEqual(reconcileOptOuts({ checked: 399, optOuts: 0, native: { recipients: 399 } }), { ok: true, note: null, recipients_now: 399 });
});

test('19 Nov: one opt-out after the manifest, native 575 already excludes them → PASS with the note and the native-current number', () => {
  const { members, consent } = cohort();
  const r = presendResult(verdictRows(members, consent), consent, { recipients: 575, collected_at: '2026-11-12T17:13:51Z' }, EXP, AT);
  assert.equal(r.result, 'PASS');
  assert.equal(r.note, '1 later opt-out, already excluded by Squarespace (native 575 = manifest 576 − 1)');
  assert.deepEqual([r.checked, r.native_recipients, r.recipients_now, r.later_opt_outs, r.later_opt_outs_excluded], [576, 575, 575, 1, 1]);
  assert.deepEqual(r.excluded_people, [{ person_id: OUT, reason: 'opted out later; already excluded by Squarespace' }]);
  assert.deepEqual([r.failures, r.people], [{}, []]);
});

test('an opt-out Squarespace\'s count does not reflect → FAIL (stale native 576, or no native count read)', () => {
  const { members, consent } = cohort();
  for (const native of [{ recipients: 576 }, null]) {
    const r = presendResult(verdictRows(members, consent), consent, native, EXP, AT);
    assert.equal(r.result, 'FAIL');
    assert.deepEqual(r.people, [{ person_id: OUT, reason: 'suppressed' }]);
    assert.equal(r.later_opt_outs_excluded, 0);
    assert.equal(r.recipients_now, null);
  }
});

test('still FAIL: suppressed but re-subscribed in Squarespace (Squarespace would send), or an import of the list pending', () => {
  const { members, consent } = cohort();
  consent.byEmail.get('out@x.test').accepts_marketing = true;
  const resub = presendResult(verdictRows(members, consent), consent, { recipients: 575 }, EXP, AT);
  assert.deepEqual([resub.result, resub.later_opt_outs, resub.people[0].person_id], ['FAIL', 0, OUT]);
  const c2 = cohort();
  const pending = presendResult(verdictRows(c2.members, c2.consent), c2.consent, { recipients: 575 }, { ...EXP, status: 'load_queued' }, AT);
  assert.equal(pending.result, 'FAIL');
  assert.match(pending.note, /import of this list is pending/);
});

test('flip cases unchanged: a flip still switched on → FAIL; flips set back (flipped_fixed / opted out again) are removed, not counted', () => {
  const flipOn = { person_id: 'p-flip-on', email: 'flipon@x.test', precheck_state: 'pass', postcheck_state: 'flipped_by_import' };
  const flipBack = { person_id: 'p-flip-back', email: 'flipback@x.test', precheck_state: 'pass', postcheck_state: 'flipped_by_import' };
  const fixed = { person_id: 'p-fixed', email: 'fixed@x.test', precheck_state: 'pass', postcheck_state: 'flipped_fixed' };
  const { members, consent } = cohort(10, [flipOn, flipBack, fixed]);
  consent.byEmail.set('flipon@x.test', { email: 'flipon@x.test', accepts_marketing: true });
  consent.byEmail.set('flipback@x.test', { email: 'flipback@x.test', accepts_marketing: false });
  consent.byEmail.set('fixed@x.test', { email: 'fixed@x.test', accepts_marketing: false });
  const r = presendResult(verdictRows(members, consent), consent, { recipients: 10 }, EXP, AT);
  assert.equal(r.result, 'FAIL');
  assert.deepEqual(r.people, [{ person_id: 'p-flip-on', reason: 'consent switched on by the import' }], 'the flip still switched on fails; the reconciled later opt-out (native 10 = 11 − 1) does not');
  assert.equal(r.opted_out_after_flip, 2);
  assert.equal(r.checked, 11);
  const noFlip = cohort(10, [flipBack, fixed]);
  noFlip.consent.byEmail.set('flipback@x.test', { email: 'flipback@x.test', accepts_marketing: false });
  noFlip.consent.byEmail.set('fixed@x.test', { email: 'fixed@x.test', accepts_marketing: false });
  const ok = presendResult(verdictRows(noFlip.members, noFlip.consent), noFlip.consent, { recipients: 9 }, EXP, AT);
  assert.deepEqual([ok.result, ok.checked, ok.opted_out_after_flip, ok.later_opt_outs_excluded], ['PASS', 10, 2, 1]);
});

/** Fake Supabase recording every write: the export, its members, and Squarespace's scheduled read for the list. */
function fakeSb(exp, members, scheduled) {
  const writes = [];
  const from = (table) => {
    const q = { table, filters: [] };
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain, eq: (k, v) => { q.filters.push([k, v]); return chain; }, in: () => chain, contains: () => chain,
      range: async (a) => ({ data: table === 'marketing_segment_export_members' && a === 0 ? members : [], error: null }),
      maybeSingle: async () => ({ data: exp, error: null }),
      update: (row) => { writes.push({ table, row }); return { eq: async () => ({ error: null }), in: async () => ({ error: null }) }; },
      upsert: (row) => { writes.push({ table, row, upsert: true }); return chain; }, insert: (row) => { writes.push({ table, row, insert: true }); return chain; }, delete: () => { writes.push({ table, delete: true }); return chain; },
      then: (ok) => ok({ data: table === 'sqs_scheduled_emails' ? scheduled : [], error: null })
    };
    return chain;
  };
  return { from, writes };
}

test('presendCheck end to end: only the export\'s check result is written; the FAIL receipt is kept; no consent / contact / audience field changes', async () => {
  const { members, consent } = cohort();
  const failReceipt = { result: 'FAIL', at: '2026-11-12T14:37:23.669Z', checked: 576, failures: { suppressed: 1 }, people: [{ person_id: OUT, reason: 'suppressed' }] };
  const exp = { ...EXP, eligible_count: 575, definition_snapshot: { q: 1 }, status_history: [], presend_at: failReceipt.at, presend_result: failReceipt, load_result: { list_count: 576, presend_log: [{ at: '2026-11-11T10:07:13.147Z', result: 'PASS' }, { at: failReceipt.at, result: 'FAIL' }] } };
  const sched = [{ email_id: 'e1', recipients: 575, recipients_basis: 'single_list_count', collected_at: '2026-11-12T17:13:51Z', mailing_list_ids: ['L575'] }];
  const sb = fakeSb(exp, members, sched);
  const native = async () => ({ recipients: 575, collected_at: sched[0].collected_at, email_id: 'e1' });
  const r = await presendCheck(sb, 'e19nov', { consent: async () => consent, native, now: () => AT });
  assert.equal(r.result, 'PASS');
  assert.equal(r.note, '1 later opt-out, already excluded by Squarespace (native 575 = manifest 576 − 1)');
  assert.deepEqual(sb.writes.map((w) => w.table), ['marketing_segment_exports'], 'one write, to the export only (no members, profiles, customer_person, suppression)');
  const row = sb.writes[0].row;
  assert.deepEqual(Object.keys(row).sort(), ['load_result', 'presend_at', 'presend_result']);
  assert.equal(row.load_result.list_count, 576, 'the frozen manifest numbers are untouched');
  assert.deepEqual(row.load_result.presend_log.slice(0, 2), exp.load_result.presend_log, 'earlier log lines kept as they were');
  assert.deepEqual(row.load_result.presend_log[2], { at: AT, result: 'PASS', checked: 576, native: 575, note: r.note });
  assert.deepEqual(row.load_result.presend_receipts, [failReceipt], 'the 14:37 FAIL receipt kept in full, alongside the new result');
  assert.ok(!('eligible_count' in row) && !('definition_snapshot' in row) && !('status' in row));
});

test('a second check does not duplicate the archived receipt', async () => {
  const { members, consent } = cohort();
  const prevPass = { result: 'PASS', at: AT, checked: 576, note: 'x' };
  const exp = { ...EXP, presend_at: AT, presend_result: prevPass, load_result: { presend_receipts: [prevPass], presend_log: [] } };
  const sb = fakeSb(exp, members, []);
  await presendCheck(sb, 'e19nov', { consent: async () => consent, native: async () => ({ recipients: 575 }), now: () => '2026-11-12T17:40:00.000Z' });
  assert.equal(sb.writes[0].row.load_result.presend_receipts.length, 1);
});
