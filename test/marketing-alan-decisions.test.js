/**
 * Alan's decisions, 8 Nov 2026 (QUESTION-2026-11-08-alan-decisions-exception-snapshots-plansheet-lakedistrict):
 * a per-campaign-per-week approved frequency exception; snapshots freeze people + exactly 1 business copy; the plan
 * sheet ticks only from evidence; a confirmed price replaces the claims with history.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedFor, exceptionRow, frequencyInputs, frequencyView, markApproved } from '../lib/marketing/frequency.mjs';
import { FROZEN_RULE, freezeSet } from '../lib/marketing/exports.mjs';
import { evaluate } from '../lib/marketing/segments.mjs';
import { evidenceHit, evidenceRuleFor, tickChanges } from '../lib/strategy-action-evidence.mjs';
import { manualTickRefusal } from '../api/aigeo/strategy-actions.js';
import { confirmedPricePatch } from '../lib/social-standard/facts.mjs';

const KEYS = ['theme|norfolk-workshops-8nov', 'theme|pick-n-mix-kick-starter-2026-11', 'theme|academy-return-12nov'];
const APPROVAL = { campaign_keys: KEYS, window_from: '2026-11-06', window_to: '2026-11-12', revoked_at: null };

test('approved exception covers exactly the listed campaigns inside its window; revoked or outside = not approved', () => {
  assert.equal(approvedFor({ key: KEYS[1], day: '2026-11-10' }, [APPROVAL]), true);
  assert.equal(approvedFor({ key: 'theme|gifts-engaged-12nov', day: '2026-11-12' }, [APPROVAL]), false, 'not blanket');
  assert.equal(approvedFor({ key: KEYS[1], day: '2026-11-17' }, [APPROVAL]), false, 'other weeks not covered');
  assert.equal(approvedFor({ key: KEYS[1], day: '2026-11-10' }, [{ ...APPROVAL, revoked_at: '2026-11-09T00:00:00Z' }]), false);
  const e = markApproved([{ key: KEYS[0], day: '2026-11-08', exception: false }], [APPROVAL])[0];
  assert.deepEqual([e.exception, e.exception_source], [true, 'approved exception']);
});

test('exception write: validated (1–20 campaigns, ≤ 7-day window, reason, who / when) with an approval history entry', () => {
  const row = exceptionRow({ campaign_keys: KEYS, window_from: '2026-11-06', window_to: '2026-11-12', reason: 'Approved by Alan, 8 Nov 2026, via Claude', approved_by: 'Alan (via Claude)', approved_at: '2026-11-08T20:28:00Z' }, 'Cursor', '2026-11-08T20:40:00Z');
  assert.deepEqual([row.week_start, row.campaign_keys.length, row.history[0].action, row.history[0].by], ['2026-11-09', 3, 'approved', 'Alan (via Claude)']);
  assert.throws(() => exceptionRow({ ...row, campaign_keys: [] }, 'Cursor', 'x'), /never blanket/);
  assert.throws(() => exceptionRow({ campaign_keys: KEYS, window_from: '2026-11-01', window_to: '2026-11-12', reason: 'long enough reason', approved_by: 'A', approved_at: '2026-11-08' }, 'Cursor', 'x'), /at most 7 days/);
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

test('the one client with Norfolk 8 Nov + Pick n Mix 10 Nov + Academy 12 Nov: amber before, ok after the approval', async () => {
  const days = ['2026-11-08', '2026-11-10', '2026-11-12'];
  const campaigns = KEYS.map((k, i) => ({ campaign_key: k, stage: 'scheduled', export_id: `x${i}`, scheduled_for: `${days[i]}T10:00:00Z`, kind: 'theme' }));
  const members = campaigns.map((c) => ({ export_id: c.export_id, person_id: 'p1', email: 'client@example.test' }));
  const base = { marketing_segment_export_members: members, marketing_owner_addresses: [], customer_person: [], sqs_email_campaigns: [] };
  const exports = campaigns.map((c) => ({ export_id: c.export_id, owner: { included: true, person_ids: [], business_copy_ids: [] } }));
  const week = async (tables) => frequencyView(await frequencyInputs(fakeSb(tables), { campaigns, exports }, '2026-11-08'), '2026-11-08').weeks['2026-11-09'];
  const before = await week(base);
  const after = await week({ ...base, marketing_frequency_exceptions: [APPROVAL] });
  assert.deepEqual([before.unapproved_over, before.level], [1, 'amber']);
  assert.deepEqual([after.unapproved_over, after.approved_over, after.level], [0, 1, 'ok']);
});

const live = (i, extra = {}) => ({ person_id: `p${i}`, anchor_key: `email:p${i}@x.test`, facts: { email: `p${i}@x.test`, subscribed: true, profile_state: 'active', ...extra } });
const DEF = { query: { version: 1, root: { type: 'group', match: 'all', items: [{ type: 'cond', field: 'eligible', op: 'is_true', value: null }] } } };
const CTX = { centre: null, today: '2026-11-08', asOf: '2026-11-08', windows: {}, engagementComplete: true, campaigns: null };

test('freeze: engaged = 543 people + 1 business copy = 544 (organisation and second owner address left out; old rule froze 546)', () => {
  const people = [...Array.from({ length: 543 }, (_, i) => live(i)), live('org', { record_type: 'organisation' }), live('biz', { admin: true }), live('own', { owner: true })];
  const r = evaluate(people, [DEF], CTX, { includeOwner: true });
  const f = freezeSet(r);
  assert.equal(r.members.length, 546, 'old freeze');
  assert.deepEqual([f.people, f.business_copy_ids, f.members.length, f.left_out], [543, ['pbiz'], 544, { organisations: 1, owner_addresses: 1 }]);
  assert.match(FROZEN_RULE, /people\+1/);
  const offQuery = freezeSet(evaluate([...people.slice(0, 3), live('biz', { admin: true })], [{ query: { version: 1, root: { type: 'cond', field: 'email_domain', op: 'is', value: 'x.test' } } }], CTX, { includeOwner: true }));
  assert.equal(offQuery.business_copy_ids.length, 1, 'always-on business copy kept once');
});

test('plan sheet: evidence rule (7-day follow-up email collected on or after 23 Nov); stale tick clears, manual PATCH refused', () => {
  const row = { id: 11, action_key: 'q1-plan-sheet', label: 'Last-night plan sheet + 7-day follow-up email', is_ticked: true, ticked_at: '2026-11-08T12:14:54.43Z' };
  const rule = evidenceRuleFor(row);
  assert.equal(rule.id, 'plan-sheet-follow-up');
  assert.deepEqual(tickChanges([row], [], '2026-11-08T21:00:00Z')[0].after, { is_ticked: false, ticked_at: null });
  assert.match(manualTickRefusal(row), /ticks itself from evidence/);
  const early = { email_id: 'e1', subject: 'Your plan sheet: 7-day follow-up', sent_on: '2026-11-20', message_count: 3, campaign_key: null };
  const later = { ...early, email_id: 'e2', sent_on: '2026-11-30' };
  assert.equal(evidenceHit(rule, [early], '2026-12-01T00:00:00Z'), null, 'before the last night: no evidence');
  assert.equal(evidenceHit(rule, [early, later], '2026-12-01T00:00:00Z').email_id, 'e2');
  assert.equal(evidenceHit(rule, [{ ...later, subject: 'Pick n Mix is back' }], '2026-12-01T00:00:00Z'), null);
});

test('confirmed price: one confirmed claim, the previous claims kept in history', () => {
  const p = confirmedPricePatch({ price_claims: [{ gbp: 1075, source: 'snapshot' }, { gbp: 1195, source: 'earlier strategy change' }], history: [] }, 1075, 'Cursor', 'Alan, 8 Nov 2026, via Claude', '2026-11-08T21:00:00Z');
  assert.deepEqual([p.price_claims.length, p.price_claims[0].gbp, p.price_claims[0].confirmed, p.history[0].previous_claims.length, p.history[0].previous_claims[1].gbp], [1, 1075, true, 2, 1195]);
});
