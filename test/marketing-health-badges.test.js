/**
 * Health badges on every people table + owner / test addresses (question 2026-11-08 health-badges-and-owner-address)
 * on synthetic fixtures: the acceptance list, the month-window conditions, and owner addresses counted apart.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { badgesOf, clientHealth, isOwner, noResponseWithin, openedWithin } from '../lib/marketing/client-health.mjs';
import { protectedReason } from '../lib/marketing/cleanup.mjs';
import { evaluate } from '../lib/marketing/segments.mjs';
import { evalNode, rowCtx } from '../lib/marketing/query/evaluate.mjs';
import { describe, validateQuery } from '../lib/marketing/query/english.mjs';
import { runQuery } from '../lib/marketing/query/table.mjs';

const TODAY = '2026-11-08';
const camps = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id, i) => ({ id, sent_on: `2026-${String(10 - i * 2).padStart(2, '0')}-01` }));
const ctx = { today: TODAY, asOf: TODAY, engagementComplete: true, campaigns: { list: camps, byId: new Map(camps.map((c) => [c.id, c])), start: camps[camps.length - 1].sent_on }, windows: { warm_days: 90, cooling_days: 180 }, exposureBuilt: true };
const sub = { email: 'a@example.com', subscribed: true, profile_state: 'active', suppressed: null, record_type: 'person' };
const buy = (date) => ({ level: 'c', src: 'squarespace', date, net: 95 });
const eng = (e) => ({ delivered_campaigns: 5, opened_campaigns: 0, clicked_campaigns: 0, ...e });
const allCamps = { d: camps.map((c) => c.id), o: [], k: [] };
let seq = 0;
const person = (facts, anchor = 'sqs:x') => ({ person_id: `p${String(seq += 1).padStart(3, '0')}`, anchor_key: anchor, facts: { record_type: 'person', ...facts } });
const R = (p) => ({ ...rowCtx(p, ctx), windows: ctx.windows });
const run = (root, p) => evalNode(validateQuery({ root }).root, R(p)).r;
const C = (field, op, value = null) => ({ type: 'cond', field, op, value });
const G = (items) => ({ type: 'group', match: 'all', items });

test('recent buyer who unsubscribed: Recent purchase badge, own email badge, Can email = not subscribed', () => {
  const p = person({ ...sub, subscribed: false, purchases: [buy('2026-09-08')], engagement: eng({ opened_campaigns: 1, last_open_at: '2026-10-20T10:00:00Z' }) });
  const b = badgesOf(p.facts, R(p));
  assert.deepEqual([b.purchase.key, b.purchase.label, b.email.key, b.consent.key, b.consent.label], ['p0_6', 'Recent', 'warm_open', 'not_subscribed', 'Not subscribed']);
  assert.match(b.purchase.tip, /PURCHASE health v2/);
  assert.match(b.email.tip, /EMAIL health v1.*first open and first click/);
  assert.match(b.purchase.tip, /8 Sept? 2026/);
});

test('last click years ago but an open last month: Warm · open-only, and NOT inactive for any window', () => {
  const p = person({ ...sub, camps: allCamps, engagement: eng({ opened_campaigns: 3, clicked_campaigns: 1, last_click_at: '2023-03-01T10:00:00Z', last_open_at: '2026-10-15T10:00:00Z' }) });
  assert.equal(badgesOf(p.facts, R(p)).email.label, 'Warm · open-only');
  for (const n of [3, 6, 12, 24]) assert.equal(run(C('no_response_months', 'last_months', { n }), p), 'no', `${n} months`);
  assert.equal(run(C('opened_months', 'last_months', { n: 6 }), p), 'yes');
});

test('no open or click in N months with enough covered emails: matches the inactivity filter (review only)', () => {
  const p = person({ ...sub, camps: allCamps, engagement: eng({ opened_campaigns: 1, last_open_at: '2025-06-01T10:00:00Z' }) });
  assert.equal(noResponseWithin(p.facts, R(p), 6), 'yes');
  assert.equal(run(C('no_response_months', 'last_months', { n: 6 }), p), 'yes');
  assert.equal(run(C('no_response_months', 'last_months', { n: 24 }), p), 'no', 'an open 17 months ago is inside 24 months');
  assert.equal(protectedReason({ ...p.facts, purchases: [buy('2026-01-01')], value: { c: { orders: 1, net: 95 }, cp: { orders: 1 } } }, TODAY), 'buyer', 'a buyer stays protected from clean-up');
});

test('too few emails / no data: Too few or Unknown badge, and undecided (never a match) for inactivity', () => {
  const few = person({ ...sub, camps: { d: ['c1', 'c2'], o: [], k: [] }, engagement: eng({ delivered_campaigns: 2 }) });
  assert.equal(badgesOf(few.facts, R(few)).email.label, 'Too few emails');
  assert.equal(run(C('no_response_months', 'last_months', { n: 6 }), few), 'unknown');
  const none = person({ ...sub, engagement: null });
  assert.equal(badgesOf(none.facts, R(none)).email.label, 'Unknown');
  assert.equal(run(C('no_response_months', 'last_months', { n: 6 }), none), 'unknown');
  const noEmail = person({ email: null, profile_state: 'none' });
  assert.equal(run(C('no_response_months', 'last_months', { n: 6 }), noEmail), 'unknown');
  assert.equal(run(C('opened_months', 'last_months', { n: 6 }), noEmail), 'unknown');
  const incomplete = person({ ...sub, camps: allCamps, engagement: eng({}) });
  assert.equal(evalNode(C('no_response_months', 'last_months', { n: 6 }), { ...R(incomplete), engagementComplete: false }).r, 'unknown');
  const r = runQuery([few, none, noEmail], { root: G([C('no_response_months', 'last_months', { n: 6 })]) }, ctx);
  assert.deepEqual([r.total, r.results.unknown], [0, 3]);
  assert.ok(Object.values(badgesOf({}, R(person({})))).every((x) => x !== '' && x !== null), 'no blank badge');
});

test('"Opened within N calendar months" is its own condition: a click alone never counts; same as the saved LR rule', () => {
  const clickOnly = person({ ...sub, engagement: eng({ clicked_campaigns: 1, last_click_at: '2026-10-20T10:00:00Z' }) });
  assert.equal(openedWithin(clickOnly.facts, R(clickOnly), 6), 'no');
  const opened = person({ ...sub, engagement: eng({ opened_campaigns: 1, last_open_at: '2026-05-08T09:00:00+01:00' }) });
  const old = person({ ...sub, engagement: eng({ opened_campaigns: 1, last_open_at: '2026-05-07T09:00:00+01:00' }) });
  for (const p of [opened, old, clickOnly]) assert.equal(run(C('opened_months', 'last_months', { n: 6 }), p), run(C('last_open', 'within_last', { n: 6, unit: 'months' }), p));
  assert.equal(describe(validateQuery({ root: G([C('opened_months', 'last_months', { n: 6 })]) }).root), 'People where Opened within the last 6 calendar months');
  assert.throws(() => validateQuery({ root: C('no_response_months', 'last_months', { n: 0 }) }), /calendar months/);
  assert.throws(() => validateQuery({ root: C('no_response_months', 'last_months', { n: 2.5 }) }), /calendar months/);
});

test('same badges everywhere: Customers rows = the shared function = the health panel counts, at one as-of', () => {
  const people = [
    person({ ...sub, purchases: [buy('2026-09-01')], engagement: eng({ clicked_campaigns: 1, last_click_at: '2026-11-01T10:00:00Z' }) }),
    person({ ...sub, email: 'b@example.com', subscribed: false, purchases: [buy('2024-01-01')] }),
    person({ email: null, profile_state: 'none', purchases: [buy('2026-08-01')] })
  ];
  const r = runQuery(people, { root: G([]) }, ctx, { columns: ['name'] });
  assert.deepEqual(r.badge_columns, ['purchase_band', 'email_health', 'consent_state']);
  assert.equal(r.health.as_of, TODAY);
  for (const row of r.rows) assert.deepEqual(row.badges, badgesOf(people.find((p) => p.person_id === row.person_id).facts, R(people.find((p) => p.person_id === row.person_id))));
  const h = clientHealth(people, R, { asOf: TODAY });
  const recent = r.rows.filter((x) => ['p0_6', 'p6_12'].includes(x.badges.purchase.key) && x.badges.consent.key !== 'can_email').length;
  assert.equal(recent, h.cards.recent_not_eligible.total.n);
  const sorted = runQuery(people, { root: G([]) }, ctx, { columns: ['name'], sort: 'purchase_band', dir: 'asc' }).rows.map((x) => x.badges.purchase.key);
  assert.deepEqual(sorted, ['p0_6', 'p0_6', 'p24_plus'], 'badge columns sort by band order, server-side');
});

test('owner / test addresses: counted apart in segments, query counts and the panel ("39 people · + 1 owner address")', () => {
  const clients = Array.from({ length: 3 }, (_, i) => person({ ...sub, email: `c${i}@example.com`, purchases: [buy('2026-01-01')] }));
  const personal = person({ ...sub, email: 'me@hotmail.example', owner: true });
  const business = person({ ...sub, email: 'info@alanranger.com', admin: true });
  const people = [...clients, personal, business];
  assert.ok(isOwner(personal.facts) && isOwner(business.facts) && !isOwner(clients[0].facts));
  const seg = { query: { version: 1, root: G([C('purchase', 'exists', {})]) } };
  const r = evaluate(people, [seg], ctx);
  assert.deepEqual([r.count, r.owner_included, r.business_copy], [3, 0, 1], 'the personal address has no purchase, so it is not an owner copy here; the business copy is always on');
  const matchAll = { query: { version: 1, root: G([C('eligible', 'is_true')]) } };
  const all = evaluate(people, [matchAll], ctx);
  assert.deepEqual([all.count, all.owner_included, all.owner_kinds, all.business_copy], [3, 2, { personal: 1, business: 1 }, 0]);
  assert.equal(all.members.length, 5, 'owners get an owner copy by default');
  const out = evaluate(people, [matchAll], ctx, { includeOwner: false });
  assert.deepEqual([out.count, out.owner_included, out.members.length, out.exclusions.owner_address_left_out], [3, 0, 3, 2]);
  const q = runQuery(people, { root: G([C('eligible', 'is_true')]) }, ctx, { columns: ['name'] });
  assert.deepEqual([q.header.people, q.header.owner_addresses, q.header.eligible_addresses], [3, 2, 3]);
  assert.equal(protectedReason(personal.facts, TODAY), 'owner');
  const h = clientHealth(people, R, { asOf: TODAY });
  assert.deepEqual([h.matrix.total.people.n, h.apart.owners.total, h.reconciliation.owner_addresses, h.reconciliation.gap], [3, 2, 2, 0]);
  const marks = badgesOf(personal.facts, R(personal)).marks.map((m) => m.key);
  assert.ok(marks.includes('owner'));
  assert.equal(badgesOf(personal.facts, R(personal)).consent.key, 'can_email', 'consent is unchanged by the owner flag');
});

test('regression 8 Nov: a just-sent campaign not yet collected must not zero the LR segment (39 people + 1 owner, business copy apart)', () => {
  const lr = { query: { version: 1, root: G([
    C('booking', 'exists', { cats: ['beginners'], _when: 'any' }), C('booking', 'none', { cats: ['lightroom'], _when: 'any' }),
    C('miles', 'lte', 30), C('eligible', 'is_true'), C('last_open', 'within_last', { n: 6, unit: 'months' })
  ]) } };
  const here = { lat: 52.4, lng: -1.56, postcode: 'CV4 9HW' };
  const local = (i, open) => person({ ...sub, ...here, email: `lr${i}@example.com`, bookings: [{ key: `b${i}`, cats: ['beginners'], date: '2025-03-01', role: 'buyer' }], booking_count: 1, cats: { beginners: { c: 1, p: 0 } }, history_incomplete: false, engagement: eng({ opened_campaigns: 2, last_open_at: open }) });
  const clients = Array.from({ length: 39 }, (_, i) => local(i, '2026-10-01T10:00:00Z'));
  const stale = local(99, '2025-01-01T10:00:00Z');
  const personal = { ...local(100, '2026-10-20T10:00:00Z'), facts: { ...local(100, '2026-10-20T10:00:00Z').facts, owner: true } };
  const business = person({ ...sub, email: 'info@alanranger.com', admin: true });
  const people = [...clients, stale, personal, business];
  const lrCtx = { ...ctx, centre: here, engagementComplete: false };
  const r = evaluate(people, [lr], lrCtx);
  assert.deepEqual([r.count, r.owner_included, r.owner_kinds, r.business_copy], [39, 1, { personal: 1 }, 1]);
  assert.match(Object.keys(r.exclusions).join('|'), /undecided: First open/, 'an old open is undecided while collection is incomplete (never a confident no)');
  const done = evaluate(people, [lr], { ...lrCtx, engagementComplete: true });
  assert.deepEqual([done.count, done.owner_included, done.business_copy], [39, 1, 1]);
  assert.ok(Object.keys(done.exclusions).some((k) => k.startsWith('not: First open')), 'with complete coverage the old open is a firm no');
  const q = runQuery(people, lr.query, lrCtx, { columns: ['name'] });
  assert.deepEqual([q.header.people, q.header.owner_addresses], [39, 1], 'Customers shows the same 39 + 1 owner');
  const p = clients[0];
  assert.equal(evalNode(C('last_open', 'before', '2026-10-15'), { ...R(p), engagementComplete: false }).r, 'unknown', 'a "before" date stays undecided while collecting');
  assert.equal(evalNode(C('click', 'exists', {}), { ...R(person({ ...sub, clicks: [{ url: 'alanranger.com/x', at: '2026-10-02T10:00:00Z' }] })), engagementComplete: false }).r, 'yes', 'a recorded click still proves "has clicked"');
  assert.equal(openedWithin(p.facts, { ...R(p), engagementComplete: false }, 6), 'yes');
  assert.equal(noResponseWithin(p.facts, { ...R(p), engagementComplete: false }, 6), 'no');
  assert.equal(noResponseWithin(stale.facts, { ...R(stale), engagementComplete: false }, 6), 'unknown');
});

test('manual snapshot exclusion: reason required, only unloaded snapshots, the row is logged (never added past consent)', async () => {
  const { excludeMember, restoreMember } = await import('../lib/marketing/exports.mjs');
  const calls = [];
  const fake = (status, row) => ({ from: (table) => {
    const st = { table, ops: [] };
    calls.push(st);
    const answer = () => (table === 'marketing_segment_exports' ? { data: { export_id: 'e1', status, is_test: false }, error: null } : { data: row, error: null });
    const b = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => res({ data: null, error: null }) : (k === 'maybeSingle' ? async () => answer() : (...a) => { st.ops.push([k, a]); return b; })) });
    return b;
  } });
  await assert.rejects(excludeMember(fake('pending_import', {}), { export_id: 'e1', person_id: 'p1', reason: 'short' }, 'Alan'), /10\+ characters/);
  await assert.rejects(excludeMember(fake('loaded', {}), { export_id: 'e1', person_id: 'p1', reason: 'Not this one, family' }, 'Alan'), /loaded/);
  const member = { export_id: 'e1', person_id: 'p1', email: 'x@example.com', first_name: 'X', last_name: 'Y' };
  calls.length = 0;
  assert.deepEqual(await excludeMember(fake('pending_import', member), { export_id: 'e1', person_id: 'p1', reason: 'Asked not to get offers by phone' }, 'Alan'), { export_id: 'e1', excluded: 1 });
  const ins = calls.find((s) => s.table === 'marketing_snapshot_exclusions').ops.find(([k]) => k === 'insert')[1][0];
  assert.deepEqual(ins.member_row, member);
  assert.ok(calls.some((s) => s.table === 'marketing_segment_export_members' && s.ops.some(([k]) => k === 'delete')));
  calls.length = 0;
  await restoreMember(fake('pending_import', { exclusion_id: 'x1', member_row: member }), { export_id: 'e1', person_id: 'p1', reason: 'Spoke to them again, fine' }, 'Alan');
  const back = calls.find((s) => s.table === 'marketing_segment_export_members' && s.ops.some(([k]) => k === 'insert')).ops.find(([k]) => k === 'insert')[1][0];
  assert.deepEqual(back, member, 'only the original snapshot row goes back');
});
