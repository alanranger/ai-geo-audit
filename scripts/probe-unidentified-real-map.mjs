// Same as probe-unidentified-sq.mjs but loads the REAL product-tier map
// from Supabase (csv_metadata + product_tier_override) so the
// unidentified list matches exactly what production sees.

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local', override: true });
import { createClient } from '@supabase/supabase-js';

import { loadProductTierMap } from '../lib/product-tier-map.js';
import { setProductTierMap, classifyCommercialTier } from '../api/aigeo/commercial-tier.js';

const sbUrl = process.env.SUPABASE_AI_CHAT_URL || process.env.SUPABASE_URL;
const sbKey = process.env.SUPABASE_AI_CHAT_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!sbUrl || !sbKey) { console.error('Missing AI-chat Supabase creds'); process.exit(1); }
const supabase = createClient(sbUrl, sbKey);
setProductTierMap(await loadProductTierMap(supabase));

const KEY = process.env.SQUARESPACE_API_KEY;
if (!KEY) { console.error('No SQUARESPACE_API_KEY'); process.exit(1); }

const BASE = 'https://api.squarespace.com/1.0/commerce/orders';
const RANGE = { start: '2025-12-01T00:00:00.000Z', end: '2026-05-31T23:59:59.999Z' };

async function fetchPage(qs) {
  const r = await fetch(`${BASE}${qs}`, {
    headers: { Authorization: `Bearer ${KEY}`, 'User-Agent': 'AlanRanger-AIGEOAudit/1.0', Accept: 'application/json' }
  });
  if (!r.ok) throw new Error(`http_${r.status}: ${(await r.text()).slice(0, 200)}`);
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

const unident = new Map();
let scanned = 0;
for (const o of all) {
  if (o.testmode) continue;
  const created = (o.createdOn || '').slice(0, 10);
  if (created < '2026-01-01' || created > '2026-05-31') continue;
  if (String(o.fulfillmentStatus || '').toUpperCase() === 'CANCELED') continue;
  for (const li of (o.lineItems || [])) {
    scanned += 1;
    const tier = classifyCommercialTier({
      productName: li.productName,
      productUrl: li.productUrl || '',
      productId: li.productId || ''
    });
    if (tier !== 'unidentified') continue;
    const key = (li.productName || '(no name)').slice(0, 80);
    const e = unident.get(key) || { count: 0, gross: 0, sampleOrder: o.orderNumber, productId: li.productId, sku: li.sku };
    e.count += 1;
    e.gross += Number(li.unitPricePaid?.value || 0) * Number(li.quantity || 1);
    unident.set(key, e);
  }
}
console.log(`Scanned ${scanned} line items, ${unident.size} unidentified products:`);
let total = 0;
for (const [name, e] of [...unident.entries()].sort((a, b) => b[1].gross - a[1].gross)) {
  total += e.gross;
  console.log(`  \u00a3${e.gross.toFixed(2).padStart(8)} x${e.count}  order#${e.sampleOrder}  productId=${e.productId || ''}  sku=${e.sku || ''}  "${name}"`);
}
console.log(`  Total: \u00a3${total.toFixed(2)}`);
