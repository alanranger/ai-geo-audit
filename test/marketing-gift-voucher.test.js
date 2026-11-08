/**
 * Gift voucher rule (Alan, 8 Nov 2026): a voucher is the BUYER's spend when bought (Squarespace GIFT_CARD order or a
 * Booking Sheet "Gift Vouchers Inc" sale). A redemption (event income funded "Gift Voucher Out" + the matching
 * "Gift Vouchers Out" minus) is new spend for nobody — including a Squarespace order the redeemer paid with the voucher.
 *   node --test test/marketing-gift-voucher.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIdentities } from '../lib/marketing/identity.mjs';
import { valueFacts } from '../lib/marketing/value.mjs';

const TODAY = '2026-11-08';
const profile = (id, email, first, last) => ({ profile_id: id, email, first_name: first, last_name: last, accepts_marketing: true });
const order = (id, num, email, date, total) => ({ order_id: id, order_number: num, customer_email: email, created_on: `${date}T10:00:00Z`, grand_total_gbp: total, refunded_total_gbp: 0, payment_state: 'PAID', fulfillment_status: 'FULFILLED', testmode: false });
const giftCard = (orderId) => ({ order_id: orderId, product_name: 'Photography Gift Vouchers | Digital eCard', line_type: 'GIFT_CARD', quantity: 1 });
const service = (orderId) => ({ order_id: orderId, product_name: 'Bluebell Woodland Photography Workshops', line_type: 'SERVICE', quantity: 1 });
const tx = (row, date, name, amount, category, funding, isRedemption = false) => ({ source_workbook: 'w', source_row: row, txn_date: date, client_name: name, category_label: category, event_label: 'Bluebell Woodland', channel: null, is_redemption: isRedemption, amount, funding });
const redemptionPair = (row, date, name, amount) => [
  tx(row, date, name, amount, '2. Workshops Non Residential', 'Gift Voucher Out'),
  tx(row + 1, date, name, -amount, '9. Gift Vouchers Out', 'Gift Voucher Out', true)
];

const confirmed = (st, anchor) => valueFacts(st.persons.get(anchor), [], TODAY);
const everyoneNet = (st) => Math.round([...st.persons.values()].reduce((a, p) => a + valueFacts(p, [], TODAY).value.c.net, 0) * 100) / 100;

test('voucher bought on Squarespace is the buyer\'s spend (no place)', () => {
  const st = buildIdentities({
    profiles: [profile('p1', 'bea@example.com', 'Bea', 'Buyer')],
    orders: [order('o1', 5001, 'bea@example.com', '2025-11-20', 100)],
    lines: [giftCard('o1')]
  });
  const f = confirmed(st, 'sqs:p1');
  assert.equal(f.value.c.net, 100);
  assert.equal(f.value.c.orders, 1);
  assert.equal(f.value.c.places, 0);
  assert.ok(f.purchases[0].cats.includes('voucher_bought'));
  assert.equal(f.purchases[0].voucher_funded, undefined);
});

test('voucher bought on the Booking Sheet ("8. Gift Vouchers Inc", paid by card) is the buyer\'s spend', () => {
  const st = buildIdentities({ transactions: [tx(1, '2025-12-01', 'Gail Giver', 75, '8. Gift Vouchers Inc', 'Stripe')] });
  const f = confirmed(st, 'name:gail giver');
  assert.equal(f.value.c.net, 75);
  assert.equal(f.value.c.orders, 1);
  assert.ok(f.purchases[0].cats.includes('voucher_bought'));
});

test('the same voucher sale on Squarespace and the Booking Sheet counts once for the buyer', () => {
  const st = buildIdentities({
    profiles: [profile('p1', 'bea@example.com', 'Bea', 'Buyer')],
    orders: [order('o1', 5001, 'bea@example.com', '2025-11-20', 100)],
    lines: [giftCard('o1')],
    transactions: [tx(1, '2025-11-20', 'Bea Buyer', 100, '8. Gift Vouchers Inc', 'Stripe')]
  });
  const f = valueFacts(st.persons.get('sqs:p1'), [st.persons.get('name:bea buyer')], TODAY);
  assert.equal(f.value.c.net, 100);
  assert.equal(f.value.cp.net, 100);
  assert.equal(everyoneNet(st), 100);
});

test('Booking Sheet redemption pair (event income + Gift Vouchers Out minus) is new spend for nobody', () => {
  const st = buildIdentities({
    transactions: [tx(1, '2025-12-01', 'Gail Giver', 75, '8. Gift Vouchers Inc', 'Stripe'), ...redemptionPair(2, '2026-03-10', 'Rita Redeemer', 75)]
  });
  const rita = confirmed(st, 'name:rita redeemer');
  assert.equal(rita.value.c.net, 0);
  assert.equal(rita.value.c.orders, 0);
  assert.equal(rita.value.c.refunds, 0);
  assert.equal(confirmed(st, 'name:gail giver').value.c.net, 75);
  assert.equal(everyoneNet(st), 75);
});

test('redemption paid with the voucher at Squarespace checkout: the order counts no money for the redeemer', () => {
  const st = buildIdentities({
    profiles: [profile('p1', 'bea@example.com', 'Bea', 'Buyer'), profile('p2', 'rita@example.com', 'Rita', 'Redeemer')],
    orders: [order('o1', 5001, 'bea@example.com', '2025-11-20', 100), order('o2', 5002, 'rita@example.com', '2026-03-10', 100)],
    lines: [giftCard('o1'), service('o2')],
    transactions: redemptionPair(1, '2026-03-10', 'Rita Redeemer', 100)
  });
  const rita = valueFacts(st.persons.get('sqs:p2'), [st.persons.get('name:rita redeemer')], TODAY);
  assert.equal(rita.value.cp.net, 0);
  assert.equal(rita.value.c.places, 1);
  const row = rita.purchases.find((x) => x.key === 'sqs:5002');
  assert.equal(row.voucher_funded, true);
  assert.equal(row.net, 0);
  assert.equal(confirmed(st, 'sqs:p1').value.c.net, 100);
  assert.equal(everyoneNet(st), 100);
});

test('a gift card the redeemer bought the day before is still their spend; only the voucher-paid order is zeroed', () => {
  const st = buildIdentities({
    profiles: [profile('p2', 'rita@example.com', 'Rita', 'Redeemer')],
    orders: [order('o3', 5003, 'rita@example.com', '2026-03-09', 100), order('o2', 5002, 'rita@example.com', '2026-03-10', 100)],
    lines: [giftCard('o3'), service('o2')],
    transactions: redemptionPair(1, '2026-03-10', 'Rita Redeemer', 100)
  });
  const f = confirmed(st, 'sqs:p2');
  assert.equal(f.value.c.net, 100);
  assert.equal(f.purchases.find((x) => x.key === 'sqs:5003').voucher_funded, undefined);
  assert.equal(f.purchases.find((x) => x.key === 'sqs:5002').voucher_funded, true);
});

test('a card-paid Squarespace order with no voucher row on the sheet stays full spend', () => {
  const st = buildIdentities({
    profiles: [profile('p2', 'rita@example.com', 'Rita', 'Redeemer')],
    orders: [order('o2', 5002, 'rita@example.com', '2026-03-10', 100)],
    lines: [service('o2')],
    transactions: [tx(1, '2026-03-10', 'Rita Redeemer', 100, '2. Workshops Non Residential', 'Stripe')]
  });
  const f = valueFacts(st.persons.get('sqs:p2'), [st.persons.get('name:rita redeemer')], TODAY);
  assert.equal(f.value.cp.net, 100);
  assert.equal(f.purchases.find((x) => x.key === 'sqs:5002').voucher_funded, undefined);
});
