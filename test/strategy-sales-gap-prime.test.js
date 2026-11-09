/**
 * QUESTION-2026-11-09 (j) + (k): editable assumptions labelled "set 9 Nov, review later"; monthly "In prime buying
 * window" (P25–P75 band) with the overlap footnote; no monthly best case; recalculated from inputs (no stale cache);
 * Prospects: ENQ ref + received date required; client link (email → exact unique name → new prospect, no consent change).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ASSUMPTIONS, ON_SALE_DAYS, buildSalesGap, eventLikely, monthsFrom, primeIn } from '../lib/strategy-sales-gap.mjs';
import { daysOpen, pickClient, prospectPersonRow, shortClientId } from '../lib/strategy-prospects.mjs';
import { clientEmail, enquiryPatch, stageRule } from '../api/aigeo/prospects.js';

const TODAY = '2026-11-09';
const LEAD = { day: { n: 120, q25_days: 19, median_days: 45, q75_days: 139 }, residential: { n: 17, q25_days: 31, median_days: 76, q75_days: 104 }, course: { n: 25, q25_days: 23, median_days: 36, q75_days: 63 } };
const FILL = { day: 0.559, residential: 0.563, course: 0.583, all: 0.563 };
const lake = { eventKey: 'lake', date: '2027-01-22', title: 'Lake District Photography Workshop', type: 'residential', cap: 4, booked: 2, left: 2, price: 1075 };
const macro = { eventKey: 'macro', date: '2026-11-28', title: 'Abstract and Macro Photography Workshop', type: 'day', cap: 4, booked: 0, left: 4, price: 75 };
const spring = { eventKey: 'spring', date: '2027-05-20', title: 'Bluebell Photography Workshop', type: 'day', cap: 6, booked: 0, left: 6, price: 95 };
const run = (txns = []) => buildSalesGap({ today: TODAY, txns, targets: Array(12).fill(5000), events: [lake, macro, spring], fill: FILL, lead: LEAD, freshness: { booking_sheet: '2026-11-09T12:10:00Z', events: '2026-11-09' } });

test('(j) the four confirmed choices are editable assumptions, "set 9 Nov, review later" (no behaviour change)', () => {
  assert.equal(ON_SALE_DAYS, 400);
  assert.deepEqual(ASSUMPTIONS.map((a) => a.key), ['on_sale_window', 'booking_window', 'lever2', 'targets_2027']);
  assert.ok(ASSUMPTIONS.every((a) => a.status === 'set 9 Nov, review later'));
  assert.match(ASSUMPTIONS[1].value, /2 × the type's 75th-percentile lead time \(day 278 \/ residential 208 \/ course 126/);
  assert.match(ASSUMPTIONS[2].value, /up to 2 new day workshops a month, on sale by month end − the day median lead time \(45 days/);
  assert.equal(run().assumptions.length, 4);
});

test('(k) prime buying window = the P25–P75 lead-time band: an event can be prime in more than one month', () => {
  const months = monthsFrom(TODAY, 8);
  const evs = [lake, macro, spring].map((e) => eventLikely(e, { today: TODAY, fill: FILL, lead: LEAD }, months));
  assert.deepEqual(evs[0].prime, { from: '2026-10-10', to: '2026-12-22' }, 'Lake District 22 Jan: 104 → 31 days before');
  const nov = primeIn(evs, '2026-11-01', '2026-11-30', TODAY);
  const dec = primeIn(evs, '2026-12-01', '2026-12-31', TODAY);
  const jan = primeIn(evs, '2027-01-01', '2027-01-31', TODAY);
  assert.deepEqual(nov.list.map((e) => e.key), ['lake', 'macro'], 'Macro 28 Nov: prime until 9 Nov (19 days before) – today still counts');
  assert.deepEqual(dec.list.map((e) => e.key), ['lake'], 'Bluebells 20 May: prime from 1 Jan (139 days before)');
  assert.deepEqual(jan.list.map((e) => e.key), ['spring'], 'Lake District is past its prime by January (bookings normally in by 22 Dec)');
  assert.equal(nov.places, 6);
  assert.ok(nov.events + dec.events + jan.events > 3, 'Lake District is prime in Nov and Dec: months overlap, so they do not add up to the stock');
});

test('(k) month tiles: prime window + outside list + likely contributors; footnote; no monthly best case; quarter best case only above £0', () => {
  const g = run();
  const nov = g.months[0];
  assert.equal(nov.prime.events, 2);
  assert.ok(nov.outside.list.every((e) => !nov.prime.list.some((p) => p.date === e.date && p.title === e.title)));
  assert.ok(nov.likely_from.length >= 1);
  assert.match(g.footnote, /^An event can be in its buying window in more than one month, so months don't add up to the quarter\.$/);
  const ctx = { document: { addEventListener() {} }, console, Intl, Date, Math, Number, String, JSON, Promise, Object };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(new URL('../lib/strategy-sales-gap.js', import.meta.url), 'utf8'), ctx);
  const html = ctx.stSalesGapHtml({ sales_gap: g }).tiles;
  assert.match(html, /In prime buying window this month/);
  assert.match(html, /Stock on sale now/);
  assert.doesNotMatch(html, /Dated places sellable this month|every sellable place sells/);
  assert.match(html, /months don't add up to the quarter/);
  assert.match(html, /On-sale stock outside the prime window/);
  assert.match(html, /as of Booking Sheet sync .* · events 9 Nov · recalculated on every load/);
  assert.match(html, /set 9 Nov, review later/);
  assert.ok(g.rolling.best_case > 0, 'small fixture stock: the quarter best case is above £0, so it shows');
  assert.match(html, /Best case: all stock on sale sells/);
  const big = buildSalesGap({ today: TODAY, txns: [], targets: Array(12).fill(100), events: [lake, macro, spring], fill: FILL, lead: LEAD });
  assert.equal(big.rolling.best_case, 0);
  assert.doesNotMatch(ctx.stSalesGapHtml({ sales_gap: big }).tiles, /Best case/, 'quarter best case hidden at £0');
});

test('(k) rolling and live: figures are recomputed from inputs on every call (no cached result); the API is no-store', () => {
  const before = run();
  const after = run([{ txn_date: '2026-11-10', category_order: 3, amount: 1075 }]);
  assert.equal(before.freshness.cached, false);
  assert.equal(after.months[0].sold - before.months[0].sold, 1075, 'a new Booking Sheet sale shows on the next load');
  assert.equal(before.months[0].still_to_sell - after.months[0].still_to_sell, 1075);
  const api = fs.readFileSync(new URL('../api/aigeo/strategy-summary.js', import.meta.url), 'utf8');
  assert.match(api, /'Cache-Control', 'no-store'/);
});

test('(j) Prospects: received date required, ENQ ref generated by the database, days open', () => {
  assert.throws(() => stageRule(null, { client_or_org: 'X', type: 'other' }, null), /enquiry_date/);
  assert.equal(stageRule(null, { client_or_org: 'X', type: 'other', enquiry_date: '2026-11-02' }, null), 'qualify');
  assert.throws(() => enquiryPatch({ enquiry_date: '2099-01-01' }), /future/);
  const sql = fs.readFileSync(new URL('../migrations/prospect_enquiry_ref_client_20261109.sql', import.meta.url), 'utf8');
  assert.match(sql, /enquiry_ref text not null default \('ENQ-' \|\| lpad\(nextval/);
  assert.match(sql, /enquiry_date date not null/);
  assert.equal(daysOpen({ stage: 'quote', enquiry_date: '2026-11-02' }, TODAY), 7);
  assert.equal(daysOpen({ stage: 'booked_paid', enquiry_date: '2026-11-02' }, TODAY), null);
});

test('(j) client ID: email first, then an exact name naming ONE contact with an email; else a new prospect record with no consent change', () => {
  assert.deepEqual(pickClient({ byEmail: [{ person_id: 'p1' }], byName: [], name: 'A B' }), { person_id: 'p1', method: 'email_exact' });
  const one = [{ person_id: 'p2', display_name: 'Jo Bloggs', email: 'x@y.z' }, { person_id: 'p3', display_name: 'Jo Bloggs', email: null }];
  assert.deepEqual(pickClient({ byName: one, name: 'jo  bloggs' }), { person_id: 'p2', method: 'name_exact_unique' });
  const two = [...one, { person_id: 'p4', display_name: 'Jo Bloggs', email: 'q@y.z' }];
  assert.equal(pickClient({ byName: two, name: 'Jo Bloggs' }).person_id, null, 'ambiguous names never pick a person');
  const row = prospectPersonRow({ name: 'New Client', email: 'New@Example.com', now: '2026-11-09T15:00:00Z', uid: 'u1' });
  assert.equal(row.anchor_key, 'email:new@example.com', 'the identity code\'s own key, so a later rebuild adopts this record');
  assert.equal(row.facts.record_type, 'prospect');
  for (const k of ['subscribed', 'suppressed', 'consent_source', 'camps']) assert.ok(!(k in row.facts), `no ${k}: no consent or audience change`);
  assert.equal(prospectPersonRow({ name: 'No Email', now: 'x', uid: 'u2' }).anchor_key, 'prospect:u2');
  assert.match(shortClientId('7f3a9c12-0000-4000-8000-000000000000'), /^C-7F3A9C$/);
  assert.throws(() => clientEmail('not-an-email'), /client_email/);
});
