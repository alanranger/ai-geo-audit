// Phase C / C2 -- idempotent loader for per-product seasonality classification.
//
// Reads alan-shared-resources/csv/files/product-seasonality-classification-FINAL...csv
// (99 rows, schema: product_title, category, service_page_url, typical_price_gbp,
// seasonality_type, event_months, classification_reason) and UPDATEs canonical_products
// matched on product_title. Reports matched / unmatched counts and a count-by-type
// summary so the run can be reviewed before C2 analyser changes.
//
//   node scripts/load-product-seasonality.mjs

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const CSV_PATH = String.raw`G:\Dropbox\alan ranger photography\Website Code\alan-shared-resources\csv\files\product-seasonality-classification-FINAL - product-seasonality-classification-FINAL.csv.csv`;
const VALID_TYPES = new Set(['year_round', 'season_bound', 'event_bound', 'none']);

function parseCsv(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    out.push(parseCsvRow(line));
  }
  return out;
}

function parseCsvRow(line) {
  const cells = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; continue; }
      if (ch === '"') { inQuote = false; continue; }
      cur += ch;
      continue;
    }
    if (ch === '"') { inQuote = true; continue; }
    if (ch === ',') { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur);
  return cells;
}

function rowsFromCsv(text) {
  const grid = parseCsv(text);
  if (grid.length < 2) return [];
  const headers = grid[0].map(h => h.trim());
  const colIdx = (name) => headers.indexOf(name);
  const titleI = colIdx('product_title');
  const typeI = colIdx('seasonality_type');
  const monthsI = colIdx('event_months');
  if (titleI < 0 || typeI < 0 || monthsI < 0) {
    throw new Error(`CSV missing one of required columns: product_title, seasonality_type, event_months. Got headers=${JSON.stringify(headers)}`);
  }
  return grid.slice(1).map(cells => ({
    product_title: (cells[titleI] || '').trim(),
    seasonality_type: (cells[typeI] || '').trim(),
    event_months: ((cells[monthsI] || '').trim()) || null
  }));
}

function validateRow(r, lineNo) {
  if (!r.product_title) return { fatal: true, msg: `line ${lineNo}: missing product_title` };
  if (!VALID_TYPES.has(r.seasonality_type)) return { fatal: true, msg: `line ${lineNo}: invalid seasonality_type=${JSON.stringify(r.seasonality_type)} for ${r.product_title}` };
  if (r.event_months && !/^([1-9]|1[0-2])(,([1-9]|1[0-2]))*$/.test(r.event_months)) return { fatal: true, msg: `line ${lineNo}: malformed event_months=${JSON.stringify(r.event_months)} for ${r.product_title}` };
  // Soft warning: event_bound without event_months -> analyser will mark as insufficient_history (safe fallback).
  if (r.seasonality_type === 'event_bound' && !r.event_months) return { fatal: false, msg: `line ${lineNo}: WARN event_bound has empty event_months for ${r.product_title} (will be loaded; analyser will treat as insufficient_history)` };
  return null;
}

function createSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env.local');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function loadOne(supabase, row) {
  const { data, error } = await supabase
    .from('canonical_products')
    .update({ seasonality_type: row.seasonality_type, event_months: row.event_months })
    .eq('product_title', row.product_title)
    .select('product_title');
  if (error) throw error;
  return (data || []).length;
}

async function run() {
  const text = readFileSync(CSV_PATH, 'utf8');
  const rows = rowsFromCsv(text);
  console.log(`Parsed ${rows.length} CSV data rows.`);

  const fatals = [];
  const warns = [];
  rows.forEach((r, i) => {
    const e = validateRow(r, i + 2);
    if (!e) return;
    if (e.fatal) fatals.push(e.msg); else warns.push(e.msg);
  });
  if (warns.length) {
    console.warn(`Validation warnings (${warns.length}):`);
    warns.forEach(w => console.warn('  -', w));
  }
  if (fatals.length) {
    console.error(`Validation errors (${fatals.length}):`);
    fatals.forEach(e => console.error('  -', e));
    process.exit(1);
  }

  const supabase = createSupabase();
  let matched = 0;
  const unmatched = [];
  for (const r of rows) {
    const n = await loadOne(supabase, r);
    if (n > 0) matched += n;
    else unmatched.push(r.product_title);
  }
  console.log(`Matched + updated: ${matched}`);
  console.log(`Unmatched (no canonical_products row with this product_title): ${unmatched.length}`);
  if (unmatched.length) {
    console.log('Unmatched titles:');
    unmatched.forEach(t => console.log('  -', t));
  }

  const { data: countRows, error: countErr } = await supabase
    .from('canonical_products')
    .select('seasonality_type', { count: 'exact' });
  if (countErr) throw countErr;
  const byType = {};
  let nullCount = 0;
  for (const r of (countRows || [])) {
    if (r.seasonality_type == null) { nullCount += 1; continue; }
    byType[r.seasonality_type] = (byType[r.seasonality_type] || 0) + 1;
  }
  console.log('Count by seasonality_type:');
  for (const t of ['year_round', 'season_bound', 'event_bound', 'none']) {
    console.log(`  ${t}: ${byType[t] || 0}`);
  }
  console.log(`  NULL (unclassified): ${nullCount}`);
  console.log(`Total canonical_products rows: ${(countRows || []).length}`);
}

try { await run(); } catch (err) { console.error('FATAL:', err); process.exit(1); }
