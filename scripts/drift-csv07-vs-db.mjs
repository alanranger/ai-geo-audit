/**
 * Quantify URL target drift: old seospace CSV vs DB master (path-normalized).
 * Usage: node scripts/drift-csv07-vs-db.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });
const CSV07 = path.join(root, '../alan-shared-resources/csv/07-url-target-keywords-seospace.csv');
const PROPERTY = 'https://www.alanranger.com';

const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function pathKey(u) {
  try {
    const url = new URL(u.startsWith('http') ? u : `https://www.alanranger.com${u}`);
    let p = (url.pathname || '/').toLowerCase();
    if (p.length > 1) p = p.replace(/\/+$/, '');
    return p || '/';
  } catch {
    return String(u || '').toLowerCase();
  }
}

function normKw(k) {
  return String(k || '').trim().toLowerCase().replace(/\s+/g, ' ');
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
      if (c === '"') { q = !q; continue; }
      if (c === ',' && !q) { cols.push(cur); cur = ''; continue; }
      cur += c;
    }
    cols.push(cur);
    rows.push({ url: (cols[0] || '').trim(), kw: (cols[1] || '').trim() });
  }
  return rows;
}

const csv = parseCsv(fs.readFileSync(CSV07, 'utf8'));
const csvByPath = new Map();
for (const r of csv) csvByPath.set(pathKey(r.url), r.kw);

const { data, error } = await sb
  .from('traditional_seo_target_keyword_overrides')
  .select('page_url, target_keyword, target_class')
  .eq('property_url', PROPERTY);
if (error) throw error;

const dbByPath = new Map();
for (const r of data || []) dbByPath.set(pathKey(r.page_url), r);

let same = 0;
let differ = 0;
let csvOnly = 0;
let dbOnly = 0;
const differSamples = [];

for (const [p, csvKw] of csvByPath) {
  const db = dbByPath.get(p);
  if (!db) { csvOnly += 1; continue; }
  if (normKw(csvKw) === normKw(db.target_keyword)) same += 1;
  else {
    differ += 1;
    if (differSamples.length < 12) {
      differSamples.push({ path: p, csv: csvKw, db: db.target_keyword, class: db.target_class });
    }
  }
}
for (const p of dbByPath.keys()) {
  if (!csvByPath.has(p)) dbOnly += 1;
}

console.log(JSON.stringify({
  csvRows: csv.length,
  dbRows: (data || []).length,
  sameKeyword: same,
  differKeyword: differ,
  csvOnlyNoDb: csvOnly,
  dbOnlyNoCsv: dbOnly,
  differSamples
}, null, 2));
