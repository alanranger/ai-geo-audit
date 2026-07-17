/**
 * Mandatory pre/post-flight gates for keyword audit runs.
 *
 * Usage:
 *   node scripts/audit-integrity-gates.mjs --mode=pre --audit-date=2026-07-14
 *   node scripts/audit-integrity-gates.mjs --mode=post --audit-date=2026-07-14
 *   node scripts/audit-integrity-gates.mjs --mode=cleanup-phantoms --audit-date=2026-07-14
 *   node scripts/audit-integrity-gates.mjs --mode=report --audit-date=2026-07-14
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  REMOVED_FROM_TRACKING_EXACT,
  filterTrackedKeywords,
} from '../lib/keyword-ranking/tracked-set-v3.js';
import { resolveKeywordClass } from '../lib/keyword-ranking/tracking-class.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_COUNT = 98;
const EXPECTED_CLASS = { local: 57, national: 39, brand: 2, education: 0 };
const PHANTOM_KEYWORDS = [...REMOVED_FROM_TRACKING_EXACT];
const COVENTRY_EMPTY_CANDIDATES = [
  'hire a photographer coventry',
  'photography lessons coventry',
  'photography workshops coventry',
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

function parseArgs() {
  const out = {
    mode: 'report',
    auditDate: '2026-07-14',
    propertyUrl: process.env.CRON_PROPERTY_URL || 'https://www.alanranger.com',
  };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--mode=')) out.mode = arg.slice(7);
    if (arg.startsWith('--audit-date=')) out.auditDate = arg.slice(13);
    if (arg.startsWith('--property-url=')) out.propertyUrl = arg.slice(15);
  }
  return out;
}

function loadConfigKeywords() {
  const paths = [
    join(ROOT, 'keyword-tracking-class-LOCKED.json'),
    join(ROOT, 'lib/keyword-ranking/keyword-tracking-class-LOCKED.json'),
    join(ROOT, '../alan-shared-resources/csv/Keywords.csv'),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const raw = readFileSync(p, 'utf8');
    if (p.endsWith('.csv')) {
      const kws = raw.trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      return filterTrackedKeywords(kws).sort();
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.keywords)) return filterTrackedKeywords(parsed.keywords).sort();
    const by = parsed.by_keyword || {};
    const kws = Object.keys(by).map((k) => (by[k]?.keyword || k).trim()).filter(Boolean);
    if (kws.length) return filterTrackedKeywords(kws).sort();
  }
  throw new Error('Could not load locked keyword config');
}

function loadCollectorKeywords() {
  const p = join(ROOT, 'public/tracked-keywords-fallback.json');
  if (!existsSync(p)) return [];
  const parsed = JSON.parse(readFileSync(p, 'utf8'));
  return filterTrackedKeywords(parsed.keywords || []).sort();
}

function classCensus(rows) {
  const census = { local: 0, national: 0, brand: 0, education: 0, unmapped: 0 };
  for (const row of rows) {
    const cls = resolveKeywordClass(row.keyword).keyword_class || row.keyword_class || 'unmapped';
    if (cls === 'local-money') census.local += 1;
    else if (cls === 'brand') census.brand += 1;
    else if (cls === 'education') census.education += 1;
    else if (cls === 'national-money') census.national += 1;
    else census.unmapped += 1;
  }
  return census;
}

function isEmptyStack(row) {
  const stack = row.serp_surface_stack;
  if (stack == null) return true;
  if (typeof stack === 'string') {
    try {
      const parsed = JSON.parse(stack);
      return !Array.isArray(parsed) || parsed.length === 0;
    } catch {
      return true;
    }
  }
  return !Array.isArray(stack) || stack.length === 0;
}

function diffSets(a, b) {
  const onlyA = a.filter((k) => !b.includes(k));
  const onlyB = b.filter((k) => !a.includes(k));
  return { onlyA, onlyB };
}

function printHeader(title) {
  console.log(`\n=== ${title} ===`);
}

async function fetchRows(supabase, propertyUrl, auditDate) {
  const { data, error } = await supabase
    .from('keyword_rankings')
    .select('keyword, keyword_class, serp_surface_stack, best_rank_group, location_name, segment')
    .eq('property_url', propertyUrl)
    .eq('audit_date', auditDate)
    .order('keyword');
  if (error) throw error;
  return data || [];
}

async function runPreFlight(supabase, opts) {
  const checks = [];
  const configKws = loadConfigKeywords();
  const collectorKws = loadCollectorKeywords();
  const csvPath = join(ROOT, '../alan-shared-resources/csv/Keywords.csv');
  let csvCount = null;
  if (existsSync(csvPath)) {
    csvCount = readFileSync(csvPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).length;
  }

  printHeader('PRE-FLIGHT');
  const configOk = configKws.length === EXPECTED_COUNT;
  checks.push({ name: 'config_count_98', pass: configOk, detail: `config=${configKws.length}` });
  console.log(`1. Config count: ${configKws.length} (expected ${EXPECTED_COUNT}) — ${configOk ? 'PASS' : 'FAIL'}`);

  if (csvCount != null) {
    const csvOk = csvCount === EXPECTED_COUNT;
    const { onlyA, onlyB } = diffSets(configKws, filterTrackedKeywords(
      readFileSync(csvPath, 'utf8').trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    ).sort());
    checks.push({ name: 'csv_matches_config', pass: csvOk && !onlyA.length && !onlyB.length, detail: `csv=${csvCount}` });
    console.log(`   Keywords.csv count: ${csvCount} — ${csvOk ? 'PASS' : 'FAIL'}`);
    if (onlyA.length || onlyB.length) {
      console.log(`   Set diff — only config: ${onlyA.join(', ') || 'none'}`);
      console.log(`   Set diff — only csv: ${onlyB.join(', ') || 'none'}`);
    }
  }

  const collectorOk = collectorKws.length === EXPECTED_COUNT
    && !diffSets(configKws, collectorKws).onlyA.length
    && !diffSets(configKws, collectorKws).onlyB.length;
  checks.push({ name: 'collector_matches_config', pass: collectorOk, detail: `collector=${collectorKws.length}` });
  console.log(`2. Collector list matches config (${collectorKws.length}) — ${collectorOk ? 'PASS' : 'FAIL'}`);

  const existing = await fetchRows(supabase, opts.propertyUrl, opts.auditDate);
  const hasExisting = existing.length > 0;
  checks.push({
    name: 'no_existing_rows_or_replace_semantics',
    pass: !hasExisting,
    detail: `existing_rows=${existing.length} (replace-semantics must delete before write if >0)`,
  });
  console.log(`3. No existing rows for ${opts.auditDate}: ${existing.length} rows — ${hasExisting ? 'WARN (replace-semantics required)' : 'PASS'}`);

  const phantoms = existing.filter((r) => PHANTOM_KEYWORDS.includes(r.keyword));
  checks.push({ name: 'no_phantoms_pre', pass: phantoms.length === 0, detail: phantoms.map((r) => r.keyword).join(', ') });
  console.log(`4. No phantom keywords present — ${phantoms.length ? `FAIL (${phantoms.length})` : 'PASS'}`);

  const failed = checks.filter((c) => !c.pass && c.name !== 'no_existing_rows_or_replace_semantics');
  return { checks, pass: failed.length === 0 };
}

async function runPostFlight(supabase, opts) {
  printHeader('POST-FLIGHT');
  const rows = await fetchRows(supabase, opts.propertyUrl, opts.auditDate);
  const configKws = loadConfigKeywords();
  const rowKeywords = rows.map((r) => r.keyword).filter(Boolean);
  const trackedRows = filterTrackedKeywords(rowKeywords);
  const checks = [];

  const countOk = rows.length === EXPECTED_COUNT;
  checks.push({ name: 'row_count_98', pass: countOk, detail: `rows=${rows.length}` });
  console.log(`1. Row count == ${EXPECTED_COUNT}: ${rows.length} — ${countOk ? 'PASS' : 'FAIL'}`);

  const emptyStacks = rows.filter(isEmptyStack);
  checks.push({ name: 'zero_empty_stacks', pass: emptyStacks.length === 0, detail: emptyStacks.map((r) => r.keyword).join(', ') });
  console.log(`2. Zero empty serp_surface_stack: ${emptyStacks.length} — ${emptyStacks.length ? 'FAIL' : 'PASS'}`);
  if (emptyStacks.length) {
    console.log(`   Empty: ${emptyStacks.map((r) => r.keyword).join(', ')}`);
  }

  const phantoms = rows.filter((r) => PHANTOM_KEYWORDS.includes(r.keyword));
  checks.push({ name: 'zero_phantoms', pass: phantoms.length === 0, detail: phantoms.map((r) => r.keyword).join(', ') });
  console.log(`3. Zero phantom keywords: ${phantoms.length} — ${phantoms.length ? 'FAIL' : 'PASS'}`);

  const census = classCensus(rows);
  const censusOk = census.local === EXPECTED_CLASS.local
    && census.national === EXPECTED_CLASS.national
    && census.brand === EXPECTED_CLASS.brand
    && census.education === EXPECTED_CLASS.education;
  checks.push({ name: 'class_census', pass: censusOk, detail: JSON.stringify(census) });
  console.log(`4. Class census local ${census.local}/57 · national ${census.national}/39 · brand ${census.brand}/2 · education ${census.education}/0 — ${censusOk ? 'PASS' : 'FAIL'}`);

  const rowSet = new Set(trackedRows.map((k) => k.toLowerCase()));
  const configSet = new Set(configKws.map((k) => k.toLowerCase()));
  const missing = configKws.filter((k) => !rowSet.has(k.toLowerCase()));
  const extra = trackedRows.filter((k) => !configSet.has(k.toLowerCase()));
  const setOk = !missing.length && !extra.length;
  checks.push({ name: 'tracked_set_identical', pass: setOk, detail: `missing=${missing.length} extra=${extra.length}` });
  console.log(`5. Tracked set identical: missing=${missing.length} extra=${extra.length} — ${setOk ? 'PASS' : 'FAIL'}`);

  const coventryEmpty = rows.filter((r) => COVENTRY_EMPTY_CANDIDATES.includes(r.keyword) && isEmptyStack(r));
  checks.push({ name: 'coventry_stacks_present', pass: coventryEmpty.length === 0, detail: coventryEmpty.map((r) => r.keyword).join(', ') });
  console.log(`6. Coventry-vantage stacks present — ${coventryEmpty.length ? `FAIL (${coventryEmpty.map((r) => r.keyword).join(', ')})` : 'PASS'}`);

  const failed = checks.filter((c) => !c.pass);
  return { checks, pass: failed.length === 0, rows, census };
}

async function cleanupPhantoms(supabase, opts) {
  printHeader('CLEANUP PHANTOMS');
  const before = await fetchRows(supabase, opts.propertyUrl, opts.auditDate);
  console.log(`Before: ${before.length} rows`);
  const toDelete = before.filter((r) => PHANTOM_KEYWORDS.includes(r.keyword));
  if (!toDelete.length) {
    console.log('No phantom rows to delete.');
    return runPostFlight(supabase, opts);
  }
  for (const row of toDelete) {
    const { error } = await supabase
      .from('keyword_rankings')
      .delete()
      .eq('property_url', opts.propertyUrl)
      .eq('audit_date', opts.auditDate)
      .eq('keyword', row.keyword);
    if (error) throw error;
    console.log(`Deleted phantom: "${row.keyword}"`);
  }
  return runPostFlight(supabase, opts);
}

async function main() {
  const opts = parseArgs();
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('FAIL: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log(`Audit integrity gates — mode=${opts.mode} date=${opts.auditDate} property=${opts.propertyUrl}`);

  let result;
  if (opts.mode === 'pre') result = await runPreFlight(supabase, opts);
  else if (opts.mode === 'post') result = await runPostFlight(supabase, opts);
  else if (opts.mode === 'cleanup-phantoms') result = await cleanupPhantoms(supabase, opts);
  else {
    await runPreFlight(supabase, opts);
    result = await runPostFlight(supabase, opts);
  }

  printHeader('SUMMARY');
  console.log(result.pass ? 'OVERALL: PASS' : 'OVERALL: FAIL');
  if (!result.pass && result.checks) {
    for (const c of result.checks.filter((x) => !x.pass)) {
      console.log(`  FAIL: ${c.name} — ${c.detail}`);
    }
  }
  process.exit(result.pass ? 0 : 1);
}

main().catch((err) => {
  console.error('Gate script error:', err.message);
  process.exit(1);
});
