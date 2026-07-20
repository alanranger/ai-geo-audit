/**
 * Reclassify known platform/aggregator domains in domain_strength_domains (noise fix).
 * Usage: node scripts/reclassify-platform-domains.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { ensureDomainTypeMapping } from '../lib/domainTypeClassifier.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const TARGETS = [
  'skillshare.com', 'lightroom.adobe.com', 'visualeducation.com', 'eventbrite.co.uk',
  'udemy.com', 'alison.com', 'groupon.co.uk', 'instagram.com', 'facebook.com',
];

for (const envFile of ['.env.local', '.env']) {
  const p = join(ROOT, envFile);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env');
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const results = [];
  for (const domain of TARGETS) {
    const r = await ensureDomainTypeMapping(sb, domain, 'ca-v2-noise-fix');
    results.push({ domain, ...r });
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
