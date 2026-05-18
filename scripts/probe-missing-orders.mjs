// Investigation: find specific SQ orders that should exist but probe missed.
//   - Dale Creaser (#03243, Apr 4, residential Snowdonia, £595)
//   - 8 Hire customers (Grace Brown, Heidi Gibbs, Ben Lucy, etc.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { classifyCommercialTier } from '../api/aigeo/commercial-tier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
function loadEnv(p) { const t = readFileSync(p,'utf8'); for (const l of t.split(/\r?\n/)) { if(!l||l.startsWith('#')||!l.includes('='))continue; const i=l.indexOf('='); const k=l.slice(0,i).trim(); const v=l.slice(i+1).trim(); if(!process.env[k]) process.env[k]=v; } }
loadEnv(resolve(__dirname, '..', '.env.local'));

async function sqPage(qs) {
  const r = await fetch(`https://api.squarespace.com/1.0/commerce/orders${qs}`, {
    headers: {
      Authorization: `Bearer ${process.env.SQUARESPACE_API_KEY}`,
      'User-Agent': 'AlanRanger-AIGEOAudit/1.0 (probe-missing-orders)',
      Accept: 'application/json'
    }
  });
  if (!r.ok) throw new Error(`sqs_http_${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function fetchAllBetween(startDate, endDate) {
  const out = [];
  let qs = `?modifiedAfter=${encodeURIComponent(startDate + 'T00:00:00.000Z')}&modifiedBefore=${encodeURIComponent(endDate + 'T23:59:59.999Z')}`;
  for (let i = 0; i < 100; i += 1) {
    const page = await sqPage(qs);
    for (const o of page.result || []) out.push(o);
    if (!page.pagination?.hasNextPage || !page.pagination?.nextPageCursor) break;
    qs = `?cursor=${encodeURIComponent(page.pagination.nextPageCursor)}`;
  }
  return out;
}

function fmtOrder(o) {
  const billing = o.billingAddress || {};
  const lines = (o.lineItems || []).map(li => ({
    name: li.productName || li.lineItemType || '',
    url: li.productUrl || '',
    sku: li.sku || '',
    type: li.lineItemType || '',
    qty: li.quantity,
    unit: li.unitPricePaid?.value || li.unitPrice?.value
  }));
  return {
    orderNumber: o.orderNumber,
    id: o.id,
    createdOn: o.createdOn,
    modifiedOn: o.modifiedOn,
    fulfillmentStatus: o.fulfillmentStatus,
    customer: `${billing.firstName || ''} ${billing.lastName || ''}`.trim(),
    email: o.customerEmail,
    grandTotal: o.grandTotal?.value,
    refundedTotal: o.refundedTotal?.value,
    discountTotal: o.discountTotal?.value,
    lines
  };
}

const NEEDLES = [
  'Dale Creaser', 'Grace Brown', 'Heidi Gibbs', 'Ben Lucy',
  'Francisca Solis', 'James Rosnack', 'Brooklyn Brow',
  'Penelope Ulander', 'Mike Elliott', 'Peter Orton',
  'Mark Reynolds' // services check
];

// Pull orders with modifiedAfter=2025-10-01 -> 2026-06-30 (wide window)
console.log('Fetching SQ orders 2025-10-01 -> 2026-06-30 ...');
const orders = await fetchAllBetween('2025-10-01', '2026-06-30');
console.log(`Got ${orders.length} orders.\n`);

for (const needle of NEEDLES) {
  const hits = orders.filter(o => {
    const c = `${o.billingAddress?.firstName || ''} ${o.billingAddress?.lastName || ''}`.toLowerCase();
    const e = String(o.customerEmail || '').toLowerCase();
    return c.includes(needle.toLowerCase()) || e.includes(needle.toLowerCase().replace(/\s+/g, ''));
  });
  console.log(`--- "${needle}" : ${hits.length} matching SQ orders ---`);
  for (const h of hits) {
    const f = fmtOrder(h);
    console.log(`  #${f.orderNumber}  ${f.createdOn?.slice(0,10)}  £${f.grandTotal}  ${f.customer}  fulfillment=${f.fulfillmentStatus}`);
    for (const l of f.lines) {
      const tier = classifyCommercialTier({ productName: l.name, productUrl: l.url });
      console.log(`     line: "${l.name}"  url="${l.url}"  type=${l.type}  £${l.unit}x${l.qty}  -> tier=${tier}`);
    }
  }
}
