// Inspect SQ orders for Foundation Plus + Premium Membership to understand
// (a) whether SQ Commerce records each renewal as a separate order, and
// (b) whether the order's grandTotal matches the spreadsheet's view of
// what the customer actually paid (Premium Membership renewals were
// 100% discounted per Alan, so should be £0).

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local', override: true });

const KEY = process.env.SQUARESPACE_API_KEY;
const BASE = 'https://api.squarespace.com/1.0/commerce/orders';
const RANGE = { start: '2025-12-01T00:00:00.000Z', end: '2026-05-31T23:59:59.999Z' };

async function fetchPage(qs) {
  const r = await fetch(`${BASE}${qs}`, {
    headers: { Authorization: `Bearer ${KEY}`, 'User-Agent': 'AlanRanger-AIGEOAudit/1.0', Accept: 'application/json' }
  });
  if (!r.ok) throw new Error(`http_${r.status}`);
  return r.json();
}

const all = [];
let qs = `?modifiedAfter=${encodeURIComponent(RANGE.start)}&modifiedBefore=${encodeURIComponent(RANGE.end)}`;
for (let i = 0; i < 100; i += 1) {
  const page = await fetchPage(qs);
  for (const o of page.result || []) all.push(o);
  if (!page.pagination?.hasNextPage || !page.pagination?.nextPageCursor) break;
  qs = `?cursor=${encodeURIComponent(page.pagination.nextPageCursor)}`;
}
console.log(`Fetched ${all.length} orders.`);

const WANTED_TITLES = ['foundation plus', 'premium membership'];

const matches = [];
for (const o of all) {
  if (o.testmode) continue;
  const created = (o.createdOn || '').slice(0, 10);
  if (created < '2026-01-01' || created > '2026-05-31') continue;
  for (const li of (o.lineItems || [])) {
    const n = String(li.productName || '').toLowerCase();
    if (WANTED_TITLES.some(t => n.includes(t))) {
      matches.push({ order: o, line: li });
    }
  }
}

console.log(`\n${matches.length} matching line items in 2026 YTD:`);
for (const m of matches) {
  const o = m.order, li = m.line;
  const lineGross = Number(li.unitPricePaid?.value || 0) * Number(li.quantity || 1);
  console.log(`  #${o.orderNumber}  created=${o.createdOn?.slice(0,10)}  status=${o.fulfillmentStatus}  grandTotal=\u00a3${o.grandTotal?.value}  subtotal=\u00a3${o.subtotal?.value}  discountTotal=\u00a3${o.discountTotal?.value}  refundedTotal=\u00a3${o.refundedTotal?.value || 0}  line='${li.productName}' qty=${li.quantity} unitPaid=\u00a3${li.unitPricePaid?.value} unitOrig=\u00a3${li.unitPrice?.value} lineGross=\u00a3${lineGross.toFixed(2)}`);
}

const sums = {};
for (const m of matches) {
  const t = m.line.productName.toLowerCase().includes('foundation') ? 'foundation' : 'premium';
  sums[t] = sums[t] || { count: 0, lineGross: 0, grandTotal: 0 };
  sums[t].count += 1;
  sums[t].lineGross += Number(m.line.unitPricePaid?.value || 0) * Number(m.line.quantity || 1);
  sums[t].grandTotal += Number(m.order.grandTotal?.value || 0);
}
console.log('\nTotals:');
for (const [k, v] of Object.entries(sums)) {
  console.log(`  ${k}: ${v.count} line items  lineGrossSum=\u00a3${v.lineGross.toFixed(2)}  grandTotalSum=\u00a3${v.grandTotal.toFixed(2)}`);
}
