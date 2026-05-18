// Fetch specific Squarespace orders by orderNumber and dump every line
// item's product url + name + price. We use this to see exactly which
// SQ product slug each residential booking was placed on, so we know
// whether to add a product_tier_override row or fix the SQ category.
//
// Usage: node scripts/probe-sq-orders-by-ref.mjs

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

const KEY = process.env.SQUARESPACE_API_KEY;
if (!KEY) { console.error('No SQUARESPACE_API_KEY'); process.exit(1); }

const WANTED = new Set([
  '#03189', // Penelope Ulander - Hartland Quay
  '#03203', // Chris Stamp - Yorkshire Dales
  '#03207', // Jo Galloway - originally Lake Vyrnwy, swapped to Anglesey
  '#03217', // Sofia Garza - Yorkshire Dales
  '#03243', // Dale Creaser - Snowdonia
  '#03251', // Peter Orton - Hartland Quay devon
  '#03261', // Mahesh Patel - Lake Vyrnwy
  '#03291', // Michael White - Anglesey 3-day residential
]);

const BASE = 'https://api.squarespace.com/1.0/commerce/orders';
// Widen the modification window backwards to make sure orders #03189-#03291
// (placed Jan-Apr 2026, never re-edited) are returned. SQ filters on
// modifiedAfter/Before; if an order has never been modified, modifiedOn ==
// createdOn, but pagination can still hide older items.
const RANGE = { start: '2025-12-01T00:00:00.000Z', end: '2026-05-31T23:59:59.999Z' };

async function fetchPage(qs) {
  const r = await fetch(`${BASE}${qs}`, {
    headers: { Authorization: `Bearer ${KEY}`, 'User-Agent': 'AlanRanger-AIGEOAudit/1.0', Accept: 'application/json' }
  });
  if (!r.ok) throw new Error(`http_${r.status}: ${await r.text()}`);
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
console.log(`Fetched ${all.length} orders in window.`);
const nums = all.map(o => Number(o.orderNumber || 0)).filter(Boolean).sort((a, b) => a - b);
console.log('OrderNumber range:', nums[0], '..', nums[nums.length - 1]);
const want3189 = nums.find(n => n === 3189);
console.log('Includes 3189?', !!want3189);

const REFS_DIGITS = new Set([...WANTED].map(r => String(parseInt(r.replace(/[^0-9]/g, ''), 10))));
const matched = all.filter(o => REFS_DIGITS.has(String(parseInt(o.orderNumber || 0, 10))));
console.log(`Matched ${matched.length} of ${WANTED.size} wanted refs.\n`);

for (const o of matched) {
  console.log(`====== ${o.orderNumber}  customer=${o.customerEmail}  net=\u00a3${Number(o.grandTotal?.value||0)} (refunded=\u00a3${Number(o.refundedTotal?.value||0)}) ======`);
  console.log(`  createdOn=${o.createdOn}  fulfillmentStatus=${o.fulfillmentStatus}`);
  for (const li of (o.lineItems || [])) {
    const url = li.productUrl || '';
    const name = li.productName || li.lineItemType || '';
    const unit = Number(li.unitPricePaid?.value || li.unitPrice?.value || 0);
    const qty = Number(li.quantity || 1);
    console.log(`    - \u00a3${(unit*qty).toFixed(2)}  ${name}`);
    console.log(`        url: ${url}`);
  }
  // Show any discount/voucher lines
  if (o.discountLines?.length) {
    for (const d of o.discountLines) {
      console.log(`    [discount] -\u00a3${Number(d.amount?.value||0)}  name=${d.name}  promo=${d.promoCode || '(voucher?)'} `);
    }
  }
  console.log('');
}

// Find any 2026 order containing 'anglesey' (Michael White) or with a
// gift-voucher discount (Mike Elliott).
console.log('\n--- 2026 orders containing "Anglesey" ---');
for (const o of all) {
  const li = o.lineItems || [];
  if (!li.some(x => /anglesey/i.test(x.productName || ''))) continue;
  const total = Number(o.grandTotal?.value || 0);
  console.log(`  #${o.orderNumber}  ${o.customerEmail}  net=\u00a3${total}  created=${o.createdOn?.slice(0,10)}`);
  for (const x of li) console.log(`     - \u00a3${Number(x.unitPricePaid?.value || 0)} ${x.productName}`);
}

console.log('\n--- 2026 orders containing "Hartland" ---');
for (const o of all) {
  const li = o.lineItems || [];
  if (!li.some(x => /hartland/i.test(x.productName || ''))) continue;
  const total = Number(o.grandTotal?.value || 0);
  const ref = Number(o.refundedTotal?.value || 0);
  console.log(`  #${o.orderNumber}  ${o.customerEmail}  net=\u00a3${total}  refunded=\u00a3${ref}  created=${o.createdOn?.slice(0,10)}`);
  for (const x of li) console.log(`     - \u00a3${Number(x.unitPricePaid?.value || 0)} ${x.productName}`);
  if (o.discountLines?.length) console.log(`     [discounts]`, JSON.stringify(o.discountLines));
}

console.log('\n--- 2026 orders for elliott/elliot ---');
for (const o of all) {
  const email = String(o.customerEmail || '').toLowerCase();
  const name = `${o.billingAddress?.firstName || ''} ${o.billingAddress?.lastName || ''}`.toLowerCase();
  if (!email.includes('elliott') && !email.includes('elliot') && !name.includes('elliott') && !name.includes('elliot')) continue;
  console.log(`  #${o.orderNumber}  ${o.customerEmail}  name=${name}  net=\u00a3${Number(o.grandTotal?.value||0)}  created=${o.createdOn?.slice(0,10)}`);
  for (const x of o.lineItems || []) console.log(`     - \u00a3${Number(x.unitPricePaid?.value || 0)} ${x.productName}`);
}

console.log('\n--- 2026 orders with discountLines (possible gift-voucher use) ---');
for (const o of all) {
  if (!o.discountLines?.length) continue;
  const ts = Number(o.discountTotal?.value || 0);
  if (ts <= 0) continue;
  console.log(`  #${o.orderNumber}  ${o.customerEmail}  net=\u00a3${Number(o.grandTotal?.value||0)}  discount=\u00a3${ts}  promos=${o.discountLines.map(d => d.promoCode || d.name).join(',')}`);
}
