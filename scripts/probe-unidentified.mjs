// List every row in the Unidentified bucket for 2026 YTD so we can see
// what still needs a classifier rule.

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
    headers: { Authorization: `Bearer ${process.env.SQUARESPACE_API_KEY}`, 'User-Agent': 'AlanRanger-AIGEOAudit/1.0', Accept: 'application/json' }
  });
  if (!r.ok) throw new Error(`sqs_http_${r.status}`);
  return r.json();
}

async function fetchSQ(startDate, endDate) {
  const out = []; let qs = `?modifiedAfter=${encodeURIComponent(startDate + 'T00:00:00.000Z')}&modifiedBefore=${encodeURIComponent(endDate + 'T23:59:59.999Z')}`;
  for (let i = 0; i < 100; i += 1) {
    const page = await sqPage(qs);
    for (const o of page.result || []) out.push(o);
    if (!page.pagination?.hasNextPage || !page.pagination?.nextPageCursor) break;
    qs = `?cursor=${encodeURIComponent(page.pagination.nextPageCursor)}`;
  }
  return out;
}

const orders = await fetchSQ('2026-01-01', '2026-05-31');

console.log('=== Squarespace orders landing in UNIDENTIFIED ===\n');
let total = 0;
let count = 0;
for (const o of orders) {
  const created = String(o.createdOn || '').slice(0, 10);
  if (created < '2026-01-01' || created > '2026-05-31') continue;
  if (o.testmode || String(o.fulfillmentStatus || '').toUpperCase() === 'CANCELED') continue;
  const billing = o.billingAddress || {};
  const cust = `${billing.firstName || ''} ${billing.lastName || ''}`.trim() || '(anonymous)';
  const gross = Number(o?.grandTotal?.value) || 0;
  const refunded = Number(o?.refundedTotal?.value) || 0;
  const net = Math.max(0, gross - refunded);
  for (const li of (o.lineItems || [])) {
    const t = classifyCommercialTier({ productName: li.productName, productUrl: li.productUrl });
    if (t !== 'unidentified') continue;
    const unit = Number(li.unitPricePaid?.value || li.unitPrice?.value) || 0;
    const qty = Number(li.quantity) || 1;
    const amt = unit * qty;
    console.log(`  ${created}  GBP ${amt.toFixed(2).padStart(7)}  ${cust.slice(0,28).padEnd(28)}  type=${(li.lineItemType||'').padEnd(8)}  "${li.productName}"  url="${li.productUrl||''}"`);
    total += amt;
    count += 1;
  }
}
console.log(`\n  ${count} unidentified line items, total GBP ${total.toFixed(2)}`);
