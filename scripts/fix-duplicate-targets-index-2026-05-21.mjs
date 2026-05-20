// One-shot remediation script (2026-05-21)
// -----------------------------------------------------------------------
// The v5.0 migration created a unique index named
//   revenue_funnel_targets_property_tier_uidx
//   ON public.revenue_funnel_targets (property_url, COALESCE(tier_id, ''))
//
// My v5.3 Phase A.1 migration (2026-05-21-scenario-planning-tables.sql)
// added a scenario-scoped equivalent (scenario_id, COALESCE(tier_id, ''))
// but FORGOT to drop the old one. That breaks the Duplicate scenario flow:
// when we try to insert the duplicate's targets rows (same property_url +
// same tier_id, different scenario_id) the old index sees the property+
// tier collision and rejects.
//
// This script:
//   1. Drops the legacy revenue_funnel_targets_property_tier_uidx index.
//   2. Cleans up the orphan "SmokeDup-2026-05-21" scenario that got left
//      behind during the failed smoke test (parent row was inserted but
//      child copy failed).
//
// Run from the repo root with:
//   node scripts/fix-duplicate-targets-index-2026-05-21.mjs
//
// After this runs you should also append the DROP INDEX line to the v5.3
// migration file so a future fresh-DB replay matches the live state.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(here, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env / .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

async function runSql(label, sql) {
  // The Supabase JS client doesn't expose raw SQL by default; use the
  // PostgREST RPC pattern via an inline RPC. If we don't have a helper
  // RPC, fall back to the REST endpoint by calling the SQL editor's
  // /pg/query (only available via management API which we don't have
  // here). Easiest path: use the rpc('exec_sql', ...) helper if it
  // exists, otherwise tell the operator to run the DROP INDEX in the
  // Supabase SQL editor manually.
  const { data, error } = await supabase.rpc('exec_sql', { sql });
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function dropLegacyIndex() {
  console.log('1) Dropping legacy revenue_funnel_targets_property_tier_uidx...');
  try {
    await runSql('drop index', 'DROP INDEX IF EXISTS public.revenue_funnel_targets_property_tier_uidx;');
    console.log('   OK');
  } catch (err) {
    console.warn('   FAILED via rpc(exec_sql):', err.message);
    console.warn('   --> Run this in the Supabase SQL editor manually:');
    console.warn('       DROP INDEX IF EXISTS public.revenue_funnel_targets_property_tier_uidx;');
  }
}

async function cleanupOrphanScenarios() {
  console.log('2) Cleaning up orphan smoke-test scenarios...');
  const { data: rows, error } = await supabase
    .from('revenue_funnel_scenarios')
    .select('id, name')
    .eq('property_url', 'https://www.alanranger.com')
    .or('name.like.SmokeDup%,name.like.SmokeTest%,name.like.SmokeTest-%');
  if (error) { console.error('   list failed:', error.message); return; }
  if (!rows || !rows.length) { console.log('   no orphans found.'); return; }
  for (const r of rows) {
    console.log(`   deleting "${r.name}" (${r.id})`);
    const { error: delErr } = await supabase
      .from('revenue_funnel_scenarios').delete().eq('id', r.id);
    if (delErr) console.warn(`     failed: ${delErr.message}`);
    else        console.log('     OK');
  }
}

(async () => {
  try {
    await dropLegacyIndex();
    await cleanupOrphanScenarios();
    console.log('\nDone.');
  } catch (err) {
    console.error('Fatal:', err.message);
    process.exit(1);
  }
})();
