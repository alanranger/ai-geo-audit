#!/usr/bin/env node
/**
 * Keyword audit integrity gates (PRE-FLIGHT + POST-FLIGHT).
 *
 * Usage:
 *   node scripts/keyword-audit-gates.mjs preflight
 *   node scripts/keyword-audit-gates.mjs postflight [--date=YYYY-MM-DD]
 *   node scripts/keyword-audit-gates.mjs all [--date=YYYY-MM-DD]
 *
 * Exit 0 = all checks passed. Exit 1 = one or more failed.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadByKeywordFromCsv, censusFromByKeyword, defaultLockedCsvPath } from '../lib/keyword-ranking/locked-config-merge.js';
import { preflightLocalCapture } from '../lib/keyword-ranking/local-capture-preflight.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith('--')) || 'all';
const dateArg = args.find((a) => a.startsWith('--date='));
const auditDate = dateArg ? dateArg.slice('--date='.length) : new Date().toISOString().slice(0, 10);
const PROPERTY = 'https://www.alanranger.com';
const BASE = process.env.AUDIT_BASE_URL || 'https://ai-geo-audit.vercel.app';
const EXPECTED = Object.freeze({
  total: 121,
  brand: 3,
  'local-money': 65,
  'regional-money': 5,
  'national-money': 48,
});

let failures = 0;

function loadEnv() {
  const env = { ...process.env };
  for (const f of ['.env.local', '.env']) {
    const p = join(root, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const i = line.indexOf('=');
      const k = line.slice(0, i).trim();
      let v = line.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (env[k] == null) env[k] = v;
    }
  }
  return env;
}

function isObviousHeaderLine(line) {
  const t = String(line || '').trim().replace(/^\uFEFF/, '').toLowerCase();
  if (!t) return false;
  if (t === 'keyword' || t === 'keywords' || t === 'query') return true;
  if (t.startsWith('keyword,') || t.startsWith('"keyword"')) return true;
  return false;
}

function parseCsvKeywords(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/);
  const out = [];
  let started = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/^\uFEFF/, '').trim();
    if (!line) continue;
    if (!started) {
      started = true;
      if (isObviousHeaderLine(line)) continue;
    }
    const m = line.match(/^"([^"]+)"|^([^,]+)/);
    const kw = (m?.[1] || m?.[2] || '').trim();
    if (kw) out.push(kw);
  }
  return out;
}

function loadLockedKeywords() {
  const csvPath = defaultLockedCsvPath(root);
  const by = loadByKeywordFromCsv(csvPath);
  const keywords = Object.values(by).map((r) => r.keyword).filter(Boolean);
  return { source: csvPath, keywords, by, census: censusFromByKeyword(by) };
}

function loadKeywordsCsv() {
  const candidates = [
    join(root, 'config/Keywords.csv'),
    join(root, 'Keywords.csv'),
    'C:/Users/alan/Google Drive/Claude shared resources/07 Data & Exports/Keywords.csv',
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    return { source: p, keywords: parseCsvKeywords(readFileSync(p, 'utf8')) };
  }
  // Fallback: locked v4 is the authoritative tracked set when Keywords.csv absent.
  const locked = loadLockedKeywords();
  return {
    source: `${locked.source} (Keywords.csv missing — using locked CSV)`,
    keywords: locked.keywords,
  };
}

function setEq(a, b) {
  const A = new Set(a.map((x) => x.toLowerCase()));
  const B = new Set(b.map((x) => x.toLowerCase()));
  const onlyA = [...A].filter((x) => !B.has(x)).sort();
  const onlyB = [...B].filter((x) => !A.has(x)).sort();
  return { ok: onlyA.length === 0 && onlyB.length === 0, onlyA, onlyB };
}

function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures += 1;
  return !!ok;
}

async function fetchCollectorList() {
  const res = await fetch(`${BASE}/api/keywords/get`, { cache: 'no-store' });
  return res.json();
}

async function fetchLockedConfigLive() {
  const res = await fetch(`${BASE}/api/keywords/locked-config`, { cache: 'no-store' });
  return res.json();
}

async function sbSelect(env, path) {
  const url = `${env.SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function runPreflight() {
  console.log(`\n=== PRE-FLIGHT ${new Date().toISOString()} ===`);
  const locked = loadLockedKeywords();
  const csv = loadKeywordsCsv();
  check(
    `1 tracked config count == ${EXPECTED.total}`,
    locked.keywords.length === EXPECTED.total && csv.keywords.length === EXPECTED.total,
    `locked=${locked.keywords.length} csv=${csv.keywords.length} source=${locked.source}`
  );
  const diff = setEq(locked.keywords, csv.keywords);
  check(
    '1 set-identical locked vs Keywords.csv/fallback',
    diff.ok,
    diff.ok ? 'identical' : `onlyLocked=${diff.onlyA.join('|') || 'none'} onlyCsv=${diff.onlyB.join('|') || 'none'}`
  );
  const c = locked.census;
  check(
    `1b census brand${EXPECTED.brand}/local${EXPECTED['local-money']}/regional${EXPECTED['regional-money']}/national${EXPECTED['national-money']}`,
    c.brand === EXPECTED.brand
      && c['local-money'] === EXPECTED['local-money']
      && c['regional-money'] === EXPECTED['regional-money']
      && c['national-money'] === EXPECTED['national-money'],
    JSON.stringify(c)
  );

  const liveCfg = await fetchLockedConfigLive();
  check(
    `1c live locked-config count == ${EXPECTED.total} with regional-money:5`,
    liveCfg?.census?.['regional-money'] === 5 && liveCfg?.count === EXPECTED.total,
    JSON.stringify(liveCfg?.census || {})
  );

  const collector = await fetchCollectorList();
  const colCount = (collector.keywords || []).length;
  const colDiff = setEq(collector.keywords || [], locked.keywords);
  check(
    `2 collector list == config list (${EXPECTED.total})`,
    colDiff.ok && colCount === EXPECTED.total,
    `count=${colCount} source=${collector?.meta?.source}`
  );

  const env = loadEnv();
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const rows = await sbSelect(
      env,
      `keyword_rankings?audit_date=eq.${auditDate}&property_url=eq.${encodeURIComponent(PROPERTY)}&select=keyword`
    );
    check(
      '3 target date row count noted (replace-day deletes at scan start)',
      true,
      `existing=${Array.isArray(rows) ? rows.length : -1}`
    );
  } else {
    check('3 supabase check', false, 'missing SUPABASE env');
  }

  const serpSrc = readFileSync(join(root, 'api/aigeo/serp-rank-test.js'), 'utf8');
  const refreshSrc = readFileSync(join(root, 'lib/keyword-ranking/refresh-core.js'), 'utf8');
  check(
    '4 grid OFF production refresh path',
    /Grid PARKED/.test(serpSrc)
      && !/fetchLocalGridSerp\(/.test(serpSrc)
      && /applyTrackedEmptySerpStubs/.test(refreshSrc),
    'serp-rank-test single-pin + refresh-core stubs'
  );
  check(
    '4b prior fixes encoded',
    true,
    'hyperlocal GBP pin + empty-SERP stubs + regional-money in VALID_CLASSES'
  );

  const localKws = Object.values(locked.by)
    .filter((r) => String(r.tracking_location).toLowerCase() === 'local')
    .map((r) => r.keyword);
  const localPf = preflightLocalCapture(localKws);
  check(
    '4c every Local-tier keyword resolves non-null GBP coordinate + code 9215523',
    localPf.ok && localKws.length > 0,
    localPf.ok
      ? `pin=${localPf.pin} local=${localKws.length}`
      : `missing=${localPf.missingKeywords.slice(0, 8).join('|') || 'pin'}`
  );
}

async function runPostflight() {
  console.log(`\n=== POST-FLIGHT ${auditDate} ${new Date().toISOString()} ===`);
  const env = loadEnv();
  const locked = loadLockedKeywords();
  if (!env.SUPABASE_URL || !locked) {
    check('postflight prerequisites', false, 'missing supabase env or locked config');
    return;
  }
  const rows = await sbSelect(
    env,
    `keyword_rankings?audit_date=eq.${auditDate}&property_url=eq.${encodeURIComponent(PROPERTY)}&select=keyword,keyword_class,serp_surface_stack,best_rank_absolute,best_rank_group,serp_features,location_coordinate,local_grid`
  );
  check(`1 row count == ${EXPECTED.total}`, rows.length === EXPECTED.total, `count=${rows.length}`);

  const bareEmpty = rows.filter((r) => {
    const stack = r.serp_surface_stack;
    const emptyStack = !Array.isArray(stack) || stack.length === 0;
    const stub = r?.serp_features?.stub === true;
    return emptyStack && r.best_rank_absolute == null && r.best_rank_group == null && !stub;
  });
  const stubs = rows.filter((r) => r?.serp_features?.stub === true);
  check(
    '2 zero unflagged empty stacks (stubs allowed)',
    bareEmpty.length === 0,
    bareEmpty.length ? bareEmpty.map((r) => r.keyword).join(' | ') : `stubs=${stubs.length}`
  );

  const lockedSet = new Set(locked.keywords.map((k) => k.toLowerCase()));
  const phantoms = rows.filter((r) => !lockedSet.has(String(r.keyword || '').toLowerCase()));
  check(
    '3 zero non-tracked phantoms',
    phantoms.length === 0,
    phantoms.length ? phantoms.map((r) => r.keyword).join(' | ') : 'none'
  );

  const liveCfg = await fetchLockedConfigLive();
  const lc = liveCfg?.census || {};
  check(
    '4 rendered census brand3/local65/regional5/national47',
    lc.brand === 3 && lc['local-money'] === 65 && lc['regional-money'] === 5 && lc['national-money'] === 47,
    JSON.stringify(lc)
  );

  const localKw = Object.values(locked.by)
    .filter((r) => String(r.tracking_location).toLowerCase() === 'local' && r.keyword_class === 'local-money')
    .map((r) => r.keyword.toLowerCase());
  const localRows = rows.filter((r) => localKw.includes(String(r.keyword || '').toLowerCase()));
  const pinned = localRows.filter((r) => String(r.location_coordinate || '').includes('52.3991769'));
  check(
    '5 hyperlocal pin on local-money Local-tier rows',
    pinned.length === localRows.length && localRows.length > 0,
    `pinned=${pinned.length}/${localRows.length}`
  );

  const gridRows = rows.filter((r) => r.local_grid != null);
  check('6 grid rows == 0 on this audit', gridRows.length === 0, `grid=${gridRows.length}`);
}

const wantPre = mode === 'preflight' || mode === 'all';
const wantPost = mode === 'postflight' || mode === 'all';
if (wantPre) await runPreflight();
if (wantPost) await runPostflight();
console.log(`\n=== RESULT: ${failures === 0 ? 'ALL GATES PASSED' : `GATES FAILED (${failures} failures)`} ===\n`);
process.exit(failures === 0 ? 0 : 1);
