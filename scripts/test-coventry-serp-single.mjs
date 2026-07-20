/**
 * Single-keyword SERP test for Coventry-vantage terms (no full audit).
 * Usage: node scripts/test-coventry-serp-single.mjs [--save]
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEYWORDS = [
  'hire a photographer coventry',
  'photography lessons coventry',
  'photography workshops coventry',
];
const BASE = process.env.CRON_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://ai-geo-audit.vercel.app';
const SAVE = process.argv.includes('--save');
const AUDIT_DATE = '2026-07-14';
const PROPERTY = 'https://www.alanranger.com';

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

async function testKeyword(keyword) {
  const url = `${BASE}/api/aigeo/serp-rank-test?keyword=${encodeURIComponent(keyword)}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(120000) });
  const json = await resp.json();
  const row = json?.per_keyword?.[0] || null;
  const stackLen = Array.isArray(row?.serp_surface_stack) ? row.serp_surface_stack.length : 0;
  return {
    keyword,
    status: resp.status,
    rank: row?.best_rank_group ?? null,
    location: row?.location_name ?? null,
    stackLen,
    error: row?.error ?? null,
    ok: stackLen > 0 && !row?.error,
  };
}

async function refreshKeyword(keyword) {
  const resp = await fetch(`${BASE}/api/aigeo/refresh-keywords`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keywords: [keyword],
      propertyUrl: PROPERTY,
      auditDate: AUDIT_DATE,
    }),
    signal: AbortSignal.timeout(120000),
  });
  const json = await resp.json();
  const row = json?.rows?.[0] || null;
  const stackLen = Array.isArray(row?.serp_surface_stack) ? row.serp_surface_stack.length : 0;
  return { keyword, status: resp.status, stackLen, message: json?.message || json?.status, ok: json?.status === 'ok' && stackLen > 0 };
}

async function main() {
  console.log(`Coventry single-keyword SERP test — base=${BASE}`);
  let allOk = true;
  for (const kw of KEYWORDS) {
    const r = await testKeyword(kw);
    console.log(
      `${r.ok ? 'PASS' : 'FAIL'} "${kw}" rank=${r.rank} location=${r.location} stack=${r.stackLen}${r.error ? ` error=${r.error}` : ''}`
    );
    if (!r.ok) allOk = false;
    if (SAVE && !r.ok) {
      const saved = await refreshKeyword(kw);
      console.log(`  refresh → ${saved.ok ? 'PASS' : 'FAIL'} stack=${saved.stackLen} (${saved.message || saved.status})`);
      if (saved.ok) allOk = true;
    }
  }
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
