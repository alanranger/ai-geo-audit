/**
 * Tidy-up 2 + reconciliation B1 / B2 / B4 (questions 2026-11-08): a sent email stops being booked once a meter read
 * after its send exists AND the Sent collector has linked it, or on the first meter read ≥ 30 minutes after Squarespace
 * stopped listing the schedule ("released, pending Sent link"); a schedule that left the list after its send time is
 * not "no platform evidence"; owner addresses are never client-frequency breaches; a quarter action moved by its step
 * tick is due on the moved day and is not a dropped duplicate in its original week.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryView } from '../lib/marketing/delivery.mjs';
import { frequencyInputs, frequencyView } from '../lib/marketing/frequency.mjs';
import { applyMovedTicks } from '../lib/strategy-action-evidence.mjs';
import { applyStepStatus } from '../lib/strategy-step-status.mjs';

const RESET = '2026-11-12T12:51:47.184Z';
const meter = (at, used = 2979) => ({ captured_at: at, cycle_reset_at: RESET, quota_emails: 5000, used_emails: used });
const NORFOLK = { campaign_key: 'theme|norfolk-workshops-8nov', kind: 'theme', title: 'Norfolk', stage: 'sent', reserved_sends: 0, actual_sends: 311, sent_on: '2026-11-08', export_id: 'x-n', sqs_draft_id: 'e-n', scheduled_for: '2026-11-08T17:00:00Z', schedule_evidence: 'operator_verified', stage_history: [{ stage: 'scheduled', at: '2026-11-08T13:34:39Z' }, { stage: 'sent', at: '2026-11-08T17:31:59Z' }] };
const EXP = { export_id: 'x-n', eligible_count: 310, status: 'loaded', owner: { included: true, count: 0, business_copy: 1 } };
const GONE = { email_id: 'e-n', campaign_key: NORFOLK.campaign_key, link_state: 'linked', state: 'gone', scheduled_for: '2026-11-08T17:00:00Z', gone_at: '2026-11-08T17:07:55Z', recipients: 311, collected_at: '2026-11-08T16:07:54Z' };
const PNM = { campaign_key: 'theme|pnm', kind: 'theme', title: 'PnM', stage: 'scheduled', export_id: 'x-p', scheduled_for: '2026-11-10T10:00:00Z', schedule_evidence: 'operator_verified' };
const PNM_EXP = { export_id: 'x-p', eligible_count: 126, status: 'loaded', owner: { included: true, count: 0, business_copy: 1 } };
const view = (campaigns, schedules, m, sent = []) => deliveryView(m, { campaigns, exports: [EXP, PNM_EXP], schedules, sent, runs: [{ kind: 'collector:scheduled', status: 'ok', started_at: m.captured_at, finished_at: m.captured_at }] }, {}, new Date('2026-11-08T18:15:00Z'));
const booked = (v) => v.capacity.committed + v.capacity.provisional;

test('8 Nov 17:00 send marked sent by GPT, Sent not collected: booked until a meter read ≥ 30 min after the schedule left, then "released, pending Sent link"', () => {
  const early = view([NORFOLK, PNM], [GONE], meter('2026-11-08T17:07:53Z'));
  const d = early.deliveries[0];
  assert.deepEqual([d.sent.at, d.release, d.bucket, booked(early)], ['2026-11-08T17:00:00.000Z', 'pending_reconciliation', 'committed', 311 + 127], 'send time = the schedule instant, not when it was marked sent');
  const later = view([NORFOLK, PNM], [GONE], meter('2026-11-08T18:12:00Z'));
  const r = later.deliveries[0];
  assert.deepEqual([r.release, r.release_note, r.bucket, booked(later), later.capacity.remaining - booked(later)], ['released', 'released, pending Sent link', 'released', 127, 5000 - 2979 - 127]);
});

test('Sent linked + meter after the send releases (no note); marked sent only, no Sent link and no schedule seen leaving, stays booked', () => {
  const sent = [{ email_id: 'e-n', sent_on: '2026-11-08T17:00:05Z', message_count: 311 }];
  const linked = view([NORFOLK], [], meter('2026-11-08T17:07:53Z'), sent).deliveries[0];
  assert.deepEqual([linked.release, linked.release_note], ['released', null]);
  const marked = view([{ ...NORFOLK, sqs_draft_id: null }], [], meter('2026-11-08T23:00:00Z')).deliveries[0];
  assert.deepEqual([marked.release, marked.bucket], ['pending_reconciliation', 'committed']);
});

test('B2: a record still "scheduled" whose schedule left Squarespace after its send time has evidence, no warning, and is released after 30 minutes', () => {
  const rec = { ...NORFOLK, stage: 'scheduled', actual_sends: null, sent_on: null, stage_history: [{ stage: 'scheduled', at: '2026-11-08T13:34:39Z' }] };
  const v = view([rec], [GONE], meter('2026-11-08T17:07:53Z'));
  assert.equal(v.deliveries[0].evidence.kind, 'schedule_gone_after_send');
  assert.equal(v.warnings.filter((w) => /no platform evidence|no longer lists/.test(w.text)).length, 0);
  assert.equal(view([rec], [GONE], meter('2026-11-08T17:40:00Z')).deliveries[0].release, 'released');
  const unscheduled = view([rec], [{ ...GONE, gone_at: '2026-11-08T16:30:00Z' }], meter('2026-11-08T18:12:00Z'));
  assert.deepEqual([unscheduled.deliveries[0].release, unscheduled.deliveries[0].bucket], [null, 'draft'], 'unscheduled before its time: a draft, not reserved (Alan, 10 Nov), and warned');
  assert.ok(unscheduled.warnings.some((w) => w.level === 'red' && /Not in Squarespace Scheduled — check/.test(w.text)));
});

function fakeSb(tables) {
  const q = (t) => {
    const self = new Proxy({}, { get: (_, k) => {
      if (k === 'then') return (res) => res({ data: tables[t] || [], error: null });
      if (k === 'range') return () => Promise.resolve({ data: tables[t] || [], error: null });
      return () => self;
    } });
    return self;
  };
  return { from: q };
}

test('B1: an owner address (marketing_owner_addresses) getting 3 emails is an owner copy, never a client breach; the client rule is unchanged', async () => {
  const camp = (k, day) => ({ campaign_key: k, stage: 'scheduled', export_id: `x-${k}`, scheduled_for: `${day}T10:00:00Z`, kind: 'theme' });
  const campaigns = [camp('a', '2026-11-09'), camp('b', '2026-11-10'), camp('c', '2026-11-11')];
  const members = campaigns.flatMap((c) => [{ export_id: c.export_id, person_id: 'p-own', email: 'Owner@Example.test' }, { export_id: c.export_id, person_id: 'p1', email: 'client@example.test' }]);
  const sb = fakeSb({ marketing_segment_export_members: members, marketing_owner_addresses: [{ email: 'owner@example.test' }], customer_person: [], sqs_email_campaigns: [] });
  const input = await frequencyInputs(sb, { campaigns, exports: campaigns.map((c) => ({ export_id: c.export_id, owner: { included: true, person_ids: [], business_copy_ids: [] } })) }, '2026-11-08');
  const wk = frequencyView(input, '2026-11-08').weeks['2026-11-09'];
  assert.deepEqual([wk.by_count[3], wk.unapproved_over, wk.owner_copies, wk.level], [1, 1, 3, 'amber'], 'the client with 3 is still a breach; the owner address is 3 owner copies');
});

test('B4: a quarter action moved by its tick is due on the moved day; its old-week register row is not a dropped duplicate', () => {
  const acts = applyMovedTicks([{ id: 14, label: 'Pick n Mix launch newsletter', due_week_start: '2026-11-02', is_ticked: false }, { id: 15, due_week_start: '2026-11-02', is_ticked: true }], new Map([['plan|14', '2026-11-10'], ['plan|15', '2026-11-20']]));
  assert.deepEqual([acts[0].due_week_start, acts[0].planned_due, acts[0].moved_to, acts[1].due_week_start], ['2026-11-10', '2026-11-02', '2026-11-10', '2026-11-02']);
  const weeks = [{ week: '2026-11-02', steps: [] }, { week: '2026-11-09', steps: [{ key: 'plan|14', day: '2026-11-10', scheduled_day: '2026-11-10', channel: 'Quarter action', step: 'Pick n Mix launch newsletter', plan_id: 14 }] }];
  const register = [{ step_key: 'plan|14', week_start: '2026-11-02', scheduled_day: '2026-11-02', channel: 'Quarter action', step: 'Pick n Mix launch newsletter', plan_id: 14 }];
  const ctx = { today: '2026-11-08', ticks: { 'plan|14': { moved_to: '2026-11-10' } }, actionsById: new Map(), sqsById: new Map(), records: [], rows: [] };
  const { carried } = applyStepStatus(weeks, ctx, register);
  assert.deepEqual([weeks[0].steps.length, weeks[1].steps.length, carried.late.length, carried.older.length], [0, 1, 0, 0]);
});
