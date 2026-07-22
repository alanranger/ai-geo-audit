/**
 * MC-58: add evening photography classes + camera courses near me to LOCKED-151;
 * set /beginners-photography-classes to tracked + evening photography classes.
 * Usage: node scripts/apply-mc58-beginners-keywords.mjs
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import handler from '../api/keywords/save-csv.js';
import { readFileSync } from 'fs';
import { logMasterMutation } from '../lib/masterTableMutations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

const PROPERTY = 'https://www.alanranger.com';
const PAGE_URL = 'https://alanranger.com/beginners-photography-classes';
const PAGE_PATH = '/beginners-photography-classes';
const NOTE = "Retargeted 2026-07-22 (Alan) to 'evening photography classes' — winnable local/evening term; hub owns broad 'beginners photography classes'. camera courses near me = secondary, supported on-page.";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });
const now = new Date().toISOString();

async function loadLocked() {
  const csvPath = path.join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v11.csv');
  const csv = readFileSync(csvPath, 'utf8');
  const res = { headers: {}, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ method: 'POST', body: { csv, replaceAll: true, writeFiles: true, version: 'v11' } }, res);
  const out = res.body;
  if (res.statusCode >= 400 || out.status !== 'ok') throw new Error(out.message || 'save-csv failed');
  return out;
}

async function upsertOverride(page_url, target_keyword, target_class, notes) {
  const { error } = await sb.from('traditional_seo_target_keyword_overrides').upsert({
    property_url: PROPERTY,
    page_url,
    target_keyword,
    target_class,
    notes,
    updated_at: now,
  }, { onConflict: 'property_url,page_url' });
  if (error) throw error;
}

async function mirrorPagesMaster(pagePath, target_keyword, target_class, notes) {
  const { error } = await sb.from('pages_master').update({
    target_keyword,
    target_class,
    notes,
    updated_at: now,
  }).eq('property_url', PROPERTY).eq('path', pagePath);
  if (error) throw error;
}

const locked = await loadLocked();
await upsertOverride(PAGE_URL, 'evening photography classes', 'tracked', NOTE);
await mirrorPagesMaster(PAGE_PATH, 'evening photography classes', 'tracked', NOTE);
await logMasterMutation(sb, {
  tableName: 'pages_master',
  scriptName: 'apply-mc58-beginners-keywords.mjs',
  args: 'beginners-classes tracked retarget',
  rowCount: 1,
  notes: 'MC-58: evening photography classes tracked + LOCKED +155',
});

console.log(JSON.stringify({
  locked: { count: locked.count, added: locked.added, keywordRowsInserted: locked.keywordRowsInserted },
  page: { url: PAGE_URL, target_keyword: 'evening photography classes', target_class: 'tracked' },
}, null, 2));
