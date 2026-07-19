/**
 * Phase 4: backfill NULL target_class on traditional_seo_target_keyword_overrides.
 * tracked ⇔ keyword ∈ LOCKED AND page IS that keyword's LOCKED target_page;
 * else longtail_by_design.
 *
 * Usage: node scripts/phase4-backfill-blank-target-class.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { logMasterMutation } from '../lib/masterTableMutations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

const PROPERTY = 'https://www.alanranger.com';
const LOCKED = path.join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v8.csv');
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

function pathOnly(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s.startsWith('http') ? s : `https://www.alanranger.com${s.startsWith('/') ? s : `/${s}`}`);
    let p = (u.pathname || '/').replace(/\/{2,}/g, '/');
    if (p.length > 1) p = p.replace(/\/+$/, '');
    return p || '/';
  } catch {
    return s.startsWith('/') ? s.replace(/\/+$/, '') || '/' : '';
  }
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

/** keyword → LOCKED target_page path */
const lockedTargetByKw = new Map();
for (const r of parseCsv(fs.readFileSync(LOCKED, 'utf8'))) {
  const kw = normKw(r.keyword);
  const tp = pathOnly(r.target_page);
  if (kw && tp) lockedTargetByKw.set(kw, tp);
}

const { data: blanks, error } = await sb
  .from('traditional_seo_target_keyword_overrides')
  .select('page_url, target_keyword, notes')
  .eq('property_url', PROPERTY)
  .is('target_class', null);
if (error) throw error;

let tracked = 0;
let longtail = 0;
for (const row of blanks || []) {
  const kw = normKw(row.target_keyword);
  const pagePath = pathOnly(row.page_url);
  const lockedTarget = lockedTargetByKw.get(kw);
  const isTracked = Boolean(lockedTarget && pagePath === lockedTarget);
  const target_class = isTracked ? 'tracked' : 'longtail_by_design';
  if (isTracked) tracked += 1;
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

await sb
  .from('pages_master')
  .update({
    target_class: 'longtail_by_design',
    notes: HYGIENE_NOTE,
    updated_at: new Date().toISOString()
  })
  .eq('property_url', PROPERTY)
  .eq('path', '/property-photographer-coventry');

await logMasterMutation(sb, {
  tableName: 'pages_master',
  scriptName: 'phase4-backfill-blank-target-class.mjs',
  args: 'hygiene mirror property-photographer',
  rowCount: 1,
  notes: 'Mirrored longtail_by_design onto pages_master for property-photographer-coventry'
});
await logMasterMutation(sb, {
  tableName: 'traditional_seo_target_keyword_overrides',
  scriptName: 'phase4-backfill-blank-target-class.mjs',
  args: 'blank target_class backfill',
  rowCount: (blanks || []).length,
  notes: `tracked=${tracked} longtail=${longtail} (tracked ⇔ LOCKED target_page match)`
});

console.log(JSON.stringify({
  blank_rows_backfilled: (blanks || []).length,
  tracked,
  longtail_by_design: longtail,
  hygiene_property_photographer: 'longtail_by_design',
  rule: 'tracked iff keyword in LOCKED AND page_url path === LOCKED target_page'
}, null, 2));
