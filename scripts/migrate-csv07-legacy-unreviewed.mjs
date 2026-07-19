/**
 * Stage 1b: insert CSV-07 rows missing from traditional_seo_target_keyword_overrides
 * as target_class='legacy_unreviewed'. Never overwrites existing DB rows.
 *
 * Usage:
 *   node scripts/migrate-csv07-legacy-unreviewed.mjs
 *   node scripts/migrate-csv07-legacy-unreviewed.mjs --apply
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

// Prefer 09 export when present; fall back to frozen seospace archive for one-off backfill.
const CSV09 = path.join(root, '../alan-shared-resources/csv/09-url-target-keywords.csv');
const CSV07 = fs.existsSync(CSV09)
  ? CSV09
  : path.join(root, '../alan-shared-resources/csv/07-url-target-keywords-seospace.csv');
const PROPERTY = 'https://www.alanranger.com';
const NOTES = 'migrated from CSV07 2026-07-18; pending curation';
const apply = process.argv.includes('--apply');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

function normalizeUrl(u) {
  let s = String(u || '').trim();
  if (!s) return '';
  try {
    const url = new URL(s.startsWith('http') ? s : `https://www.alanranger.com${s.startsWith('/') ? s : `/${s}`}`);
    url.hash = '';
    url.search = '';
    let host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'alanranger.com') host = 'www.alanranger.com';
    let p = url.pathname || '/';
    if (p.length > 1) p = p.replace(/\/+$/, '');
    return `https://${host}${p || '/'}`;
  } catch {
    return s.replace(/\/+$/, '');
  }
}

function pathKey(u) {
  try {
    const url = new URL(normalizeUrl(u));
    let p = (url.pathname || '/').toLowerCase();
    if (p.length > 1) p = p.replace(/\/+$/, '');
    return p || '/';
  } catch {
    return String(u || '').toLowerCase();
  }
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const rows = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        q = !q;
        continue;
      }
      if (c === ',' && !q) {
        cols.push(cur);
        cur = '';
        continue;
      }
      cur += c;
    }
    cols.push(cur);
    rows.push({
      url: (cols[0] || '').trim(),
      target_keyword: (cols[1] || '').trim()
    });
  }
  return rows;
}

async function fetchAllOverrides() {
  const out = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await sb
      .from('traditional_seo_target_keyword_overrides')
      .select('id, page_url, target_keyword, target_class, notes')
      .eq('property_url', PROPERTY)
      .range(from, from + page - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < page) break;
    from += page;
  }
  return out;
}

async function main() {
  const csvRows = parseCsv(fs.readFileSync(CSV07, 'utf8'));
  const existing = await fetchAllOverrides();
  const byPath = new Map();
  for (const r of existing) {
    byPath.set(pathKey(r.page_url), r);
  }

  const toInsert = [];
  const seen = new Set();
  for (const row of csvRows) {
    const norm = normalizeUrl(row.url);
    const key = pathKey(norm);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (byPath.has(key)) continue;
    const kw = String(row.target_keyword || '').trim();
    if (!kw) continue;
    toInsert.push({
      property_url: PROPERTY,
      page_url: norm,
      target_keyword: kw,
      target_class: 'legacy_unreviewed',
      notes: NOTES
    });
  }

  console.log('CSV07 rows:', csvRows.length);
  console.log('DB existing:', existing.length);
  console.log('CSV paths unique:', seen.size);
  console.log('To insert (gaps only):', toInsert.length);
  console.log('Expected after:', existing.length + toInsert.length);

  if (!apply) {
    console.log('\nDry run — pass --apply to insert.');
    console.log('Sample inserts:', toInsert.slice(0, 5));
    return;
  }

  const chunk = 100;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += chunk) {
    const batch = toInsert.slice(i, i + chunk);
    const { error } = await sb.from('traditional_seo_target_keyword_overrides').insert(batch);
    if (error) throw error;
    inserted += batch.length;
    console.log(`inserted ${inserted}/${toInsert.length}`);
  }
  console.log('✓ Migrated', inserted, 'legacy_unreviewed rows');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
