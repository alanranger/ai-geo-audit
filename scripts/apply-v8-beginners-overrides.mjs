/**
 * Apply v8 Ruling 1 Option A beginners overrides + pages_master mirror.
 * Usage: node scripts/apply-v8-beginners-overrides.mjs
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
const PAGE_URL = 'https://alanranger.com/beginners-photography-classes';
const NOTE = 'Ruling 1 Option 1 (Alan 2026-07-19) — conversion page fed internally by hub/free-course/blog; broad beginners terms accepted onto hub + free course';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });
const now = new Date().toISOString();

async function upsertOverride(page_url, target_keyword, target_class, notes) {
  const { error } = await sb.from('traditional_seo_target_keyword_overrides').upsert({
    property_url: PROPERTY,
    page_url,
    target_keyword,
    target_class,
    notes,
    updated_at: now
  }, { onConflict: 'property_url,page_url' });
  if (error) throw error;
}

async function mirrorPagesMaster(pagePath, target_keyword, target_class, notes) {
  const { error } = await sb.from('pages_master').update({
    target_keyword,
    target_class,
    notes,
    updated_at: now
  }).eq('property_url', PROPERTY).eq('path', pagePath);
  if (error) throw error;
}

await upsertOverride(PAGE_URL, 'beginning photography lessons', 'tracked', NOTE);
await mirrorPagesMaster('/beginners-photography-classes', 'beginning photography lessons', 'tracked', NOTE);

await logMasterMutation(sb, {
  tableName: 'pages_master',
  scriptName: 'apply-v8-beginners-overrides.mjs',
  args: 'beginners-classes mirror',
  rowCount: 1,
  notes: 'Mirrored Ruling 1 Option 1 target_keyword+class onto pages_master'
});

console.log(JSON.stringify({
  page: { url: PAGE_URL, target_keyword: 'beginning photography lessons', target_class: 'tracked' }
}, null, 2));
