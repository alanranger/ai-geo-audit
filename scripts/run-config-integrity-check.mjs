/**
 * CLI: run config integrity check + optional seeded failure proof.
 *
 * Usage:
 *   node scripts/run-config-integrity-check.mjs
 *   node scripts/run-config-integrity-check.mjs --seed-proof
 *   node scripts/run-config-integrity-check.mjs --apply-migration
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';
import { runIntegrityCheck } from '../lib/configIntegrity/runIntegrityCheck.mjs';
import { logMasterMutation } from '../lib/masterTableMutations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

const args = new Set(process.argv.slice(2));
const PROPERTY = 'https://www.alanranger.com';

async function applyMigration() {
  const sqlPath = path.join(root, 'migrations/20260719_config_integrity_runs.sql');
  const conn = process.env.SUPABASE_PG_RW_URL
    || process.env.DATABASE_URL
    || process.env.SUPABASE_DB_URL;
  if (!conn) {
    console.error('Set DATABASE_URL or SUPABASE_DB_URL to apply migration');
    process.exit(1);
  }
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(sql);
  await client.end();
  console.log('Applied', sqlPath);
}

async function seedProof() {
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const fakePath = '/__integrity-test-tier-f';
  const fakeUrl = `https://www.alanranger.com${fakePath}`;

  console.log('--- BEFORE (seed broken row) ---');
  await sb.from('pages_master').upsert({
    property_url: PROPERTY,
    url: fakeUrl,
    path: fakePath,
    tier: 'F_unmapped',
    money_role: null,
    target_keyword: 'integrity test keyword',
    target_class: 'tracked',
    notes: 'TEMP integrity checker seed — delete after proof',
    source: 'integrity_seed',
    flagged: true,
    flag_reason: 'seeded_for_phase3_proof',
    updated_at: new Date().toISOString()
  }, { onConflict: 'property_url,path' });
  await logMasterMutation(sb, {
    tableName: 'pages_master',
    scriptName: 'run-config-integrity-check.mjs',
    args: '--seed-proof upsert',
    rowCount: 1,
    notes: 'Temporary integrity seed row'
  });
  const before = await runIntegrityCheck({ runSource: 'seed_proof_before', persist: true });
  console.log(JSON.stringify({ chipRag: before.chipRag, count: before.findings.length, sample: before.findings.slice(0, 5) }, null, 2));

  console.log('--- AFTER (remove seed) ---');
  await sb.from('pages_master').delete().eq('property_url', PROPERTY).eq('path', fakePath);
  await logMasterMutation(sb, {
    tableName: 'pages_master',
    scriptName: 'run-config-integrity-check.mjs',
    args: '--seed-proof delete',
    rowCount: 1,
    notes: 'Removed temporary integrity seed row'
  });
  const after = await runIntegrityCheck({ runSource: 'seed_proof_after', persist: true });
  console.log(JSON.stringify({ chipRag: after.chipRag, count: after.findings.length }, null, 2));
}

async function main() {
  if (args.has('--apply-migration')) {
    await applyMigration();
    return;
  }
  if (args.has('--seed-proof')) {
    await seedProof();
    return;
  }
  const result = await runIntegrityCheck({ runSource: 'cli', persist: true });
  console.log(JSON.stringify({
    chipRag: result.chipRag,
    stats: result.stats,
    findings: result.findings
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
