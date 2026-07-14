/**
 * Seed search_volume from Keywords Everywhere export (2026-07-14).
 * - Writes lib/keyword-ranking/ke-search-volumes.json
 * - Patches keyword_rankings rows where search_volume is NULL or 0 only
 *
 * Usage: node scripts/seed-search-volumes-from-ke.mjs
 */

import dotenv from 'dotenv';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { filterTrackedKeywords, isTrackedKeyword } from '../lib/keyword-ranking/tracked-set-v3.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(root, '.env.local') });
dotenv.config({ path: join(root, '.env') });

const keCsv = 'C:/Users/alan/Google Drive/Claude shared resources/07 Data & Exports/search-volume_2026-07-14_174317.csv';
const outJson = join(root, 'lib/keyword-ranking/ke-search-volumes.json');
const propertyUrl = 'https://www.alanranger.com';
const auditDate = '2026-07-14';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const headers = {
  'Content-Type': 'application/json',
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
  Prefer: 'return=minimal',
};

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseKeCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const byKeyword = {};
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const keyword = cols[0]?.trim().toLowerCase();
    const volRaw = cols[4]?.trim();
    const vol = volRaw === '' ? null : Number(volRaw);
    if (keyword) byKeyword[keyword] = Number.isFinite(vol) ? vol : null;
  }
  return byKeyword;
}

async function sbGet(path) {
  const r = await fetch(`${supabaseUrl}${path}`, {
    headers: { ...headers, Prefer: 'return=representation' },
  });
  if (!r.ok) throw new Error(`GET ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function sbPatch(path, body) {
  const r = await fetch(`${supabaseUrl}${path}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PATCH ${path}: ${r.status} ${await r.text()}`);
}

async function main() {
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const csvText = readFileSync(keCsv, 'utf8');
  const byKeyword = parseKeCsv(csvText);
  const keywordsPath = join(root, '../alan-shared-resources/csv/Keywords.csv');
  const tracked = filterTrackedKeywords(
    readFileSync(keywordsPath, 'utf8').trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  );

  writeFileSync(
    outJson,
    JSON.stringify({ source: 'search-volume_2026-07-14_174317.csv', seeded_at: new Date().toISOString(), by_keyword: byKeyword }, null, 2)
  );
  console.log(`✓ Wrote ${Object.keys(byKeyword).length} KE volumes to ke-search-volumes.json`);

  const rows = await sbGet(
    `/rest/v1/keyword_rankings?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.${auditDate}&select=id,keyword,search_volume`
  );
  console.log(`✓ Loaded ${rows.length} keyword_rankings rows for ${auditDate}`);

  let patched = 0;
  let skipped = 0;
  const newEleven = new Set([
    'photographer near me', 'photography course', 'photographer for hire', 'basic photography lessons',
    'photography workshops coventry', 'photography courses online', 'free photography courses',
    'free online photography courses', 'online photography courses uk', 'photography experience gifts',
    'outdoor photography training',
  ]);
  let newElevenSeeded = 0;

  for (const row of rows) {
    if (!isTrackedKeyword(row.keyword)) continue;
    const key = String(row.keyword || '').trim().toLowerCase();
    const stored = row.search_volume;
    const n = Number(stored);
    if (Number.isFinite(n) && n > 0) {
      skipped += 1;
      continue;
    }
    const keVol = byKeyword[key];
    if (keVol == null || !Number.isFinite(Number(keVol))) continue;
    await sbPatch(`/rest/v1/keyword_rankings?id=eq.${row.id}`, { search_volume: Number(keVol) });
    patched += 1;
    if (newEleven.has(key)) newElevenSeeded += 1;
  }

  console.log(`✓ Patched ${patched} rows (skipped ${skipped} with existing non-null/non-zero volume)`);
  console.log(`✓ New-eleven seeded in DB: ${newElevenSeeded} (remaining await first audit row)`);
  console.log(`✓ KE map covers ${tracked.filter((k) => byKeyword[k.toLowerCase()] != null).length}/${tracked.length} tracked keywords`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
