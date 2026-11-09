/**
 * Same sale in two sources, checked after identity resolution (Claude 8 Nov 2026): a Booking Sheet row under a name
 * variant that is the same money as the person's Squarespace order or plan payment is not added again. Plus plan file
 * name reading (headings are never names; file-name fallback; templates skipped).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeSales, planSheetWindow, summarise } from '../lib/marketing/value.mjs';
import { buildIdentities } from '../lib/marketing/identity.mjs';
import { clientFromFile, clientName, TEMPLATE_FILE } from '../scripts/pnm-plans/parse.mjs';

const order = (n, date, gross, refunded = 0) => ({ level: 'c', src: 'squarespace', key: `sqs:${n}`, date, net: gross - refunded, gross, refunded, places: 1, cancelled: false, cats: [] });
const sheet = (date, amount, category = '4. Pick n Mix Inc', funding = 'Stripe') => ({ level: 'c', src: 'booking_sheet', key: null, date, net: amount, gross: amount, refunded: 0, places: 1, cancelled: false, cats: [], category, funding });
const plan = (date, amount, starts = '2025-09-22', ends = '2026-09-21') => ({ level: 'c', src: 'plan', key: 'plan-x', date, net: amount, gross: amount, refunded: 0, places: 0, cancelled: false, cats: ['pick_n_mix'], starts, ends });

test('Client A shape: two Booking Sheet rows that are Squarespace orders are kept as duplicates, not added', () => {
  const list = [order(3112, '2025-09-22', 1200), order(2832, '2024-08-09', 200, 20), sheet('2025-09-22', 1200), sheet('2024-08-09', 200), sheet('2025-03-01', 100)];
  const out = dedupeSales(list);
  const dups = out.filter((x) => x.duplicate_of);
  assert.deepEqual(dups.map((x) => x.duplicate_of).sort(), ['#2832', '#3112']);
  const s = summarise(out, '2026-11-08');
  assert.equal(s.net, 1200 + 180 + 100);
  assert.equal(s.orders, 3);
  assert.equal(s.cancelled_orders, 0);
});

test('a sheet row matching a plan payment within 10 days is that payment; a different amount or date is new money', () => {
  const out = dedupeSales([plan('2025-10-01', 50), sheet('2025-10-09', 50), sheet('2025-10-09', 75), sheet('2025-12-01', 50)]);
  assert.equal(out.filter((x) => x.duplicate_of).length, 1);
  assert.equal(summarise(out, '2026-11-08').net, 50 + 75 + 50);
});

test('Alan 8 Nov: a Stripe 1-2-1 of the plan amount within 10 days is a separate payment; both count', () => {
  const p = plan('2025-10-01', 50);
  const out = dedupeSales([p, sheet('2025-10-09', 50, '7. 1-2-1', 'Stripe')]);
  assert.equal(out.filter((x) => x.duplicate_of).length, 0);
  assert.equal(p.on_sheet, undefined);
  assert.equal(summarise(out, '2026-11-08').net, 100);
});

test('Alan 8 Nov: a Bank row of the plan amount inside the plan period is the plan payment, counted once as the plan', () => {
  const p = plan('2026-06-01', 496.2);
  const out = dedupeSales([p, sheet('2026-06-28', 496.2, '3. Workshops Residential', 'Bank')]);
  assert.equal(out.filter((x) => x.duplicate_of).length, 1);
  assert.equal(p.on_sheet, true);
  assert.equal(summarise(out, '2026-11-08').net, 496.2);
  assert.equal(dedupeSales([plan('2026-06-01', 496.2), sheet('2026-12-01', 496.2, '3. Workshops Residential', 'Bank')]).filter((x) => x.duplicate_of).length, 0);
});

test('planSheetWindow: Pick n Mix Inc within 10 days; Bank within plan period ±31 days (10 days with no start); others never', () => {
  const pay = { date: '2026-06-01', starts: '2025-09-22', ends: '2026-09-21' };
  assert.ok(planSheetWindow({ date: '2026-06-10', category: '4. Pick n Mix Inc', funding: 'Stripe' }, pay));
  assert.ok(!planSheetWindow({ date: '2026-06-20', category: '4. Pick n Mix Inc', funding: 'Stripe' }, pay));
  assert.ok(planSheetWindow({ date: '2026-10-20', category: '7. 1-2-1', funding: 'Bank' }, pay));
  assert.ok(!planSheetWindow({ date: '2026-10-23', category: '7. 1-2-1', funding: 'Bank' }, pay));
  assert.ok(!planSheetWindow({ date: '2026-06-01', category: '7. 1-2-1', funding: 'Stripe' }, pay));
  assert.ok(planSheetWindow({ date: '2026-06-08', category: '7. 1-2-1', funding: 'Bank' }, { date: '2026-06-01' }));
  assert.ok(!planSheetWindow({ date: '2026-06-20', category: '7. 1-2-1', funding: 'Bank' }, { date: '2026-06-01' }));
});

test('identity: plan payments only absorb Pick n Mix Inc / Bank-in-period sheet rows of the plan client', () => {
  const tx = (row, date, amount, category, funding) => ({ source_workbook: 'w', source_row: row, txn_date: date, client_name: 'Client A', category_label: category, event_label: 'x', channel: null, is_redemption: false, amount, funding });
  const st = buildIdentities({
    transactions: [tx(1, '2025-10-09', 50, '7. 1-2-1', 'Stripe'), tx(2, '2026-06-28', 496.2, '3. Workshops Residential', 'Bank'), tx(3, '2026-02-18', 286, '4. Pick n Mix Inc', 'Stripe')],
    plans: [{ plan_key: 'pk', client_name: 'Client A', email: 'a@example.com', plan_type: 'annual', starts: '2025-09-22', ends: '2026-09-21', paid_total: 832.2 }],
    planPayments: [{ plan_key: 'pk', line_no: 1, amount: 50, paid_on: '2025-10-01', date_reliable: true }, { plan_key: 'pk', line_no: 2, amount: 496.2, paid_on: '2026-06-01', date_reliable: true }, { plan_key: 'pk', line_no: 3, amount: 286, paid_on: '2026-02-17', date_reliable: true }]
  });
  assert.equal(st.persons.get('name:client a'), undefined, 'the plan email names Client A: the sheet rows are theirs');
  const rows = st.persons.get('email:a@example.com').payments;
  assert.deepEqual(rows.map((x) => !!x.plan_attributed), [false, true, true]);
  assert.deepEqual(st.persons.get('email:a@example.com').plan_payments.map((p) => !!p.on_sheet), [false, true, true]);
});

test('probable records are checked against the confirmed list; one order absorbs one sheet row only', () => {
  const confirmed = [order(1, '2026-01-10', 300)];
  const out = dedupeSales([{ ...sheet('2026-01-11', 300), level: 'p' }, { ...sheet('2026-01-12', 300), level: 'p' }], confirmed);
  assert.equal(out.filter((x) => x.duplicate_of).length, 1);
});

test('plan names: headings are never names; row 2 or the file name is used; templates are skipped', () => {
  assert.equal(clientName([['First Name', 'Last Name'], ['Howard', 'Allen']], 'Howard Allen 2015 pick n mix plan.xlsx'), 'Howard Allen');
  assert.equal(clientName([['Name', null], ['Kirsten', 'Pearce'], ['x@y.com']], 'f.xlsx'), 'Kirsten Pearce');
  assert.equal(clientName([['Client', 'Joyce James']], 'f.xlsx'), 'Joyce James');
  assert.equal(clientName([['Name'], [null, null]], 'Mike Smith 2015 pick n mix plan.xlsx'), 'Mike Smith');
  assert.equal(clientFromFile('Con McHugh2015 pick n mix plan .xlsx'), 'Con McHugh');
  assert.equal(clientFromFile('2018 pick n mix plan.xlsx'), null);
  assert.ok(TEMPLATE_FILE.test('2018 pick n mix plan.xlsx') && !TEMPLATE_FILE.test('Fiona Brown 2018 pick n mix plan.xlsx'));
});
