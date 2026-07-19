/**
 * Apply v9 Ruling 2 editing + online-lessons overrides + pages_master mirror.
 * Usage: node scripts/apply-v9-editing-online-overrides.mjs
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
const EDIT_URL = 'https://alanranger.com/photo-editing-course-coventry';
const ONLINE_URL = 'https://alanranger.com/photography-lessons-online-121';
const EDIT_NOTE = 'Ruling 2 (Alan 2026-07-19) — lightroom courses coventry accepted onto hub; page fights on lightroom courses + lightroom editing course';
const ONLINE_NOTE = 'FIGHT ruled by Alan 2026-07-19 — protected revenue stream; do not remap online-lesson terms to free-course. Support work shipped: sitewide nav exact-anchor rename, blog CTA (learn-photography-online-photography-classes), product→landing pointer, hub/academy/tuition-services links.';

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

await upsertOverride(EDIT_URL, 'lightroom courses', 'tracked', EDIT_NOTE);
await mirrorPagesMaster('/photo-editing-course-coventry', 'lightroom courses', 'tracked', EDIT_NOTE);

await upsertOverride(ONLINE_URL, 'photography lessons online', 'tracked', ONLINE_NOTE);
await mirrorPagesMaster('/photography-lessons-online-121', 'photography lessons online', 'tracked', ONLINE_NOTE);

await logMasterMutation(sb, {
  tableName: 'pages_master',
  scriptName: 'apply-v9-editing-online-overrides.mjs',
  args: 'editing+online mirror',
  rowCount: 2,
  notes: 'Mirrored Ruling 2 target_keyword+class onto pages_master'
});

console.log(JSON.stringify({
  editing: { url: EDIT_URL, target_keyword: 'lightroom courses', target_class: 'tracked' },
  online: { url: ONLINE_URL, target_keyword: 'photography lessons online', target_class: 'tracked' }
}, null, 2));
