// scripts/load-canonical-products-and-mapping.mjs
//
// Phase A reference-data loader. Idempotent: deletes everything in the two
// tables for a clean reload from CSV, then bulk-upserts.
//
// Reads:
//   alan-shared-resources/csv/files/canonical-products-amended.csv  (99 rows)
//   alan-shared-resources/csv/files/event-product-mapping-FINAL.csv (276 rows)
//
// Writes:
//   public.canonical_products      (99 rows)
//   public.event_product_mapping   (276 rows, FK to canonical_products)
//
// Derivations:
//   is_redemption = product_title ~ /redemption/i  (one row only)
//   is_retired    = (product_title OR sources) ~ /retired|historical/i
//                   (~7 rows expected)
//
// Usage:
//   node scripts/load-canonical-products-and-mapping.mjs --dry-run
//   node scripts/load-canonical-products-and-mapping.mjs

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

loadDotEnv(resolve(__dirname, '..', '.env.local'));

const PRODUCTS_CSV = 'G:/Dropbox/alan ranger photography/Website Code/alan-shared-resources/csv/files/canonical-products-amended.csv';
const MAPPING_CSV  = 'G:/Dropbox/alan ranger photography/Website Code/alan-shared-resources/csv/files/event-product-mapping-FINAL.csv';

// ----------------------------------------------------------------------
// .env.local loader (project convention -- avoids hard dep on dotenv)
// ----------------------------------------------------------------------

function loadDotEnv(p) {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
}

// ----------------------------------------------------------------------
// Tiny RFC-4180 CSV parser (no external deps)
// ----------------------------------------------------------------------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i += 1; }
      else if (c === '"') { inQuote = false; }
      else { cur += c; }
    } else if (c === '"') { inQuote = true; }
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else { cur += c; }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(v => v?.length));
}

function readCsv(path) {
  const text = readFileSync(path, 'utf8');
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
}

// ----------------------------------------------------------------------
// Row builders
// ----------------------------------------------------------------------

const REDEMPTION_RE = /redemption/i;
const RETIRED_RE    = /retired|historical/i;

function toCanonicalProductRow(r) {
  const title = r.product_title || '';
  const sources = r.sources || '';
  return {
    product_title: title,
    product_url: r.product_url || null,
    category: r.category || null,
    typical_price_gbp: r.typical_price_gbp ? Number(r.typical_price_gbp) : null,
    service_page_url: r.service_page_url || null,
    service_page_title: r.service_page_title || null,
    is_redemption: REDEMPTION_RE.test(title),
    is_retired: RETIRED_RE.test(title) || RETIRED_RE.test(sources),
    known_variants: r.known_variants || null,
    notes: sources || null
  };
}

function toEventMappingRow(r) {
  const conf = (r.confidence || '').trim().toUpperCase();
  return {
    event_text: r.event_text || '',
    booking_category: r.booking_category || null,
    canonical_product: r.canonical_product || '',
    confidence: ['HIGH', 'MED', 'LOW'].includes(conf) ? conf : null,
    note: r.note || null
  };
}

// ----------------------------------------------------------------------
// DB helpers
// ----------------------------------------------------------------------

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function upsertChunks(supabase, table, rows, conflictCol) {
  for (const batch of chunk(rows, 500)) {
    const { error } = await supabase.from(table).upsert(batch, { onConflict: conflictCol });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
}

// The source CSV has exact-duplicate (booking_category, event_text) rows
// for a handful of entries (e.g. "Woodland Masterclass" appears 3x in
// 2. Workshops Non-Res, "Print Sales" 2x in 10. Prints, etc.) where the
// duplicate rows are identical. Dedupe within (booking_category, event_text)
// last-write-wins -- the row count drops from 276 to the distinct-pair
// count (expected ~270).
function dedupeMapping(mapping) {
  const seen = new Map();
  for (const r of mapping) {
    const key = `${r.booking_category}||${r.event_text}`;
    seen.set(key, r);
  }
  return [...seen.values()];
}

async function loadAll(supabase, products, mapping) {
  // Order matters: products first (so FK from mapping resolves).
  console.log('--- writing canonical_products ---');
  await supabase.from('event_product_mapping').delete().neq('event_text', '__NEVER__');
  await supabase.from('canonical_products').delete().neq('product_title', '__NEVER__');
  await upsertChunks(supabase, 'canonical_products', products, 'product_title');
  console.log(`  wrote ${products.length} canonical_products rows`);
  console.log('--- writing event_product_mapping ---');
  const deduped = dedupeMapping(mapping);
  if (deduped.length !== mapping.length) {
    console.log(`  deduped ${mapping.length} -> ${deduped.length} (collapsed ${mapping.length - deduped.length} exact (booking_category, event_text) duplicates)`);
  }
  await upsertChunks(supabase, 'event_product_mapping', deduped, 'booking_category,event_text');
  console.log(`  wrote ${deduped.length} event_product_mapping rows`);
}

function validateMappingFkOrThrow(products, mapping) {
  const known = new Set(products.map(p => p.product_title));
  const orphans = mapping.filter(m => !known.has(m.canonical_product));
  if (orphans.length === 0) return;
  const sample = orphans.slice(0, 5).map(o => `  ${o.event_text} -> ${o.canonical_product}`).join('\n');
  throw new Error(`event_product_mapping has ${orphans.length} rows whose canonical_product is NOT in canonical_products. Sample:\n${sample}`);
}

// ----------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`load-canonical-products-and-mapping: dryRun=${dryRun}`);

  const productRows = readCsv(PRODUCTS_CSV).map(toCanonicalProductRow);
  const mappingRows = readCsv(MAPPING_CSV).map(toEventMappingRow);

  console.log(`canonical_products:    ${productRows.length} rows`);
  console.log(`  redemption rows:     ${productRows.filter(r => r.is_redemption).length}`);
  console.log(`  retired rows:        ${productRows.filter(r => r.is_retired).length}`);
  console.log(`event_product_mapping: ${mappingRows.length} rows`);
  const byConf = mappingRows.reduce((acc, r) => { acc[r.confidence || 'NULL'] = (acc[r.confidence || 'NULL'] || 0) + 1; return acc; }, {});
  console.log(`  confidence breakdown: ${JSON.stringify(byConf)}`);

  validateMappingFkOrThrow(productRows, mappingRows);
  console.log('FK check: every event_product_mapping.canonical_product exists in canonical_products');

  if (dryRun) {
    console.log('dry-run: no DB writes performed.');
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env.local');
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  await loadAll(supabase, productRows, mappingRows);
  console.log('done.');
}

main().catch(err => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
