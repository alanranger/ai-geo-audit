/**
 * LOCKED v14 follow-up: mirror Alan's current Traditional SEO override for
 * /free-online-photography-course (set by Alan 2026-10-26 → "online photography course")
 * into pages_master, so integrity check 2 stops reading the old "free online photography
 * course" target (now owned by the best-free-online-photography-courses blog in LOCKED v14).
 * Reads the override; never writes it.
 * Usage: node scripts/apply-v14-mirror-free-course-pages-master.mjs
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { logMasterMutation } from '../lib/masterTableMutations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

const PROPERTY = 'https://www.alanranger.com';
const PAGE_URL = 'https://www.alanranger.com/free-online-photography-course';
const PAGE_PATH = '/free-online-photography-course';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const { data: ov, error: ovErr } = await sb
  .from('traditional_seo_target_keyword_overrides')
  .select('target_keyword, target_class')
  .eq('property_url', PROPERTY)
  .eq('page_url', PAGE_URL)
  .maybeSingle();
if (ovErr) throw ovErr;
const targetKeyword = String(ov?.target_keyword || '').trim();
if (!targetKeyword) {
  console.error('No override found for the free course page — nothing to mirror.');
  process.exit(1);
}

const { data: before, error: pmErr } = await sb
  .from('pages_master')
  .select('path, target_keyword, target_class')
  .eq('property_url', PROPERTY)
  .eq('path', PAGE_PATH)
  .maybeSingle();
if (pmErr) throw pmErr;

const { error: upErr } = await sb.from('pages_master').update({
  target_keyword: targetKeyword,
  target_class: ov.target_class || 'tracked',
  updated_at: new Date().toISOString()
}).eq('property_url', PROPERTY).eq('path', PAGE_PATH);
if (upErr) throw upErr;

await logMasterMutation(sb, {
  tableName: 'pages_master',
  scriptName: 'apply-v14-mirror-free-course-pages-master.mjs',
  args: PAGE_PATH,
  rowCount: 1,
  notes: `LOCKED v14: mirror override "${targetKeyword}" (was "${before?.target_keyword || ''}")`
});

console.log(JSON.stringify({
  path: PAGE_PATH,
  before: before && { target_keyword: before.target_keyword, target_class: before.target_class },
  after: { target_keyword: targetKeyword, target_class: ov.target_class || 'tracked' }
}, null, 2));
