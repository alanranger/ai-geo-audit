/**
 * Same sale in two sources, checked after identity resolution (Claude 8 Nov 2026): a Booking Sheet row under a name
 * variant that is the same money as the person's Squarespace order or plan payment is not added again. Plus plan file
 * name reading (headings are never names; file-name fallback; templates skipped).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeSales, summarise } from '../lib/marketing/value.mjs';
import { clientFromFile, clientName, TEMPLATE_FILE } from '../scripts/pnm-plans/parse.mjs';

const order = (n, date, gross, refunded = 0) => ({ level: 'c', src: 'squarespace', key: `sqs:${n}`, date, net: gross - refunded, gross, refunded, places: 1, cancelled: false, cats: [] });
const sheet = (date, amount) => ({ level: 'c', src: 'booking_sheet', key: null, date, net: amount, gross: amount, refunded: 0, places: 1, cancelled: false, cats: [] });
const plan = (date, amount) => ({ level: 'c', src: 'plan', key: 'plan-x', date, net: amount, gross: amount, refunded: 0, places: 0, cancelled: false, cats: ['pick_n_mix'] });

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
