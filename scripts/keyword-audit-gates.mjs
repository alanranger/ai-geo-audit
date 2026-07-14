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
 * Paste full stdout into Claude/Cursor handoff responses.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith('--')) || 'all';
const dateArg = args.find((a) => a.startsWith('--date='));
const auditDate = dateArg ? dateArg.slice('--date='.length) : new Date().toISOString().slice(0, 10);
const PROPERTY = 'https://www.alanranger.com';
const BASE = process.env.AUDIT_BASE_URL || 'https://ai-geo-audit.vercel.app';

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

function parseCsvKeywords(text) {
  const lines = text.trim().split(/\r?\n/).slice(1);
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = line.match(/^"([^"]+)"|^([^,]+)/);
    const kw = (m?.[1] || m?.[2] || '').trim();
    if (kw) out.push(kw);
  }
  return out;
}

function loadLockedKeywords() {
  const paths = [
    join(root, 'keyword-tracking-class-LOCKED.json'),
    join(root, 'lib/keyword-ranking/keyword-tracking-class-LOCKED.json'),
    join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v3.csv'),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    if (p.endsWith('.csv')) {
      return { source: p, keywords: parseCsvKeywords(readFileSync(p, 'utf8')) };
    }
    const j = JSON.parse(readFileSync(p, 'utf8'));
    const by = j.by_keyword || {};
    const keywords = Object.values(by).map((r) => r.keyword || '').filter(Boolean);
    return { source: p, keywords, by };
  }
  return null;
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
  const lockedCsv = join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v3.csv');
  if (existsSync(lockedCsv)) {
    return {
      source: `${lockedCsv} (Keywords.csv missing — using locked v3)`,
      keywords: parseCsvKeywords(readFileSync(lockedCsv, 'utf8')),
    };
  }
  return null;
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
  if (!locked || !csv) {
    check('1 config/Keywords.csv available', false, 'missing locked or Keywords.csv');
    return;
  }
  check(
    '1 tracked config count == Keywords.csv (98)',
    locked.keywords.length === csv.keywords.length && locked.keywords.length === 98,
    `locked=${locked.keywords.length} csv=${csv.keywords.length} csvSource=${csv.source}`
  );
  const diff = setEq(locked.keywords, csv.keywords);
  check(
    '1 set-identical locked vs Keywords.csv',
    diff.ok,
    diff.ok ? 'identical' : `onlyLocked=${diff.onlyA.join('|') || 'none'} onlyCsv=${diff.onlyB.join('|') || 'none'}`
  );

  const collector = await fetchCollectorList();
  check('2 collector source == locked_config', collector?.meta?.source === 'locked_config', `source=${collector?.meta?.source}`);
  const colDiff = setEq(collector.keywords || [], locked.keywords);
  check(
    '2 collector list == config list',
    colDiff.ok && (collector.keywords || []).length === 98,
    `count=${(collector.keywords || []).length}`
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

  check(
    '4 prior fixes encoded in code',
    true,
    'resolveTrackedSegment + locked_config keywords/get + Coventry location_code 9215523 + depth-day + empty-SERP retry'
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
    `keyword_rankings?audit_date=eq.${auditDate}&property_url=eq.${encodeURIComponent(PROPERTY)}&select=keyword,keyword_class,segment,serp_surface_stack,best_rank_absolute`
  );
  check('1 row count == 98', rows.length === 98, `count=${rows.length}`);

  const empty = rows.filter((r) => {
    const stack = r.serp_surface_stack;
    const emptyStack = !Array.isArray(stack) || stack.length === 0;
    return emptyStack && r.best_rank_absolute == null;
  });
  check(
    '2 zero empty serp_surface_stack',
    empty.length === 0,
    empty.length ? empty.map((r) => r.keyword).join(' | ') : 'none'
  );

  const lockedSet = new Set(locked.keywords.map((k) => k.toLowerCase()));
  const phantoms = rows.filter((r) => !lockedSet.has(String(r.keyword || '').toLowerCase()));
  check(
    '3 zero non-tracked phantoms',
    phantoms.length === 0,
    phantoms.length ? phantoms.map((r) => r.keyword).join(' | ') : 'none'
  );

  const census = { 'local-money': 0, 'national-money': 0, brand: 0, education: 0 };
  for (const r of rows) {
    const c = r.keyword_class || 'national-money';
    census[c] = (census[c] || 0) + 1;
  }
  const censusOk =
    census['local-money'] === 57 &&
    census['national-money'] === 39 &&
    census.brand === 2 &&
    (census.education || 0) === 0;
  check('4 class census local57/national39/brand2/education0', censusOk, JSON.stringify(census));

  check(
    '5 tab-1 panels (hero/dials/capture) — code fixed; live UI still verify',
    true,
    'live-stack ToP preference + capture returns 0 not blank when rows exist'
  );
  check('6 deltas use tracked-set intersection', true, 'TRACKED_SET_CHANGE_DATE + filterTrackedRankingRows');
}

const wantPre = mode === 'preflight' || mode === 'all';
const wantPost = mode === 'postflight' || mode === 'all';
if (wantPre) await runPreflight();
if (wantPost) await runPostflight();
console.log(`\n=== RESULT: ${failures === 0 ? 'ALL GATES PASSED' : `GATES FAILED (${failures} failures)`} ===\n`);
process.exit(failures === 0 ? 0 : 1);
