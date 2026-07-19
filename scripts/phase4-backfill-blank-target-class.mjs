/**
 * Phase 4: backfill NULL target_class on traditional_seo_target_keyword_overrides.
 * tracked if keyword ∈ LOCKED-151 else longtail_by_design.
 *
 * Usage: node scripts/phase4-backfill-blank-target-class.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

const PROPERTY = 'https://www.alanranger.com';
const LOCKED = path.join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v4.csv');
const NOTE = 'backfilled P4 2026-07-19';
const HYGIENE_NOTE =
  'P4 hygiene 2026-07-19: longtail_by_design — keyword not in LOCKED-151; review with portrait photography course + residential photography workshops at next keyword-set review';

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
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
    const o = {};
    headers.forEach((h, i) => { o[h] = (cols[i] || '').trim(); });
    return o;
  });
}

function normKw(kw) {
  return String(kw || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const locked = new Set(
  parseCsv(fs.readFileSync(LOCKED, 'utf8')).map((r) => normKw(r.keyword)).filter(Boolean)
);

const { data: blanks, error } = await sb
  .from('traditional_seo_target_keyword_overrides')
  .select('page_url, target_keyword, notes')
  .eq('property_url', PROPERTY)
  .is('target_class', null);
if (error) throw error;

let tracked = 0;
let longtail = 0;
for (const row of blanks || []) {
  const kw = String(row.target_keyword || '').trim();
  const inLocked = locked.has(normKw(kw));
  const target_class = inLocked ? 'tracked' : 'longtail_by_design';
  if (inLocked) tracked += 1;
  else longtail += 1;
  const prev = String(row.notes || '').trim();
  const notes = prev.includes(NOTE) ? prev : (prev ? `${prev}; ${NOTE}` : NOTE);
  const { error: upErr } = await sb
    .from('traditional_seo_target_keyword_overrides')
    .update({ target_class, notes })
    .eq('property_url', PROPERTY)
    .eq('page_url', row.page_url);
  if (upErr) throw upErr;
}

// Hygiene: property-photographer-coventry → longtail_by_design
const propUrl = 'https://alanranger.com/property-photographer-coventry';
const { data: propRow } = await sb
  .from('traditional_seo_target_keyword_overrides')
  .select('notes')
  .eq('property_url', PROPERTY)
  .eq('page_url', propUrl)
  .maybeSingle();
const propNotes = String(propRow?.notes || '').trim();
const { error: hygErr } = await sb
  .from('traditional_seo_target_keyword_overrides')
  .update({
    target_class: 'longtail_by_design',
    notes: propNotes.includes('P4 hygiene') ? propNotes : (propNotes ? `${propNotes}; ${HYGIENE_NOTE}` : HYGIENE_NOTE)
  })
  .eq('property_url', PROPERTY)
  .eq('page_url', propUrl);
if (hygErr) throw hygErr;

// Mirror hygiene onto pages_master if present
await sb
  .from('pages_master')
  .update({
    target_class: 'longtail_by_design',
    notes: HYGIENE_NOTE,
    updated_at: new Date().toISOString()
  })
  .eq('property_url', PROPERTY)
  .eq('path', '/property-photographer-coventry');

console.log(JSON.stringify({
  blank_rows_backfilled: (blanks || []).length,
  tracked,
  longtail_by_design: longtail,
  hygiene_property_photographer: 'longtail_by_design'
}, null, 2));
