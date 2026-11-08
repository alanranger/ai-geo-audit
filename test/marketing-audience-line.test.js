/**
 * Audience count reconciliation (question 2026-11-08 draft side panel, part B): the live estimate for a draft counts
 * people + Alan's business copy once; organisations and owner addresses are reported apart, never inside "people" or
 * the sends. A saved group's count now and the plan's stored estimate are both kept and shown when they differ.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { audienceEstimates, audienceSplit } from '../lib/marketing/overview.mjs';
import { evaluate } from '../lib/marketing/segments.mjs';
import { audienceOf, liveSends } from '../lib/marketing/delivery-reserve.mjs';
import { deliveryView } from '../lib/marketing/delivery.mjs';

const ENGAGED = { segment_id: 'gpt-8w-engaged-review', definition: { query: { version: 1, root: { type: 'group', match: 'all', items: [{ type: 'cond', field: 'eligible', op: 'is_true', value: null }] } }, version: 2 } };
const PNM_GROUP = { segment_id: 'gpt-8w-pnm-review', definition: ENGAGED.definition };
const live = (i, extra = {}) => ({ person_id: `p${i}`, anchor_key: `email:p${i}@x.test`, facts: { email: `p${i}@x.test`, subscribed: true, profile_state: 'active', ...extra } });
const people = (n) => Array.from({ length: n }, (_, i) => live(i));
/** The 19 Nov engaged group on 8 Nov: 543 people, 1 organisation, Alan's business address and his personal owner address. */
const ENGAGED_19NOV = [...people(543), live('org', { record_type: 'organisation' }), live('biz', { admin: true }), live('own', { owner: true })];
const CTX = { centre: null, today: '2026-11-08', asOf: '2026-11-08', windows: {}, engagementComplete: true, campaigns: null };
const DRAFT_19NOV = { campaign_key: 'theme|gpt-8w-2026-11-19', kind: 'theme', title: '19 Nov', stage: 'drafted', audience: 'segments', segment_ids: ['gpt-8w-engaged-review'], planned_send_on: '2026-11-19', export_id: null, reserved_sends: 0, estimate_sends: 544, estimate_as_of: '2026-11-08', estimate_rule: 'REVIEW estimate: 543 engaged subscribers + Alan copy.' };
const METER = { captured_at: '2026-11-08T12:54:13Z', cycle_reset_at: '2026-11-12T12:51:47.184Z', quota_emails: 5000, used_emails: 2437 };
const view = (campaigns, est, exports = []) => deliveryView(METER, { campaigns, exports, schedules: [], sent: [], runs: [] }, est, new Date('2026-11-08T13:00:00Z'));

test('19 Nov: 543 people + 1 business copy = 544 sends (was 546: organisation counted as a client and both of Alan\'s addresses added)', () => {
  const r = evaluate(ENGAGED_19NOV, [ENGAGED.definition], CTX);
  assert.equal(r.count + r.admin_included, 546, 'the old live estimate');
  assert.deepEqual(audienceSplit(r), { people: 543, business_copy: 1, owner_addresses: 1, organisations: 1, sends: 544 });
  const est = audienceEstimates([DRAFT_19NOV], ENGAGED_19NOV, CTX, [ENGAGED], { subscribed: 0 });
  assert.deepEqual([est[DRAFT_19NOV.campaign_key].sends, est[DRAFT_19NOV.campaign_key].attached], [544, true]);
  const d = view([DRAFT_19NOV], est).deliveries[0];
  assert.deepEqual([d.amount, d.stage, d.bucket], [544, 'estimate', 'draft'], 'the card reads 544; a draft is never a reserved send');
  assert.deepEqual(d.aud, { people: 543, business_copy: 1, owner_addresses: 1, organisations: 1, sends: 544, basis: 'query', query_now: 544, query_people: 543, query_group: 'gpt-8w-engaged-review', plan_estimate: 544, differs: false });
});

test('business copy is added once (matched business address or always-on copy, never both)', () => {
  assert.deepEqual(audienceSplit({ count: 3, members: [], owner_kinds: {}, business_copy: 1 }), { people: 3, business_copy: 1, owner_addresses: 0, organisations: 0, sends: 4 });
  assert.equal(audienceSplit({ count: 3, members: [], owner_kinds: { business: 1 }, business_copy: 1 }).sends, 4);
});

test('workshop group: query now 306 vs plan estimate 309 are both kept (never swapped silently)', () => {
  const c = { ...DRAFT_19NOV, campaign_key: 'theme|ws', segment_ids: ['gpt-8w-workshop-review'], estimate_sends: 309 };
  const q = { people: 305, business_copy: 1, owner_addresses: 1, organisations: 1, sends: 306, segment_id: 'gpt-8w-workshop-review', attached: true };
  const d = view([c], { 'theme|ws': q }).deliveries[0];
  assert.deepEqual([d.amount, d.aud.basis, d.aud.query_now, d.aud.plan_estimate, d.aud.differs, d.aud.people], [306, 'query', 306, 309, true, 305]);
});

test('an unattached saved group named in the rule is "query now" only; the plan estimate still reserves', () => {
  const c = { campaign_key: 'theme|gpt-8w-pnm-2026-12-14', kind: 'theme', title: 'PnM', stage: 'drafted', audience: null, segment_ids: [], planned_send_on: '2026-12-14', estimate_sends: 127, estimate_rule: 'REVIEW estimate126 launch clients + ownercopy. Saved gpt-8w-pnm-review is proposal, not attached.' };
  const est = audienceEstimates([c], [...people(120), live('biz', { admin: true, subscribed: false })], CTX, [ENGAGED, PNM_GROUP], { subscribed: 0 });
  const q = est[c.campaign_key];
  assert.deepEqual([q.sends, q.people, q.attached, q.segment_id, liveSends(q)], [120, 120, false, 'gpt-8w-pnm-review', null]);
  const d = view([c], est).deliveries[0];
  assert.deepEqual([d.amount, d.aud.basis, d.aud.query_now, d.aud.plan_estimate, d.aud.differs, d.aud.people], [127, 'estimate', 120, 127, true, null]);
});

test('frozen snapshot: owner addresses apart from people, business copy once', () => {
  const c = { campaign_key: 'theme|snap', kind: 'theme', title: 'S', stage: 'drafted', export_id: 'x1', planned_send_on: '2026-11-10' };
  const exp = { export_id: 'x1', eligible_count: 306, status: 'pending_import', owner: { included: true, count: 2, kinds: { business: 1, personal: 1 }, business_copy: 0 } };
  const d = view([c], {}, [exp]).deliveries[0];
  assert.deepEqual([d.amount, d.aud.people, d.aud.business_copy, d.aud.owner_addresses, d.aud.organisations, d.aud.basis], [308, 306, 1, 1, null, 'snapshot']);
  assert.deepEqual(audienceOf({ amount: 127, amount_from: 'snapshot', snapshot: {} }, {}, null, { eligible_count: 126, owner: { included: true, count: 0, business_copy: 1 } }).business_copy, 1);
});

test('drafts never count as reserved sends: not committed, provisional, booked or deducted; a separate draft figure', () => {
  const draft = (day, extra = {}) => ({ ...DRAFT_19NOV, campaign_key: `theme|gpt-8w-${day}`, planned_send_on: day, ...extra });
  const proposed = { ...DRAFT_19NOV, campaign_key: 'email|wk', stage: 'proposed', planned_send_on: '2026-11-10' };
  const snap = draft('2026-11-11', { export_id: 'x-d' });
  const exp = { export_id: 'x-d', eligible_count: 100, status: 'pending_import', owner: { included: true, count: 0, business_copy: 1 } };
  const v = view([draft('2026-11-10'), draft('2026-11-19'), proposed, snap], {}, [exp]);
  const c = v.capacity;
  assert.deepEqual([c.committed, c.provisional, c.free_after_commitments, c.projected_free], [101, 544, 2563 - 101, 2563 - 101 - 544], 'only the snapshot commits and only the proposed record is provisional');
  assert.deepEqual([c.draft_items, c.draft_proposals, c.next_cycle.draft_items, c.next_cycle.draft_proposals, c.next_cycle.provisional], [1, 544, 1, 544, 0]);
  assert.deepEqual(v.deliveries.map((d) => d.bucket), ['draft', 'draft', 'provisional', 'committed']);
  const scheduled = view([draft('2026-11-10', { scheduled_for: '2026-11-10T17:30:00Z', schedule_evidence: 'operator_verified' })], {});
  assert.equal(scheduled.deliveries[0].bucket, 'committed', 'an operator-confirmed schedule is no longer a draft proposal');
});

function line(item) {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../lib/marketing-audience-line.js', import.meta.url), 'utf8'), ctx);
  return ctx.window.MarketingAudienceLine.html(item).replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
}

test('panel line: "543 people + 1 business copy = 544 sends", owner and organisation shown apart, compare line when they differ', () => {
  const aud = { people: 543, business_copy: 1, owner_addresses: 1, organisations: 1, sends: 544, basis: 'query', query_now: 544, query_people: 543, query_group: 'gpt-8w-engaged-review', plan_estimate: 544, differs: false };
  const t = line({ raw: { delivery: { aud } } });
  assert.match(t, /543 people \+ 1 business copy = 544 sends/);
  assert.match(t, /1 owner address also matched \(not counted as people or sends\)/);
  assert.match(t, /1 organisation also matched/);
  assert.doesNotMatch(t, /546|query now vs plan/i);
  const ws = line({ delivery: { aud: { ...aud, people: 305, sends: 306, query_now: 306, query_people: 305, query_group: 'gpt-8w-workshop-review', plan_estimate: 309, differs: true } } });
  assert.match(ws, /305 people \+ 1 business copy = 306 sends/);
  assert.match(ws, /Query now vs plan estimate: query now 306 sends \(305 people in gpt-8w-workshop-review\) vs plan estimate 309 sends/);
  const snap = line({ aud: { people: 306, business_copy: 1, owner_addresses: 1, organisations: null, sends: 308, basis: 'snapshot' } });
  assert.match(snap, /306 people \+ 1 business copy \+ 1 owner address = 308 sends/);
  assert.equal(line({ aud: { sends: 127, people: null, basis: 'estimate' } }).includes('127 sends'), true);
  assert.match(line({ aud: { people: 1, sends: 1, business_copy: 0, basis: 'query', query_group: '<b>' , differs: false } }), /1 person = 1 send/);
});
