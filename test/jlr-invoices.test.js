import test from 'node:test';
import assert from 'node:assert/strict';
import xlsx from 'xlsx';
import { jlrCash, parseJlrInvoices, shortEvent } from '../lib/jlr-invoices.mjs';
import { realisticCover } from '../lib/strategy-sales-gap-cover.mjs';
import { nonDatedCover } from '../lib/strategy-sales-gap.mjs';

const TODAY = '2026-11-17';
const batsford = (name, gbp, extra = {}) => ({
  client_name: name,
  event_name: 'Batsford Arboretum Autumn Half-Day Photography Workshop',
  invoice_date: '2026-10-12',
  due_date: '2026-12-08',
  outstanding: gbp,
  ...extra
});

test('invoiced JLR counts in the due month; a future invoice with no number stays out', () => {
  const rows = [
    batsford('Andrew Barley', 99),
    batsford('Holly Pownall', 99),
    batsford('Ranjith Kalikutty', 99),
    batsford('Mattia Tosi', 100, { event_name: 'Batsford Arboretum 1-day Photography Workshop' }),
    { client_name: 'Alice McDonald', event_name: '1-2-1', invoice_no: '20261112-01', invoice_date: '2026-10-31', due_date: '2026-12-27', outstanding: 100 },
    { client_name: 'Sridhar Eswaran', event_name: '1-2-1', invoice_date: '2026-11-29', due_date: '2027-01-25', outstanding: 100 }
  ];
  const cash = jlrCash(rows, { today: TODAY });
  assert.equal(cash.by_month['2026-12'], 497);
  assert.equal(cash.by_month['2027-01'], undefined);
  assert.equal(cash.by_month['2026-11'], undefined);
  assert.ok(cash.lines.some((l) => l.label === 'JLR · Batsford ×4 · due 8 Dec' && l.gbp === 397));
  const jan = cash.lines.find((l) => l.month === '2027-01');
  assert.equal(jan.counted, false);
  assert.equal(jan.chip, 'To invoice');
});

test('a matching paid JLR sale drops that invoice and leaves it counted once as a sale', () => {
  const rows = [batsford('Andrew Barley', 99), batsford('Holly Pownall', 99)];
  const txns = [{ is_jlr: true, client_name: 'Andrew Barley', amount: 99, txn_date: '2026-12-08' }];
  const cash = jlrCash(rows, { today: TODAY, txns });
  assert.equal(cash.by_month['2026-12'], 99);
  assert.equal(txns.length, 1);
});

test('an overdue invoice counts in the current month, red only at 30 days', () => {
  const cash = jlrCash([
    { client_name: 'A', event_name: 'Walk', invoice_no: '1', due_date: '2026-10-01', outstanding: 50 },
    { client_name: 'B', event_name: 'Walk', invoice_no: '2', due_date: '2026-11-10', outstanding: 20 }
  ], { today: TODAY });
  assert.equal(cash.by_month['2026-11'], 70);
  assert.equal(cash.lines.find((l) => l.gbp === 50).tone, 'red');
  assert.equal(cash.lines.find((l) => l.gbp === 20).tone, 'amber');
});

test('normal non-dated sales skip paid JLR in the same category', () => {
  const cover = nonDatedCover([
    { txn_date: '2025-12-10', category_order: 7, amount: 100, is_jlr: true },
    { txn_date: '2025-12-11', category_order: 7, amount: 40 }
  ], { start: '2025-12-01', end: '2025-12-31' }, null);
  assert.equal(cover.normal, 40);
});

test('the JLR tab parser keeps outstanding people and drops the totals row', () => {
  const wb = xlsx.utils.book_new();
  const grid = [
    ['Requestor Name', 'Requestor Email', 'Course Name', 'Start date', 'Invoice', 'Invoice ref', 'Due', 'Paid', 'Date', 'Outstanding'],
    ['Andrew Barley', 'secret@example.com', 'Batsford Arboretum Autumn Half-Day Photography Workshop', '2026-10-24', '2026-10-12', '', '2026-12-08', '', '', 99],
    ['', '', '', '', false, '', '', 100, '', 100]
  ];
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(grid), 'JLR Bookings');
  const rows = parseJlrInvoices(wb);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outstanding, 99);
  assert.equal(rows[0].invoice_date, '2026-10-12');
  assert.equal(JSON.stringify(rows).includes('@'), false);
  assert.equal(shortEvent(rows[0].event_name), 'Batsford');
});

test('cash to collect rises by the JLR due-month total, and still to find falls by the same amount', () => {
  const tiles = [{ key: '2026-12', label: 'Dec', still_to_sell: 1000, likely: 0, dated_event_gbp: 0, normal_adjusted: 0, pipeline_weighted: 0, committed_gbp: 0 }];
  const prospects = { cash_to_collect: { by_month: [{ key: '2026-12', gbp: 300 }] } };
  const before = realisticCover(tiles, { today: TODAY, prospects });
  const after = realisticCover(tiles, { today: TODAY, txns: [], jlr: { rows: [batsford('Andrew Barley', 99)] }, prospects });
  assert.equal(before.months[0].cash_to_collect, 300);
  assert.equal(after.months[0].cash_to_collect, 399);
  assert.equal(before.months[0].still_to_find - after.months[0].still_to_find, 99);
});
