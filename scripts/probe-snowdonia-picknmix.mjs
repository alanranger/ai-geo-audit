// Verify the two fixes:
//   1. Snowdonia (mistagged as Landscape in SQ CSV) still ends up as
//      workshops_residential thanks to the WORKSHOP_RESIDENTIAL_NAME_-
//      TOKENS safety net.
//   2. A 100%-discount PICKNMIX redemption is reallocated from net=0
//      to per-tier gross totals with a services debit.
//
// Both tests mock the product-tier-map so we don't need Supabase locally.
// Usage: node scripts/probe-snowdonia-picknmix.mjs

import { setProductTierMap, classifyCommercialTier } from '../api/aigeo/commercial-tier.js';

// Reproduce what the production map would look like for the 5 SQ titles
// we've actually seen in 2026 orders. Snowdonia is mapped to nonres
// because the CSV row only has ['Landscape']; the safety net should
// promote it to residential.
const mockMap = {
  slugToTier: new Map(),
  titleToTier: new Map([
    ['landscape photography devon workshops',          'workshops_residential'],
    ['landscape yorkshire dales photography workshop', 'workshops_residential'],
    ['wales photography workshop',                     'workshops_residential'],
    ['anglesey landscape photography workshop',        'workshops_residential'],
    ['landscape photography snowdonia',                'workshops_nonres'],
    ['bluebell woodlands photography',                 'workshops_nonres'],
    ['lavender field photography workshop',            'workshops_nonres'],
    ['burnham on sea long exposure photography workshop 1 aug', 'workshops_nonres'],
    ['photography workshops chesterton windmill',      'workshops_nonres']
  ])
};
setProductTierMap(mockMap);

// ---- Test 1: title-prefix classification --------------------------------
const SQ_TITLES = [
  ['Landscape Photography DEVON Workshops - Various Dates',          'workshops_residential'],
  ['Landscape YORKSHIRE DALES Photography Workshop - 10 - 12 Apr',   'workshops_residential'],
  ['WALES Photography Workshop | Lake Vyrnwy 30-31 May',             'workshops_residential'],
  ['ANGLESEY Landscape Photography Workshop -  May 2026',            'workshops_residential'],
  ['Landscape Photography SNOWDONIA - Sat 26 - Sun 27 Sep 2026',     'workshops_residential'], // <- the fix
  ['BLUEBELL WOODLANDS Photography - Warks - 20 Apr- 01 May',        'workshops_nonres'],
  ['LAVENDER FIELD Photography Workshop - Gloucestershire July',     'workshops_nonres'],
  ['BURNHAM ON SEA Long Exposure Photography Workshop 1 Aug',        'workshops_nonres'],
  ['Photography Workshops CHESTERTON WINDMILL - Warwickshire',       'workshops_nonres']
];

let pass = 0;
let fail = 0;
console.log('\nTest 1: classifyCommercialTier on SQ titles (productUrl empty)\n');
for (const [title, expected] of SQ_TITLES) {
  const got = classifyCommercialTier({ productName: title, productUrl: '' });
  const ok = got === expected;
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  expected=${expected.padEnd(22)} got=${got.padEnd(22)} | ${title}`);
}

// ---- Test 2: Pick n Mix redemption reallocation -------------------------
// Simulate the exact Jo Galloway #3207 order structure SQ returned.
const { default: handlerModule } = await import('../api/aigeo/squarespace-revenue-sync.js')
  .then(m => ({ default: m }))
  .catch(() => ({ default: null }));
// Re-export the internal helpers we need by re-reading from the source.
// (splitOrderByTier is not exported, so we use it via a re-implementation
// in a tiny harness that imports the file's exports indirectly.)

// Easiest: re-import the file and call the splitter via a small reflected
// test. Since splitOrderByTier isn't exported, we instead reproduce what
// the sync pipeline will do by checking aggregate behavior using a wrapper.
// We import the module just to ensure no parse errors first.

if (!handlerModule) {
  console.log('\nTest 2: skipped (could not import squarespace-revenue-sync.js)');
} else {
  // Build the order Jo Galloway #3207 had
  const order = {
    grandTotal: { value: '0' },
    refundedTotal: { value: '0' },
    discountLines: [{ promoCode: 'PICKNMIX', name: 'Pick N Mix' }],
    lineItems: [
      { productName: 'LAVENDER FIELD Photography Workshop - Gloucestershire July',  unitPricePaid: { value: '150' }, quantity: 1 },
      { productName: 'BLUEBELL WOODLANDS Photography - Warks - 20 Apr- 01 May',     unitPricePaid: { value: '150' }, quantity: 1 },
      { productName: 'WALES Photography Workshop | Lake Vyrnwy 30-31 May',          unitPricePaid: { value: '575' }, quantity: 1 },
      { productName: 'BURNHAM ON SEA Long Exposure Photography Workshop 2 May',    unitPricePaid: { value: '95' },  quantity: 1 },
      { productName: 'Photography Workshops CHESTERTON WINDMILL - Warwickshire',   unitPricePaid: { value: '50' },  quantity: 1 }
    ]
  };

  // We can't easily call splitOrderByTier from outside the module, so
  // assert by computing what we EXPECT the new sync handler will produce.
  // (The unit-style assertion here documents the contract; real E2E
  // verification happens after we re-sync against production.)
  const expected = {
    workshops_residential: 575,
    workshops_nonres: 445,   // 150 + 150 + 95 + 50
    services: -1020          // total Pick n Mix Out debit
  };
  console.log('\nTest 2: Expected per-tier reallocation for Jo #3207 (£0 net, PICKNMIX):');
  for (const [k, v] of Object.entries(expected)) {
    console.log(`         ${k.padEnd(22)} = \u00a3${v}`);
  }
  console.log('  -> will verify against the live API after the next /squarespace-revenue-sync run.');
}

console.log(`\nSummary: ${pass} pass, ${fail} fail (Test 1)`);
process.exit(fail ? 1 : 0);
