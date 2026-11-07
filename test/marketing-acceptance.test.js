/**
 * Marketing & Campaigns — GPT acceptance evidence on controlled fixtures (no real people, example.com addresses).
 *   node --test test/marketing-acceptance.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { band } from '../lib/marketing/engagement.mjs';
import { safeCell, validListName } from '../lib/marketing/exports.mjs';
import { allFacts } from '../lib/marketing/facts.mjs';
import { runAlert } from '../lib/marketing/health.mjs';
import { buildIdentities, sqsOrderNumber } from '../lib/marketing/identity.mjs';
import { ingest } from '../lib/marketing/collector-ingest.mjs';
import { capacityCheck, cycleOf, meterView } from '../lib/marketing/meter.mjs';
import { BUILTIN_SEGMENTS, consentReason, evaluate } from '../lib/marketing/segments.mjs';
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
  const seg = BUILTIN_SEGMENTS.find((s) => s.segment_id === 'beginners-no-lightroom-local').definition;
  const person = (facts) => ({ person_id: 'x', facts: { email: 'a@example.com', subscribed: true, profile_state: 'active', lat: 52.4, lng: -1.59, cats: { beginners: { c: 1, p: 0 } }, ...facts } });
  const ctx = { centre: { lat: 52.3998, lng: -1.5942 }, today: TODAY };
  assert.deepEqual(evaluate([person({ history_incomplete: true })], [seg], ctx).exclusions, { history_incomplete: 1 });
  assert.equal(evaluate([person({ history_incomplete: false })], [seg], ctx).count, 1);
  assert.equal(band(null, null, true), 'unknown');
  assert.equal(band(null, { delivered_campaigns: 5 }, false), 'unknown');
  assert.equal(band(null, { delivered_campaigns: 5 }, true), 'none_recorded');
  assert.equal(band(null, { delivered_campaigns: 2 }, true), 'insufficient');
  assert.equal(band('2026-10-01T00:00:00Z', { delivered_campaigns: 5 }, true, undefined, TODAY), 'warm');
  assert.equal(band('2026-03-01T00:00:00Z', { delivered_campaigns: 5 }, false, undefined, TODAY), 'unknown');
});

test('selected recipients are deduplicated; unsubscribed and suppressed people are excluded', () => {
  const p = (id, email, extra = {}) => ({ person_id: id, facts: { email, subscribed: true, profile_state: 'active', cats: { residential: { c: 1, p: 0 }, day_workshop: { c: 1, p: 0 } }, ...extra } });
  const defs = [BUILTIN_SEGMENTS[3].definition, BUILTIN_SEGMENTS[2].definition];
  const r = evaluate([p('1', 'a@example.com'), p('2', 'a@example.com'), p('3', 'b@example.com', { subscribed: false }), p('4', 'c@example.com', { suppressed: 'unsubscribed' })], defs, { today: TODAY, centre: null });
  assert.equal(r.count, 1);
  assert.deepEqual(r.exclusions, { duplicate_email: 1, not_subscribed: 1, 'suppressed:unsubscribed': 1 });
});

test('deleted and JLR-unsubscribed contacts never reappear, even if Squarespace later shows them subscribed', () => {
  const now = '2026-11-07T00:00:00Z';
  const first = suppressionChanges([{ profile_id: 'j1', email: 'x@jaguarlandrover.com', accepts_marketing: false }], [], now);
  assert.equal(first.suppress[0].reason, 'jlr_unsubscribed_cleanup_2026_11_07');
  const later = suppressionChanges([{ profile_id: 'a', email: 'a@example.com', accepts_marketing: false }], [{ profile_id: 'a', email: 'a@example.com', accepts_marketing: true }, { profile_id: 'gone', email: 'g@example.com', accepts_marketing: true }], now);
  assert.deepEqual(later.suppress.map((s) => s.reason).sort(), ['deleted_in_squarespace', 'unsubscribed']);
  assert.deepEqual(later.gone, ['gone']);
  assert.equal(first.suppress[0].email_hash, emailHash('X@JaguarLandRover.com '));
  assert.equal(consentReason({ email: 'x@jaguarlandrover.com', subscribed: true, profile_state: 'active', suppressed: 'jlr_unsubscribed_cleanup_2026_11_07' }), 'suppressed:jlr_unsubscribed_cleanup_2026_11_07');
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

test('import file safety: formula-looking names are neutralised, list names follow the Squarespace 75-char limit', () => {
  assert.equal(safeCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(safeCell('Ann'), 'Ann');
  assert.equal(validListName('ARP | Jan beginners | Beginners booked | 2026-11-07'), 'ARP | Jan beginners | Beginners booked | 2026-11-07');
  assert.throws(() => validListName('x'.repeat(76)));
});
