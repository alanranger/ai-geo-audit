/**
 * Marketing & Campaigns — GPT acceptance evidence on controlled fixtures (no real people, example.com addresses).
 *   node --test test/marketing-acceptance.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { band, engagementView } from '../lib/marketing/engagement.mjs';
import { latestCollectorRun } from '../lib/marketing/overview.mjs';
import { resolveOne } from '../lib/marketing/suppression-review.mjs';
import { safeCell, validListName } from '../lib/marketing/exports.mjs';
import { presendState, stateOf } from '../lib/marketing/list-load.mjs';
import { evalNode, rowCtx } from '../lib/marketing/query/evaluate.mjs';
import { validateQuery } from '../lib/marketing/query/english.mjs';
import { valueFacts } from '../lib/marketing/value.mjs';
import { recordType } from '../lib/marketing/record-type.mjs';
import { orderCancelled } from '../lib/marketing/identity.mjs';
import { offerOn } from '../lib/strategy-board-rows.mjs';
import { computeRunRate } from '../lib/strategy-run-rate.mjs';
import { allFacts } from '../lib/marketing/facts.mjs';
import { runAlert } from '../lib/marketing/health.mjs';
import { buildIdentities, sqsOrderNumber } from '../lib/marketing/identity.mjs';
import { ingest, reSuppressAfterReview } from '../lib/marketing/collector-ingest.mjs';
import { capacityCheck, cycleOf, meterView } from '../lib/marketing/meter.mjs';
import { BUILTIN_SEGMENTS, consentReason, evaluate, resolveParams } from '../lib/marketing/segments.mjs';
import { emailHash } from '../lib/marketing/store.mjs';
import { suppressionChanges } from '../lib/marketing/sync.mjs';
import { readMeter, readEventUsers } from '../scripts/marketing-collector/page-reads.mjs';

const TODAY = '2026-11-07';
const profile = (id, email, first, last, extra = {}) => ({ profile_id: id, email, first_name: first, last_name: last, accepts_marketing: true, missing_since: null, postcode: 'CV4 9HW', order_count: 0, ...extra });
const order = (id, num, email, extra = {}) => ({ order_id: id, order_number: num, customer_email: email, created_on: '2025-05-01T10:00:00Z', payment_state: 'PAID', fulfillment_status: 'FULFILLED', testmode: false, ...extra });

function world(over = {}) {
  const src = {
    profiles: [profile('p1', 'buyer@example.com', 'Test', 'Buyer', { order_count: 2 }), profile('p2', 'jo@example.com', 'Jo', 'Sample'), profile('p3', 'friend@example.com', 'Fran', 'Friend')],
    orders: [order('o1', 3354, 'buyer@example.com', { attendee_email: 'buyer@example.com', attendee_first_name: 'Test', attendee_last_name: 'Buyer' }),
      order('o2', 3400, 'buyer@example.com', { attendee_email: 'friend@example.com', attendee_first_name: 'Fran', attendee_last_name: 'Friend' }),
      order('o3', 3401, 'jo@example.com', { payment_state: 'REFUNDED' })],
    lines: [{ order_id: 'o1', product_name: 'Bluebell Woodlands Photography Workshop', line_type: 'SERVICE' }, { order_id: 'o2', product_name: 'Camera Courses For Beginners', line_type: 'SERVICE' }, { order_id: 'o3', product_name: 'Lightroom Classic Course', line_type: 'SERVICE' }],
    workshops: [{ id: 'w1', event_start: '2025-05-10', theme_location: 'Bluebell Woodlands', source: 'Google', order_ref: '#03354', client_name: 'Test Buyer', is_multi_day: false },
      { id: 'w2', event_start: '2025-06-01', theme_location: 'Lake District', source: 'JLR', order_ref: 'JLR#1234567890ABC', client_name: 'Jo Sample', is_multi_day: true }],
    courses: [], transactions: [], members: [], canonicalIndex: new Map(), ...over
  };
  const st = buildIdentities(src);
  const facts = allFacts(st, { today: TODAY, ordersByEmail: new Map(), geo: new Map([['CV4 9HW', { lat: 52.3998, lng: -1.5942 }]]), suppressed: new Map(), engagement: new Map() });
  return { st, facts, f: (anchor) => facts.get(anchor) };
}

test('order-ref rule: only "#" + digits are Squarespace order numbers; raw JLR / 10-digit refs untouched', () => {
  assert.equal(sqsOrderNumber('#03354'), 3354);
  assert.equal(sqsOrderNumber('JLR#1234567890ABC'), null);
  assert.equal(sqsOrderNumber('1234567890'), null);
  assert.equal(sqsOrderNumber('Invoice 22'), null);
});

test('one known Squarespace order also in the Booking Sheet counts once (both sources on one booking)', () => {
  const { f } = world();
  const b = f('sqs:p1').bookings.filter((x) => x.key === 'sqs:3354');
  assert.equal(b.length, 1);
  assert.deepEqual(b[0].src.sort(), ['booking_sheet', 'squarespace']);
  assert.equal(b[0].event_date, '2025-05-10');
});

test('a JLR booking absent from Squarespace is kept (probable for the matching profile, never merged)', () => {
  const { st, f } = world();
  const link = st.links.find((l) => l.source === 'bs_workshop' && l.source_id === 'w2');
  assert.equal(link.match_method, 'name_probable');
  assert.equal(link.confirmed, false);
  assert.equal(link.raw_ref, 'JLR#1234567890ABC');
  assert.equal(f('sqs:p2').cats.residential.c, 0);
  assert.equal(f('sqs:p2').cats.residential.p, 1);
  assert.equal(f('name:jo sample').cats.residential.c, 1);
});

test('buyer vs attendee: a place bought for someone else is the attendee\'s history, not the buyer\'s', () => {
  const { f } = world();
  assert.equal(f('sqs:p1').bought_for_others, 1);
  assert.equal(f('sqs:p1').cats.beginners, undefined);
  assert.equal(f('sqs:p3').cats.beginners.c, 1);
});

test('refunds create no history; booked is never "attended" and future bookings are not past history', () => {
  const { f } = world({ workshops: [{ id: 'w9', event_start: '2027-01-10', theme_location: 'Woodland Walk', source: 'Google', order_ref: 'x', client_name: 'Jo Sample', is_multi_day: false }] });
  assert.equal(f('sqs:p2').cats.lightroom, undefined);
  const name = f('name:jo sample');
  assert.equal(name.cats.woodland.future_c, 1);
  assert.equal(name.cats.woodland.last_c, null);
  assert.ok(!JSON.stringify(name).includes('attended'));
});

test('unknown is not none: incomplete history is reported apart; unknown engagement is never cold', () => {
  const seg = resolveParams(BUILTIN_SEGMENTS.find((s) => s.segment_id === 'beginners-no-lightroom-local').definition);
  const beg = [{ key: 'sqs:1', date: '2025-05-01', cats: ['beginners'], role: 'buyer' }];
  const person = (facts) => ({ person_id: 'x', anchor_key: 'sqs:x', facts: { email: 'a@example.com', subscribed: true, profile_state: 'active', lat: 52.4, lng: -1.59, cats: { beginners: { c: 1, p: 0 } }, bookings: beg, booking_count: 1, ...facts } });
  const ctx = { centre: { lat: 52.3998, lng: -1.5942 }, today: TODAY };
  assert.deepEqual(evaluate([person({ history_incomplete: true })], [seg], ctx).exclusions, { 'undecided: has no booking (same record: in lightroom)': 1 });
  assert.equal(evaluate([person({ history_incomplete: false })], [seg], ctx).count, 1);
  assert.equal(band(null, null, true), 'unknown');
  assert.equal(band(null, { delivered_campaigns: 5 }, false), 'unknown');
  assert.equal(band(null, { delivered_campaigns: 5 }, true), 'none_recorded');
  assert.equal(band(null, { delivered_campaigns: 2 }, true), 'insufficient');
  assert.equal(band('2026-10-01T00:00:00Z', { delivered_campaigns: 5 }, true, undefined, TODAY), 'warm');
  assert.equal(band('2026-03-01T00:00:00Z', { delivered_campaigns: 5 }, false, undefined, TODAY), 'unknown');
});

test('selected recipients are deduplicated; unsubscribed and suppressed people are excluded', () => {
  const p = (id, email, extra = {}) => ({ person_id: id, anchor_key: `sqs:${id}`, facts: { email, subscribed: true, profile_state: 'active', cats: { residential: { c: 1, p: 0 }, day_workshop: { c: 1, p: 0 } }, bookings: [{ key: `b${id}`, date: '2025-06-01', cats: ['residential', 'day_workshop'], role: 'buyer' }], booking_count: 1, ...extra } });
  const defs = [resolveParams(BUILTIN_SEGMENTS[3].definition), resolveParams(BUILTIN_SEGMENTS[2].definition)];
  const r = evaluate([p('1', 'a@example.com'), p('2', 'a@example.com'), p('3', 'b@example.com', { subscribed: false }), p('4', 'c@example.com', { suppressed: 'unsubscribed' })], defs, { today: TODAY, centre: null });
  assert.equal(r.count, 1);
  assert.deepEqual(r.exclusions, { duplicate_email: 1, not_subscribed: 1, 'suppressed:unsubscribed': 1 });
});

test('deleted and JLR-unsubscribed contacts never reappear, even if Squarespace later shows them subscribed', () => {
  const now = '2026-11-07T00:00:00Z';
  const first = suppressionChanges([{ profile_id: 'j1', email: 'x@jaguarlandrover.com', accepts_marketing: false }], [], now);
  assert.equal(first.suppress[0].reason, 'JLR address, not subscribed at first sync (7 Nov 2026)');
  const later = suppressionChanges([{ profile_id: 'a', email: 'a@example.com', accepts_marketing: false }], [{ profile_id: 'a', email: 'a@example.com', accepts_marketing: true }, { profile_id: 'gone', email: 'g@example.com', accepts_marketing: true }], now);
  assert.deepEqual(later.suppress.map((s) => s.reason).sort(), ['deleted_in_squarespace', 'unsubscribed']);
  assert.deepEqual(later.gone, ['gone']);
  assert.equal(first.suppress[0].email_hash, emailHash('X@JaguarLandRover.com '));
  assert.equal(consentReason({ email: 'x@jaguarlandrover.com', subscribed: true, profile_state: 'active', suppressed: 'JLR address, not subscribed at first sync (7 Nov 2026)' }), 'suppressed:JLR address, not subscribed at first sync (7 Nov 2026)');
  assert.equal(consentReason({ email: 'g@example.com', subscribed: false, profile_state: 'deleted' }), 'deleted_in_squarespace');
});

test('billing cycle: provider reset (not calendar month), reservations, repeated sends, capacity, stale', () => {
  const c = cycleOf('2026-11-12T12:51:47.184Z');
  assert.equal(c.start, '2026-10-12T12:51:47.184Z');
  const latest = { captured_at: '2026-11-07T12:00:00Z', cycle_reset_at: '2026-11-12T12:51:47.184Z', quota_emails: 5000, used_emails: 2398 };
  const camps = [{ campaign_key: 'a', stage: 'approved', reserved_sends: 900 }, { campaign_key: 'b', stage: 'sent', reserved_sends: 900 }, { campaign_key: 'c', stage: 'scheduled', reserved_sends: 500, sqs_email_id: 'e9' }];
  const sent = [{ email_id: 'e1', sent_on: '2026-10-22T17:38:46Z', message_count: 1103 }, { email_id: 'e2', sent_on: '2026-10-23T09:00:00Z', message_count: 1103 }, { email_id: 'e0', sent_on: '2026-10-10T09:00:00Z', message_count: 900 }];
  const v = meterView(latest, camps, sent, new Date('2026-11-07T14:00:00Z'));
  assert.equal(v.state, 'fresh');
  assert.equal(v.reserved, 900);
  assert.equal(v.after_reservations, 5000 - 2398 - 900);
  assert.equal(v.sent_recipients_this_cycle, 2206);
  assert.deepEqual(capacityCheck(v, 2000), { ok: false, reason: 'over_capacity', short_by: 298 });
  assert.equal(capacityCheck(v, 1000).ok, true);
  const stale = meterView(latest, camps, sent, new Date('2026-11-09T14:00:00Z'));
  assert.equal(stale.state, 'stale');
  assert.equal(stale.used, 2398);
  assert.deepEqual(capacityCheck(stale, 10), { ok: false, reason: 'meter_not_fresh' });
  assert.equal(meterView(null, [], []).state, 'never_read');
});

test('collector: expired session and changed responses fail loudly; malformed data is never stored as zero', async () => {
  globalThis.window = { __arpGet: async () => { throw new Error('SESSION_EXPIRED'); } };
  await assert.rejects(readMeter(), /SESSION_EXPIRED/);
  globalThis.window = { __arpGet: async () => ({ quotas: {}, usage: {} }) };
  await assert.rejects(readMeter(), /UNEXPECTED_SHAPE/);
  globalThis.window = { __arpGet: async () => ({ results: [{ id: 'r1' }], hasNextPage: false }) };
  await assert.rejects(readEventUsers({ emailId: 'e1', type: 'OPENED' }), /UNEXPECTED_SHAPE/);
  await assert.rejects(ingest({}, { kind_of: 'meter', data: { quota: 'x' } }), /unexpected collector data/);
  assert.match(runAlert('Collector', { status: 'stale', finished_at: '2026-11-07T00:00:00Z', error: 'Squarespace login expired' }), /stale/);
  assert.match(runAlert('Collector', { status: 'ok', finished_at: '2026-11-01T00:00:00Z' }), /stale, last ran/);
  assert.match(runAlert('Collector', null, 'run login'), /never run/);
  delete globalThis.window;
});

test('engagement uses the real (first) open / click time, not the send date; the send date is kept apart', () => {
  const e = { delivered_campaigns: 10, last_open_campaign_at: '2026-01-05T09:00:00Z', last_open_at: '2026-10-30T20:00:00Z', last_click_campaign_at: '2026-01-05T09:00:00Z', last_click_at: null, last5_opened: 1, last5_delivered: 5, last5_clicked: 0 };
  const v = engagementView(e, true, undefined, TODAY);
  assert.equal(v.open, 'warm');
  assert.equal(v.last_opened_at, '2026-10-30T20:00:00Z');
  assert.equal(v.last_opened_email_sent_at, '2026-01-05T09:00:00Z');
  assert.equal(v.click, 'cold');
});

test('Alan\'s business address is admin, never a customer: its orders go to the attendee on the order, else unassigned', () => {
  const { st, f } = world({
    profiles: [profile('a1', 'info@alanranger.com', 'Some', 'Client', { order_count: 3 }), profile('p2', 'jo@example.com', 'Jo', 'Sample')],
    orders: [order('oa', 5001, 'info@alanranger.com', { attendee_email: 'jo@example.com', attendee_first_name: 'Jo', attendee_last_name: 'Sample' }),
      order('ob', 5002, 'info@alanranger.com', { attendee_first_name: 'Pat', attendee_last_name: 'Other' }), order('oc', 5003, 'info@alanranger.com')],
    lines: [{ order_id: 'oa', product_name: 'Woodland Walk', line_type: 'SERVICE' }, { order_id: 'ob', product_name: 'Woodland Walk', line_type: 'SERVICE' }, { order_id: 'oc', product_name: 'Woodland Walk', line_type: 'SERVICE' }],
    workshops: []
  });
  assert.deepEqual(st.admin, { orders: 3, by_email: 1, by_name: 1, unassigned: 1, value: 0 });
  const admin = f('sqs:a1');
  assert.equal(admin.admin, true);
  assert.equal(admin.bookings.length, 0);
  assert.equal(admin.history_incomplete, false);
  assert.equal(f('sqs:p2').cats.woodland.c, 1);
  assert.equal(f('name:pat other').cats.woodland.c, 1);
  assert.equal(st.byName.has('some client'), false);
  const seg = BUILTIN_SEGMENTS.find((s) => s.segment_id === 'residential-prospects').definition;
  const r = evaluate([{ person_id: 'a', anchor_key: 'sqs:a1', facts: { ...admin, subscribed: true, profile_state: 'active' } }], [resolveParams(seg)], { today: TODAY });
  assert.equal(r.members.length, 1);
  assert.equal(r.count, 0);
  assert.equal(r.admin_included, 1);
});

test('run updates keep progress counts; a later successful collector run clears an earlier stale one', () => {
  const runs = [{ kind: 'collector', status: 'stale', started_at: '2026-11-07T15:55:00Z', finished_at: '2026-11-07T15:55:10Z' }, { kind: 'collector:backfill', status: 'ok', started_at: '2026-11-07T16:30:00Z', finished_at: '2026-11-07T17:58:00Z' }, { kind: 'sync:profiles', status: 'ok', started_at: '2026-11-07T18:00:00Z', finished_at: '2026-11-07T18:00:20Z' }];
  assert.equal(latestCollectorRun(runs).status, 'ok');
  assert.equal(latestCollectorRun([runs[0]]).status, 'stale');
});

test('review and clear: one person, a typed reason; a later unsubscribe puts the block back', async () => {
  await assert.rejects(resolveOne({}, { email_hash: 'x', reason: 'long enough reason' }, async () => ({})), /one person at a time/);
  await assert.rejects(resolveOne({}, { email_hash: 'a'.repeat(64), reason: 'short' }, async () => ({})), /type a reason/);
  const updates = [];
  const fake = { from: () => ({ select: () => ({ in: () => ({ not: async () => ({ data: [{ email_hash: 'h1', resolved_at: '2026-11-07T18:00:00Z' }, { email_hash: 'h2', resolved_at: '2026-11-07T18:00:00Z' }] }) }) }), update: (patch) => ({ eq: async (_c, h) => { updates.push([h, patch.reason]); return {}; } }) }) };
  const n = await reSuppressAfterReview(fake, [{ email_hash: 'h1', at: '2026-11-08T10:00:00Z' }, { email_hash: 'h2', at: '2026-11-01T10:00:00Z' }]);
  assert.equal(n, 1);
  assert.deepEqual(updates, [['h1', 'unsubscribed_again_after_review']]);
});

test('import file safety: formula-looking names are neutralised, list names follow the Squarespace 75-char limit', () => {
  assert.equal(safeCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(safeCell('Ann'), 'Ann');
  assert.equal(validListName('ARP | Jan beginners | Beginners booked | 2026-11-07'), 'ARP | Jan beginners | Beginners booked | 2026-11-07');
  assert.throws(() => validListName('x'.repeat(76)));
});

test('query: confirmed meets "at least", probable-only / gaps are unknown, NOT and ANY groups, exact domains', () => {
  const ctx = { centre: null, today: '2026-11-07', engagementComplete: true };
  const person = (f, anchor = 'sqs:1') => ({ person_id: anchor, anchor_key: anchor, facts: { email: 'a@yahoo.com', profile_state: 'active', subscribed: true, cats: {}, ...f } });
  const val = (c, p, extra = {}) => ({ value: { c: { net: c, orders: c ? 1 : 0 }, cp: { net: c + p, orders: (c ? 1 : 0) + (p ? 1 : 0) } }, ...extra });
  const cond = (field, op, value) => ({ type: 'cond', field, op, value });
  const run = (p, root) => evalNode(validateQuery({ root }).root, rowCtx(p, ctx)).r;
  assert.equal(run(person(val(400, 0)), cond('spend_net', 'gte', 300)), 'yes');
  assert.equal(run(person(val(100, 250)), cond('spend_net', 'gte', 300)), 'unknown');
  assert.equal(run(person(val(0, 0)), cond('spend_net', 'gte', 300)), 'no');
  assert.equal(run(person(val(0, 0, { history_incomplete: true })), cond('orders', 'eq', 0)), 'unknown');
  assert.equal(run(person(val(0, 0)), cond('orders', 'eq', 0)), 'yes');
  assert.equal(run(person({}), cond('email_domain', 'is', 'yahoo.com')), 'yes');
  assert.equal(run(person({ email: 'b@yahoo.co.uk' }), cond('email_domain', 'is', 'yahoo.com')), 'no');
  assert.equal(run(person({ postcode: null }), cond('miles', 'lte', 30)), 'unknown');
  const either = { type: 'group', match: 'any', items: [cond('spend_net', 'gte', 300), cond('orders', 'gte', 2)] };
  assert.equal(run(person(val(50, 0)), either), 'no');
  assert.equal(run(person(val(500, 0)), { type: 'group', match: 'none', items: [either] }), 'no');
});

test('query: same-record clicks and bookings; probable history makes "has no" unknown, never "no"', () => {
  const ctx = { centre: null, today: '2026-11-07', engagementComplete: true };
  const p = (f) => ({ person_id: 'x', anchor_key: 'sqs:x', facts: { email: 'a@b.com', profile_state: 'active', engagement: { delivered_campaigns: 10 }, cats: {}, ...f } });
  const run = (person, root) => evalNode(validateQuery({ root }).root, rowCtx(person, ctx)).r;
  const clicks = [{ url: 'alanranger.com/lightroom-courses', at: '2026-03-01T10:00:00Z' }, { url: 'alanranger.com/workshops', at: '2026-11-01T10:00:00Z' }];
  const lightroom90 = { type: 'cond', field: 'click', op: 'exists', value: { url_contains: 'lightroom', within: { n: 90, unit: 'days' } } };
  assert.equal(run(p({ clicks }), lightroom90), 'no');
  assert.equal(run(p({ clicks: [{ url: 'alanranger.com/lightroom', at: '2026-10-20T10:00:00Z' }] }), lightroom90), 'yes');
  assert.equal(run(p({ clicks: [], email: null }), lightroom90), 'unknown');
  const noLr = { type: 'cond', field: 'booking', op: 'none', value: { cats: ['lightroom'] } };
  assert.equal(run(p({ bookings: [{ date: '2025-01-01', cats: ['beginners'], role: 'buyer' }], booking_count: 1 }), noLr), 'yes');
  assert.equal(run(p({ bookings: [], booking_count: 0, cats: { lightroom: { c: 0, p: 1 } } }), noLr), 'unknown');
  assert.equal(run(p({ bookings: [{ date: '2025-01-01', cats: ['lightroom'], role: 'attendee' }], booking_count: 1 }), noLr), 'no');
  assert.throws(() => validateQuery({ root: { type: 'cond', field: 'raw_sql', op: 'is', value: 'x' } }));
});

test('value: a Booking Sheet sale that is the same Squarespace order counts once; voucher redemptions are not spend', () => {
  const st = buildIdentities({
    profiles: [{ profile_id: 'p1', email: 'ann@x.com', first_name: 'Ann', last_name: 'Lee', accepts_marketing: true }],
    orders: [{ order_id: 'o1', order_number: 3001, created_on: '2025-05-01T10:00:00Z', customer_email: 'ann@x.com', grand_total_gbp: 150, refunded_total_gbp: 0 }],
    lines: [{ order_id: 'o1', product_name: 'Beginners course', quantity: 1 }],
    transactions: [
      { source_workbook: 'w', source_row: 1, txn_date: '2025-05-02', client_name: 'Ann Lee', amount: 150, funding: 'Stripe', category_label: 'Courses', is_redemption: false },
      { source_workbook: 'w', source_row: 2, txn_date: '2025-06-10', client_name: 'Ann Lee', amount: 90, funding: 'Bank', category_label: '1-2-1', is_redemption: false },
      { source_workbook: 'w', source_row: 3, txn_date: '2025-07-10', client_name: 'Ann Lee', amount: -50, funding: 'Gift Voucher Out', category_label: 'Vouchers', is_redemption: true }
    ]
  });
  const ann = st.persons.get('sqs:p1');
  const nameRec = st.persons.get('name:ann lee');
  const v = valueFacts(ann, [nameRec], '2026-11-07').value;
  assert.equal(v.c.net, 150);
  assert.equal(v.c.orders, 1);
  assert.equal(v.p.net, 90);
  assert.equal(v.cp.orders, 2);
});

test('Part 1 rules: record types, partial refunds count, offers end on their date, run rate excludes withdrawn', () => {
  assert.equal(recordType({ name: 'Pick n Mix Subs' }), 'system');
  assert.equal(recordType({ name: 'Mentoring Subs' }), 'system');
  assert.equal(recordType({ email: 'no-reply@squarespace.com' }), 'system');
  assert.equal(recordType({ name: 'HOMD Consulting Limited' }), 'organisation');
  assert.equal(recordType({ name: 'Birkdale' }), 'organisation');
  assert.equal(recordType({ name: 'Elaine Cash' }), 'person');
  assert.equal(recordType({ name: 'Ross Schoolar' }), 'person');
  assert.equal(orderCancelled({ payment_state: 'REFUNDED', grand_total_gbp: 400, refunded_total_gbp: 150 }), false);
  assert.equal(orderCancelled({ payment_state: 'REFUNDED', grand_total_gbp: 400, refunded_total_gbp: 400 }), true);
  assert.equal(orderCancelled({ fulfillment_status: 'CANCELED', grand_total_gbp: 400 }), true);
  const offer = { note: '£150 off', ends: '2026-11-14' };
  assert.equal(offerOn(offer, '2026-11-14'), offer);
  assert.equal(offerOn(offer, '2026-11-19'), null);
  const outcomes = [{ type: 'day', outcome: 'ran' }, { type: 'day', outcome: 'withdrawn' }, { type: 'day', outcome: 'cancelled' }];
  assert.equal(computeRunRate(outcomes).countLine.split(' | ')[0], '1/2');
});

test('list load: before-check drops not subscribed / suppressed / missing; pre-send PASS lasts 30 minutes', () => {
  const c = { byEmail: new Map([['a@x.com', { accepts_marketing: true }], ['b@x.com', { accepts_marketing: false }], ['c@x.com', { accepts_marketing: true }], ['d@x.com', { accepts_marketing: true, missing_since: '2026-11-01' }]]), suppressed: new Set([emailHash('c@x.com')]) };
  assert.deepEqual(['A@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'].map((e) => stateOf(e, c)), ['pass', 'not_subscribed', 'suppressed', 'missing', 'missing']);
  const at = '2026-11-07T12:00:00Z';
  const t = Date.parse(at);
  assert.equal(presendState({ presend_at: at, presend_result: { result: 'PASS' } }, t + 29 * 60000).state, 'pass');
  assert.equal(presendState({ presend_at: at, presend_result: { result: 'PASS' } }, t + 31 * 60000).state, 'not_checked');
  assert.equal(presendState({ presend_at: at, presend_result: { result: 'FAIL' } }, t + 60000).state, 'fail');
  assert.equal(presendState({}).state, 'not_checked');
});
