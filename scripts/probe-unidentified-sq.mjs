// List every 2026 SQ order line item whose dashboard classification
// is 'unidentified'. We re-run the same classifier the production sync
// uses, against the live SQ Commerce API, so the output exactly matches
// what's in revenue_snapshots.

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local', override: true });

import { setProductTierMap, classifyCommercialTier } from '../api/aigeo/commercial-tier.js';

// Re-use the same hand-built title-prefix map we used in the offline
// regression test. Anything that doesn't match here drops to legacy
// rules; anything that doesn't match THERE is 'unidentified'.
setProductTierMap({
  slugToTier: new Map(),
  titleToTier: new Map([
    ['landscape photography devon workshops',          'workshops_residential'],
    ['landscape yorkshire dales photography workshop', 'workshops_residential'],
    ['wales photography workshop',                     'workshops_residential'],
    ['anglesey landscape photography workshop',        'workshops_residential'],
    ['landscape photography snowdonia',                'workshops_nonres'], // promoted by safety net
    ['bluebell woodlands photography',                 'workshops_nonres'],
    ['lavender field photography workshop',            'workshops_nonres'],
    ['burnham on sea long exposure photography workshop 1 aug', 'workshops_nonres'],
    ['photography workshops chesterton windmill',      'workshops_nonres']
  ])
});

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
console.log(`Fetched ${all.length} orders in window.`);

const unident = new Map();
let scanned = 0;
for (const o of all) {
  if (o.testmode) continue;
  const created = (o.createdOn || '').slice(0, 10);
  if (created < '2026-01-01' || created > '2026-05-31') continue;
  if (String(o.fulfillmentStatus || '').toUpperCase() === 'CANCELED') continue;
  const lines = o.lineItems || [];
  for (const li of lines) {
    scanned += 1;
    const tier = classifyCommercialTier({ productName: li.productName, productUrl: li.productUrl || '' });
    if (tier !== 'unidentified') continue;
    const key = li.productName || '(no name)';
    const e = unident.get(key) || { count: 0, gross: 0, sampleOrder: o.orderNumber };
    e.count += 1;
    e.gross += Number(li.unitPricePaid?.value || 0) * Number(li.quantity || 1);
    unident.set(key, e);
  }
}
console.log(`Scanned ${scanned} line items.`);
console.log(`Unidentified product names (${unident.size}):`);
const sorted = [...unident.entries()].sort((a, b) => b[1].gross - a[1].gross);
let total = 0;
for (const [name, e] of sorted) {
  total += e.gross;
  console.log(`  \u00a3${e.gross.toFixed(2).padStart(8)} x${e.count}  #${e.sampleOrder}  "${name}"`);
}
console.log(`  ---`);
console.log(`  Total unidentified gross: \u00a3${total.toFixed(2)}`);
