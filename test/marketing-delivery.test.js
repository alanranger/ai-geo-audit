/**
 * Email capacity + Scheduled & planned delivery (question 2026-11-08 build-email-capacity-and-scheduled-delivery) on
 * synthetic fixtures: one reservation per delivery (estimate → snapshot → schedule replaces), unbudgeted / unallocated
 * items, the reset-instant split, release only on meter reconciliation or confirmed cancellation, failed reads keep
 * reservations, linking / edits / gone on the Scheduled-tab ingest, and the browser capacity merge.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { capacityOf, cycleOf, cycleSide, reservationOf } from '../lib/marketing/delivery-reserve.mjs';
import { deliveryView, planPatch, readState } from '../lib/marketing/delivery.mjs';
import { changesOf, ingestScheduled, linkOf, liveCandidates } from '../lib/marketing/delivery-schedule.mjs';
import { meterView } from '../lib/marketing/meter.mjs';

const RESET = '2026-11-12T12:51:47.184Z';
const NOW = new Date('2026-11-08T13:00:00Z');
const meter = (over = {}) => ({ captured_at: '2026-11-08T12:54:13Z', cycle_reset_at: RESET, quota_emails: 5000, used_emails: 2437, ...over });
const PNM = { campaign_key: 'theme|pnm', kind: 'theme', title: 'Pick n Mix', stage: 'scheduled', reserved_sends: 127, export_id: 'x-pnm', audience: 'segments', window_end: '2026-12-15', scheduled_for: '2026-11-10T10:00:00Z', scheduled_recipients: 127, schedule_evidence: 'operator_verified', schedule_evidence_by: 'Alan via GPT', sqs_draft_id: 'd-pnm' };
const PNM_EXPORT = { export_id: 'x-pnm', campaign_key: 'theme|pnm', list_name: 'ARP | PnM', eligible_count: 126, status: 'loaded', sqs_list_id: 'L1', load_result: { list_count: '127' }, owner: { included: true, count: 0, business_copy: 1 } };
const PNM_SCHED = { email_id: 'd-pnm', subject: 'Pick N Mix is back', scheduled_for: '2026-11-10T10:00:00Z', mailing_list_ids: ['L1'], mailing_list_names: ['ARP | PnM'], recipients: 127, recipients_basis: 'single_list_count', state: 'scheduled', collected_at: '2026-11-08T12:54:14Z', campaign_key: 'theme|pnm', link_state: 'linked', link_basis: 'draft_id+list_id', link_candidates: ['theme|pnm'] };
const view = (inputs, est = {}, m = meter()) => deliveryView(m, { campaigns: [], exports: [], schedules: [], sent: [], runs: [], ...inputs }, est, NOW);

test('live state: Pick n Mix 127 committed, free after commitments 2,436, next cycle from Thu 12 Nov 12:51 with 0 committed', () => {
  const v = view({ campaigns: [PNM], exports: [PNM_EXPORT], schedules: [PNM_SCHED] });
  const c = v.capacity;
  assert.deepEqual([c.used, c.quota, c.remaining, c.committed, c.free_after_commitments, c.provisional, c.projected_free], [2437, 5000, 2563, 127, 2436, 0, 2436]);
  assert.equal(c.free_after_commitments, 5000 - 2437 - 127);
  assert.deepEqual([c.next_cycle.starts_at, c.next_cycle.allowance, c.next_cycle.committed], [RESET, 5000, 0]);
  const d = v.deliveries[0];
  assert.deepEqual([d.stage, d.amount, d.amount_from, d.bucket, d.side, d.evidence.kind], ['scheduled', 127, 'squarespace_schedule', 'committed', 'current', 'seen']);
  assert.equal(d.sent, null, 'a draft / provider id is never sent evidence');
});

test('estimate → snapshot → Squarespace schedule replaces the amount, never adds', () => {
  const rec = { ...PNM, stage: 'approved', export_id: null, scheduled_for: null, schedule_evidence: null, reserved_sends: 0 };
  const est = view({ campaigns: [rec] }, { 'theme|pnm': 140 });
  assert.deepEqual([est.capacity.committed, est.capacity.provisional, est.deliveries[0].stage], [0, 0, 'estimate'], 'no time yet: unallocated, provisional');
  assert.equal(est.capacity.unallocated.provisional, 140);
  const withTime = view({ campaigns: [{ ...rec, scheduled_for: '2026-11-10T10:00:00Z' }] }, { 'theme|pnm': 140 });
  assert.deepEqual([withTime.capacity.committed, withTime.capacity.provisional], [0, 140]);
  const snap = view({ campaigns: [{ ...rec, export_id: 'x-pnm', scheduled_for: '2026-11-10T10:00:00Z' }], exports: [{ ...PNM_EXPORT, status: 'pending_import', load_result: null }] }, { 'theme|pnm': 140 });
  assert.deepEqual([snap.capacity.committed, snap.capacity.provisional, snap.deliveries[0].stage], [127, 0, 'snapshot'], '126 clients + 1 business copy, estimate dropped');
  const sched = view({ campaigns: [{ ...PNM }], exports: [PNM_EXPORT], schedules: [{ ...PNM_SCHED, recipients: 130 }] }, { 'theme|pnm': 140 });
  assert.deepEqual([sched.capacity.committed, sched.deliveries.length], [130, 1], 'the schedule replaces the snapshot: 130, not 127 + 130');
  assert.deepEqual(reservationOf({ provider: { state: 'scheduled', recipients: null }, snapshot: { amount: 127 } }), { stage: 'scheduled', amount: 127, amount_from: 'snapshot' });
});

test('no audience = UNBUDGETED (never 0) and projected is incomplete; no time on the reset day = unallocated', () => {
  const weekly = { campaign_key: 'email|2026-11-09', kind: 'weekly_email', title: 'Weekly', stage: 'proposed', window_start: '2026-11-12' };
  const v = view({ campaigns: [PNM, weekly], exports: [PNM_EXPORT], schedules: [PNM_SCHED] });
  const w = v.deliveries.find((d) => d.key === 'email|2026-11-09');
  assert.deepEqual([w.stage, w.amount, w.bucket, w.side], ['unbudgeted', null, 'unbudgeted', 'unallocated']);
  assert.deepEqual([v.capacity.committed, v.capacity.missing_audiences, v.capacity.projected_incomplete], [127, 1, true]);
  const c = cycleOf(RESET);
  const today = '2026-11-08';
  assert.equal(cycleSide({ send_day: '2026-11-11' }, c, today), 'current');
  assert.equal(cycleSide({ send_day: '2026-11-12' }, c, today), 'unallocated', 'never assumes midnight');
  assert.equal(cycleSide({ send_day: '2026-11-19' }, c, today), 'next');
  assert.equal(cycleSide({ send_at: '2026-11-12T12:51:00Z' }, c, today), 'current');
  assert.equal(cycleSide({ send_at: '2026-11-12T12:52:00Z' }, c, today), 'next');
  assert.equal(cycleSide({}, c, today), 'unallocated');
});

test('sent: still reserved until a meter read after the send (pending reconciliation), then released', () => {
  const rec = { ...PNM, stage: 'sent', sqs_email_id: 'd-pnm' };
  const sent = [{ email_id: 'd-pnm', sent_on: '2026-11-10T10:00:05Z', message_count: 127 }];
  const before = view({ campaigns: [rec], exports: [PNM_EXPORT], sent }, {}, meter({ captured_at: '2026-11-10T09:00:00Z' }));
  assert.deepEqual([before.deliveries[0].release, before.deliveries[0].bucket, before.capacity.committed, before.capacity.pending_reconciliation], ['pending_reconciliation', 'committed', 127, 127]);
  const after = view({ campaigns: [rec], exports: [PNM_EXPORT], sent }, {}, meter({ captured_at: '2026-11-10T11:00:00Z', used_emails: 2564 }));
  assert.deepEqual([after.deliveries[0].release, after.capacity.committed, after.capacity.free_after_commitments], ['released', 0, 2436]);
});

test('cancellation releases only after Squarespace no longer lists the schedule', () => {
  const rec = { ...PNM, stage: 'cancelled' };
  const still = view({ campaigns: [rec], exports: [PNM_EXPORT], schedules: [PNM_SCHED] });
  assert.deepEqual([still.deliveries[0].release, still.capacity.committed], ['cancel_unconfirmed', 127]);
  assert.ok(still.warnings.some((w) => /not confirmed|still lists it/.test(w.text)));
  const gone = view({ campaigns: [rec], exports: [PNM_EXPORT], schedules: [{ ...PNM_SCHED, state: 'gone', gone_at: '2026-11-09T08:00:00Z' }] });
  assert.deepEqual([gone.deliveries[0].release, gone.capacity.committed], ['released', 0]);
});

test('failed read: nothing posted, reservations kept from the last good read, warning says so', async () => {
  const runs = [{ kind: 'collector:scheduled', status: 'failed', started_at: '2026-11-08T13:00:00Z', finished_at: '2026-11-08T13:00:10Z', error: 'INCOMPLETE scheduled list 0/1' }, { kind: 'collector:scheduled', status: 'ok', started_at: '2026-11-08T12:54:00Z', finished_at: '2026-11-08T12:54:14Z' }];
  const v = view({ campaigns: [PNM], exports: [PNM_EXPORT], schedules: [PNM_SCHED], runs });
  assert.equal(v.capacity.committed, 127);
  assert.equal(v.read.failed_since_ok, true);
  assert.ok(v.warnings.some((w) => /reservations kept/.test(w.text)));
  assert.equal(readState([], NOW.getTime()).state, 'never_read');
  await assert.rejects(ingestScheduled(fakeDb(), { complete: false, emails: [] }), /complete: true/);
});

test('overage: red only when committed this cycle exceeds what the provider has left, with the exact amount', () => {
  const v = view({ campaigns: [PNM], exports: [PNM_EXPORT], schedules: [PNM_SCHED] }, {}, meter({ used_emails: 4900 }));
  assert.deepEqual([v.capacity.free_after_commitments, v.capacity.overage], [-27, 27]);
  assert.ok(v.warnings.some((w) => w.level === 'red' && /27 over/.test(w.text)));
  const ok = view({ campaigns: [PNM], exports: [PNM_EXPORT], schedules: [PNM_SCHED] });
  assert.equal(ok.warnings.filter((w) => w.level === 'red').length, 0);
  const prov = capacityOf({ quota: 5000, used: 4900 }, [{ bucket: 'provisional', amount: 150, side: 'current' }], cycleOf(RESET));
  assert.deepEqual([prov.overage, prov.projected_overage], [0, 50], 'a provisional shortfall is not red');
});

test('Scheduled-tab links by ids: one match linked, two ambiguous (budgeted once, flagged), none unlinked', () => {
  const row = { email_id: 'e1', mailing_list_ids: ['L1'] };
  assert.equal(linkOf(row, [{ campaign_key: 'theme|pnm', sqs_draft_id: 'e1' }], [{ sqs_list_id: 'L1', campaign_key: 'theme|pnm', status: 'loaded' }], null).link_basis, 'draft_id+list_id');
  const amb = linkOf(row, [{ campaign_key: 'a', sqs_draft_id: 'e1' }], [{ sqs_list_id: 'L1', campaign_key: 'b', status: 'loaded' }], null);
  assert.deepEqual([amb.link_state, amb.link_candidates], ['ambiguous', ['a', 'b']]);
  assert.equal(linkOf(row, [], [], null).link_state, 'unlinked');
  assert.equal(linkOf(row, [], [], { link_state: 'external', link_basis: 'manual', campaign_key: null }).link_state, 'external', 'a manual decision is kept');
  const v = view({ campaigns: [{ ...PNM, sqs_draft_id: null }], exports: [PNM_EXPORT], schedules: [{ ...PNM_SCHED, link_state: 'ambiguous', campaign_key: null, link_candidates: ['theme|pnm', 'b'] }] });
  const review = v.deliveries.filter((d) => d.review);
  assert.equal(review.length, 1, 'the ambiguous schedule is one delivery, not one per candidate');
  assert.ok(v.warnings.some((w) => /not matched to a campaign/.test(w.text)));
});

test('a cancelled record is not a link candidate: the draft id moved to the live record links cleanly (8 Nov Norfolk case)', () => {
  const camps = [{ campaign_key: 'event|norfolk', stage: 'cancelled', sqs_draft_id: 'e1' }, { campaign_key: 'theme|norfolk-8nov', stage: 'scheduled', sqs_draft_id: 'e1' }];
  const exps = [{ sqs_list_id: 'L9', campaign_key: 'theme|norfolk-8nov', status: 'loaded' }, { sqs_list_id: 'L9', campaign_key: 'event|norfolk', status: 'blocked' }];
  const c = liveCandidates(camps, exps);
  const l = linkOf({ email_id: 'e1', mailing_list_ids: ['L9'] }, c.campaigns, c.exports, null);
  assert.deepEqual([l.link_state, l.campaign_key, l.link_basis], ['linked', 'theme|norfolk-8nov', 'draft_id+list_id']);
  assert.equal(linkOf({ email_id: 'e1', mailing_list_ids: ['L9'] }, camps, exps, null).link_state, 'ambiguous', 'without the filter it was ambiguous');
});

test('ingest: upsert + link, an edit is recorded, a schedule missing from a later complete read becomes gone (kept)', async () => {
  const db = fakeDb({ strategy_campaigns: [{ campaign_key: 'theme|pnm', sqs_draft_id: 'd-pnm', sqs_email_id: null }], marketing_segment_exports: [{ export_id: 'x', campaign_key: 'theme|pnm', sqs_list_id: 'L1', status: 'loaded' }] });
  const email = { email_id: 'd-pnm', subject: 'PnM', scheduled_for: '2026-11-10T10:00:00Z', mailing_list_ids: ['L1'], mailing_list_names: ['ARP | PnM'], recipients: 127, recipients_basis: 'single_list_count' };
  const r1 = await ingestScheduled(db, { complete: true, read_at: '2026-11-08T12:54:00Z', emails: [email] });
  assert.deepEqual([r1.linked, db.t.sqs_scheduled_emails[0].link_basis], [1, 'draft_id+list_id']);
  const r2 = await ingestScheduled(db, { complete: true, read_at: '2026-11-09T09:00:00Z', emails: [{ ...email, scheduled_for: '2026-11-10T11:00:00Z' }] });
  const row = db.t.sqs_scheduled_emails[0];
  assert.deepEqual([r2.edited, row.changed_at, row.history.at(-1).event], [1, '2026-11-09T09:00:00.000Z', 'edited']);
  assert.deepEqual(changesOf({ scheduled_for: '2026-11-10T10:00:00Z' }, { scheduled_for: '2026-11-10T10:00:00Z' }), []);
  const r3 = await ingestScheduled(db, { complete: true, read_at: '2026-11-09T10:00:00Z', emails: [] });
  assert.deepEqual([r3.gone, db.t.sqs_scheduled_emails.length, db.t.sqs_scheduled_emails[0].state], [1, 1, 'gone']);
});

test('mismatch between the record time and Squarespace\'s time is an amber warning; nothing is rescheduled', () => {
  const v = view({ campaigns: [PNM], exports: [PNM_EXPORT], schedules: [{ ...PNM_SCHED, scheduled_for: '2026-11-10T11:00:00Z' }] });
  assert.ok(v.warnings.some((w) => w.level === 'amber' && /record says/.test(w.text) && /never reschedules/.test(w.action)));
});

test('initiative + purpose come from the quarter-plan links when present (delivery link first), else nothing is shown', () => {
  const links = [{ ref_type: 'campaign', ref_key: 'theme|pnm', initiative_key: 'q1', role: 'primary', purpose_primary: null }, { ref_type: 'delivery', ref_key: 'send|theme|pnm', initiative_key: 'q1', role: 'primary', purpose_primary: 'sell', purpose_secondary: ['nurture'] }, { ref_type: 'delivery', ref_key: 'step|2026-11-09|LinkedIn|2026-11-11', initiative_key: 'q1', role: 'primary', purpose_primary: 'educate' }];
  const v = view({ campaigns: [PNM, { ...PNM, campaign_key: 'theme|other', export_id: null }], exports: [PNM_EXPORT], schedules: [PNM_SCHED], links, initiatives: [{ initiative_key: 'q1', title: 'Pick n Mix plans' }] });
  assert.deepEqual([v.deliveries[0].initiative, v.deliveries[0].purpose], ['Pick n Mix plans', ['sell', 'nurture']]);
  assert.deepEqual([v.deliveries[1].initiative, v.deliveries[1].purpose], [null, null]);
  assert.deepEqual(v.step_tags['step|2026-11-09|LinkedIn|2026-11-11'].purpose, ['educate']);
});

const NORFOLK = { campaign_key: 'event|2026-11-20|/norfolk', kind: 'event', title: 'Norfolk last places', stage: 'drafted', export_id: 'x-nor', sqs_draft_id: '6af06c3b60d4554034f330ba', planned_send_on: '2026-11-08', window_end: '2026-11-20' };
const NORFOLK_EXPORT = { export_id: 'x-nor', campaign_key: null, list_name: 'ARP | Norfolk150', eligible_count: 313, status: 'blocked', sqs_list_id: null, load_result: null, owner: { included: true, count: 0, business_copy: 1 } };
const WEEKLY = { campaign_key: 'email|2026-11-09', kind: 'weekly_email', title: 'Weekly 12 Nov', stage: 'proposed', window_start: '2026-11-12', scheduled_for: '2026-11-12T17:30:00Z', estimate_sends: 543, estimate_as_of: '2026-11-08', estimate_rule: 'opened in 6 months, Norfolk bookers out, + business copy', event_keys: ['2026-11-20|/norfolk', '2026-11-28|/macro'] };

test('Norfolk + weekly (8 Nov): 2,563 − 127 committed − 314 provisional = 2,122 projected; weekly 543 estimate in the next cycle', () => {
  const v = view({ campaigns: [PNM, NORFOLK, WEEKLY], exports: [PNM_EXPORT, NORFOLK_EXPORT], schedules: [PNM_SCHED] });
  const c = v.capacity;
  assert.deepEqual([c.remaining, c.committed, c.free_after_commitments, c.provisional, c.projected_free, c.projected_incomplete], [2563, 127, 2436, 314, 2122, false]);
  assert.deepEqual([c.next_cycle.committed, c.next_cycle.provisional, c.next_cycle.free_after_commitments], [0, 543, 5000]);
  const nor = v.deliveries.find((d) => d.key === NORFOLK.campaign_key);
  assert.deepEqual([nor.stage, nor.amount, nor.bucket, nor.side, nor.sent], ['review_snapshot', 314, 'provisional', 'current', null], 'held review snapshot: provisional, draft id is not sent evidence');
  const wk = v.deliveries.find((d) => d.key === WEEKLY.campaign_key);
  assert.deepEqual([wk.stage, wk.amount, wk.bucket, wk.side, wk.estimate.live, wk.estimate.as_of], ['estimate', 543, 'provisional', 'next', false, '2026-11-08']);
  const scheduled = view({ campaigns: [PNM, NORFOLK, WEEKLY], exports: [PNM_EXPORT, NORFOLK_EXPORT], schedules: [PNM_SCHED, { ...PNM_SCHED, email_id: NORFOLK.sqs_draft_id, campaign_key: NORFOLK.campaign_key, scheduled_for: '2026-11-08T18:00:00Z', recipients: 314, mailing_list_ids: ['L2'] }] });
  assert.deepEqual([scheduled.deliveries.length, scheduled.capacity.committed, scheduled.capacity.provisional, scheduled.capacity.projected_free], [3, 441, 0, 2122], 'scheduled later: the same reservation moves to committed, never doubled');
});

test('an intended time recorded only in stage_history places the send in its cycle (not evidence, not unallocated)', () => {
  const gpt = { campaign_key: 'theme|x-12nov', kind: 'theme', title: 'X', stage: 'drafted', export_id: 'x-x', stage_history: [{ stage: 'drafted', at: '2026-11-08T13:23:33Z', scheduled_for: '2026-11-12T10:00:00Z', note: 'not yet confirmed in Squarespace' }] };
  const v = view({ campaigns: [PNM, gpt], exports: [PNM_EXPORT, { export_id: 'x-x', eligible_count: 381, status: 'pending_import', owner: { included: true, count: 0, business_copy: 1 } }], schedules: [PNM_SCHED] });
  const d = v.deliveries.find((x) => x.key === 'theme|x-12nov');
  assert.deepEqual([d.stage, d.amount, d.bucket, d.side, d.evidence], ['snapshot', 382, 'committed', 'current', null]);
  assert.equal(v.capacity.committed, 127 + 382);
});

test('same-day snapshots with (nearly) the same people are flagged as a possible duplicate; neither is changed', () => {
  const ids = (n, from = 0) => new Set(Array.from({ length: n }, (_, i) => `p${i + from}`));
  const recut = { campaign_key: 'theme|norfolk-8nov', kind: 'theme', title: 'Norfolk recut', stage: 'drafted', export_id: 'x-recut', stage_history: [{ stage: 'drafted', at: '2026-11-08T13:23:28Z', scheduled_for: '2026-11-08T17:00:00Z' }] };
  const other = { ...recut, campaign_key: 'theme|other-8nov', title: 'Other', export_id: 'x-other' };
  const exports = [PNM_EXPORT, NORFOLK_EXPORT, { export_id: 'x-recut', eligible_count: 310, status: 'pending_import', owner: { included: true, count: 0, business_copy: 1 } }, { export_id: 'x-other', eligible_count: 230, status: 'pending_import', owner: { included: true, count: 0, business_copy: 1 } }];
  const members = new Map([['x-nor', ids(314)], ['x-recut', ids(311)], ['x-other', ids(231, 313)]]);
  const v = view({ campaigns: [PNM, NORFOLK, recut, other], exports, schedules: [PNM_SCHED], members });
  const dup = v.warnings.filter((w) => /Possible duplicate/.test(w.text));
  assert.equal(dup.length, 1, 'only the Norfolk pair (311 of 311 shared); 1 shared with the other email is not a duplicate');
  assert.match(dup[0].text, /311 shared of 314 \/ 311/);
  assert.equal(v.capacity.committed + v.capacity.provisional, 127 + 311 + 231 + 314, 'flagged, still both counted until a person decides');
});

test('campaign-plan fields: labelled estimate, planned day, app-intended time; bad ids refused; never schedule evidence', () => {
  const p = planPatch({ sqs_draft_id: '6af06c3b60d4554034f330ba', planned_send_on: '2026-11-08', scheduled_for: '2026-11-12T17:30:00Z', estimate: { sends: 543, as_of: '2026-11-08', rule: 'r' }, export_id: 'x' });
  assert.deepEqual(p, { sqs_draft_id: '6af06c3b60d4554034f330ba', planned_send_on: '2026-11-08', scheduled_for: '2026-11-12T17:30:00.000Z', scheduled_tz: 'Europe/London', estimate_sends: 543, estimate_as_of: '2026-11-08', estimate_rule: 'r', export_id: 'x' });
  assert.equal('schedule_evidence' in p, false);
  assert.throws(() => planPatch({ sqs_draft_id: 'nope' }), /24 hex/);
  assert.throws(() => planPatch({ scheduled_for: '2026-11-12' }), /date-time/);
  assert.throws(() => planPatch({ estimate: { sends: -1 } }), /whole number/);
  assert.deepEqual(planPatch({ estimate: null }), { estimate_sends: null, estimate_as_of: null, estimate_rule: null });
});

test('legacy meterView fields equal the new committed / free-after-commitments lines', () => {
  const m = meterView(meter(), [PNM], [], NOW, { exports: [PNM_EXPORT], schedules: [PNM_SCHED] });
  assert.deepEqual([m.reserved, m.after_reservations, m.capacity.committed], [127, 2436, 127]);
});

test('browser merge: an audience-less weekly email on the reset day adds "+1 audience not chosen", projected incomplete', () => {
  const win = loadBrowser();
  const d = { meter: { capacity: view({ campaigns: [PNM], exports: [PNM_EXPORT], schedules: [PNM_SCHED] }).capacity, deliveries: [{ campaign_key: 'theme|pnm' }] } };
  const s = { campaign: { campaigns: [
    { campaign_key: 'email|2026-11-09', kind: 'weekly_email', stage: 'proposed', audience: null, window_start: '2026-11-12', title: 'Weekly 9 Nov' },
    { campaign_key: 'email|2026-11-16', kind: 'weekly_email', stage: 'proposed', audience: null, window_start: '2026-11-19', title: 'Weekly 16 Nov' },
    { campaign_key: 'email|2020-01-06', kind: 'weekly_email', stage: 'proposed', audience: null, window_start: '2020-01-09', title: 'Old' }
  ] } };
  const c = win.mkCapacity(d, s);
  assert.deepEqual([c.missing_audiences, c.projected_incomplete, c.next_cycle.unbudgeted, c.backlog.length, c.unchosen[0].side], [1, true, 1, 1, 'unallocated']);
  const labels = [...win.mkCapacityRows(c).map((r) => r[0])];
  assert.deepEqual(labels, ['Used (Squarespace meter)', 'Provider remaining', 'Committed (scheduled / frozen)', 'Free after commitments', 'Provisional planned', 'Projected free after all plans', 'Next cycle (from Thu 12 Nov 12:51 GMT)']);
  assert.match(win.mkCapacityRows(c)[4][1], /\+ 1 audience not chosen/);
  assert.match(win.mkCapacityRows(c)[5][1], /2,436 · .*incomplete/);
});

/** Minimal in-memory Supabase stand-in for the ingest (select / not / upsert / update.eq). */
function fakeDb(seed = {}) {
  const t = { sqs_scheduled_emails: [], strategy_campaigns: [], marketing_segment_exports: [], ...structuredClone(seed) };
  const done = (data) => Promise.resolve({ data, error: null });
  return {
    t,
    from(name) {
      const rows = () => t[name];
      const q = { then: (ok, bad) => done(rows().map((r) => ({ ...r }))).then(ok, bad), not: () => q, eq: () => q };
      return {
        select: () => q,
        upsert: (list) => { for (const r of list) { const i = rows().findIndex((x) => x.email_id === r.email_id); if (i >= 0) rows()[i] = { ...rows()[i], ...r }; else rows().push({ ...r }); } return done(null); },
        update: (patch) => {
          const conds = [];
          const u = { eq: (k, v) => { conds.push([k, v]); return u; }, then: (ok, bad) => { for (const r of rows()) if (conds.every(([k, v]) => r[k] === v)) Object.assign(r, patch); return done(null).then(ok, bad); } };
          return u;
        }
      };
    }
  };
}

function loadBrowser() {
  const store = {};
  const win = { localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } } };
  const document = { getElementById: () => null, head: { insertAdjacentHTML: () => {} } };
  const ctx = vm.createContext({ window: win, document, localStorage: win.localStorage, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, console });
  vm.runInContext(fs.readFileSync(new URL('../lib/marketing-delivery.js', import.meta.url), 'utf8'), ctx);
  return win;
}
