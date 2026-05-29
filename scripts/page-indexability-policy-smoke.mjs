/**
 * Live smoke test: page_indexability_policy + policy_for_url() on prod Supabase.
 *
 * Requires .env.local: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 *   node scripts/page-indexability-policy-smoke.mjs
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { resolvePolicy, isPolicyActive } from '../lib/page-indexability-policy.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const CASES = [
  {
    id: 1,
    url: 'https://www.alanranger.com/photographic-workshops-near-me/some-event-2025-09',
    expectPolicy: 'intentional_noindex',
    expectTarget: null
  },
  {
    id: 2,
    url: 'https://www.alanranger.com/one-day-landscape-photography-workshops',
    expectPolicy: 'retired_redirect',
    expectTarget: '/landscape-photography-workshops'
  },
  {
    id: 3,
    url: 'https://www.alanranger.com/landscape-photography-workshops',
    expectPolicy: null,
    expectTarget: null
  },
  {
    id: 4,
    url: 'https://www.alanranger.com/one-day-landscape-photography-workshops/?query=1',
    expectPolicy: 'retired_redirect',
    expectTarget: '/landscape-photography-workshops'
  },
  {
    id: 5,
    url: 'https://www.alanranger.com/PHOTOGRAPHIC-WORKSHOPS-NEAR-ME/some-event',
    expectPolicy: 'intentional_noindex',
    expectTarget: null
  }
];

function fmtRow(row) {
  if (!row) return 'null';
  return `{ policy: ${row.policy}, redirect_target: ${row.redirect_target ?? 'null'}, effective_date: ${row.effective_date ?? 'null'} }`;
}

function check(label, got, expectPolicy, expectTarget) {
  const policy = got?.policy ?? null;
  const target = got?.redirect_target ?? null;
  const ok = policy === expectPolicy && target === expectTarget;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  console.log(`       url: ${got?.url ?? '(n/a)'}`);
  console.log(`       got: ${fmtRow(got)}`);
  console.log(`       exp: policy=${expectPolicy}, redirect_target=${expectTarget ?? 'null'}`);
  return ok;
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data: policies, error: polErr } = await supabase
  .from('page_indexability_policy')
  .select('url_or_prefix, match_type, policy, redirect_target, effective_date, note')
  .order('id');

if (polErr) {
  console.error('Failed to load policies:', polErr.message);
  process.exit(1);
}

console.log('=== Seed rows (live) ===');
console.table(policies);

let passed = 0;
let total = 0;

console.log('\n=== JS resolver ===');
for (const c of CASES) {
  total += 1;
  const got = resolvePolicy(c.url, policies);
  if (check(`JS case ${c.id}`, { ...got, url: c.url }, c.expectPolicy, c.expectTarget)) passed += 1;
}

console.log('\n=== SQL policy_for_url() ===');
for (const c of CASES) {
  total += 1;
  const { data, error } = await supabase.rpc('policy_for_url', { p_url: c.url });
  if (error) {
    console.log(`FAIL  SQL case ${c.id} — ${error.message}`);
    continue;
  }
  const got = Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
  if (check(`SQL case ${c.id}`, { ...got, url: c.url }, c.expectPolicy, c.expectTarget)) passed += 1;
}

total += 1;
const row1 = resolvePolicy(CASES[0].url, policies);
const active = isPolicyActive(row1, new Date());
console.log('\n=== isPolicyActive (case 1, today) ===');
console.log(`${!active ? 'PASS' : 'FAIL'}  effective_date NULL → inactive (got ${active})`);
if (!active) passed += 1;

console.log(`\n${passed}/${total} checks passed`);
process.exit(passed === total ? 0 : 1);
