// Verify each new product_tier_override row routes to the expected tier
// when classified via the production map.

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local', override: true });
import { createClient } from '@supabase/supabase-js';

import { loadProductTierMap } from '../lib/product-tier-map.js';
import { setProductTierMap, classifyCommercialTier } from '../api/aigeo/commercial-tier.js';

const sb = createClient(
  process.env.SUPABASE_AI_CHAT_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_AI_CHAT_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);
setProductTierMap(await loadProductTierMap(sb));

const CASES = [
  { input: { productName: 'Foundation Plus \u2014 Monthly Support',           productUrl: '', productId: 'ae07ef4e-7407-4959-82c2-ae5fa146553d' }, expect: 'academy' },
  { input: { productName: 'Premium Membership - Exams and 1:1 Coaching',     productUrl: '', productId: '1ca80825-58dc-42dc-bb74-d827b4306f5f' }, expect: 'academy' },
  { input: { productName: 'Photo Edits',                                      productUrl: '', productId: '697ce0ed6f875008931125f8' },           expect: 'services' },
  { input: { productName: '- A square-on full view of each sculpture (x2)...', productUrl: '', productId: '69826ff22b4eb13b643b259d' },           expect: 'hire' },
  { input: { productName: 'Landscape Photography SNOWDONIA - Sat 26 - Sun 27 Sep 2026', productUrl: '', productId: 'snowdonia-fake' },             expect: 'workshops_residential' }
];

let pass = 0, fail = 0;
for (const c of CASES) {
  const got = classifyCommercialTier(c.input);
  const ok = got === c.expect;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  expect=${c.expect.padEnd(22)} got=${got.padEnd(22)} input=${c.input.productName.slice(0, 60)}`);
  if (ok) pass += 1; else fail += 1;
}
console.log(`\n${pass}/${pass + fail} passed.`);
process.exit(fail === 0 ? 0 : 1);
