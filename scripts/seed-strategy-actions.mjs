/**
 * Seed strategy_quarter_actions (idempotent).
 * node scripts/seed-strategy-actions.mjs
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { ensureStrategyActions } from '../lib/strategy-action-seed.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Prefer Vercel prod secrets (sb_secret_*) over legacy JWT in .env.local
for (const name of ['.env.vercel.prod', '.env.local', '.env']) {
  try {
    for (const line of readFileSync(resolve(root, name), 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      const val = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '');
      if (!process.env[m[1]] || (name === '.env.vercel.prod' && val.startsWith('sb_'))) {
        process.env[m[1]] = val;
      }
    }
  } catch { /* optional */ }
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SERVICE_ROLE');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });
const prop = 'https://www.alanranger.com';
const r = await ensureStrategyActions(sb, prop);
const { count } = await sb
  .from('strategy_quarter_actions')
  .select('*', { count: 'exact', head: true })
  .eq('property_url', prop);
console.log(JSON.stringify({ inserted: r.inserted, total: count }, null, 2));
