/**
 * Apply v7 Pair-B Option A mentoring overrides + pages_master mirror.
 * Usage: node scripts/apply-v7-mentoring-overrides.mjs
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

const PROPERTY = 'https://www.alanranger.com';
const MENTOR_URL = 'https://alanranger.com/photography-mentoring-online-assignments';
const RPS_URL = 'https://alanranger.com/rps-courses-mentoring-distinctions';
const MENTOR_NOTE = 'Pair-B Option A — generic mentor terms belong here (Alan 2026-07-19)';
const RPS_NOTE = 'Pair-B Option A — rps-family only (Alan 2026-07-19)';

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

await upsertOverride(MENTOR_URL, 'photography mentoring', 'tracked', MENTOR_NOTE);
await mirrorPagesMaster('/photography-mentoring-online-assignments', 'photography mentoring', 'tracked', MENTOR_NOTE);

await upsertOverride(RPS_URL, 'rps courses', 'tracked', RPS_NOTE);
await mirrorPagesMaster('/rps-courses-mentoring-distinctions', 'rps courses', 'tracked', RPS_NOTE);

console.log(JSON.stringify({
  mentor: { url: MENTOR_URL, target_keyword: 'photography mentoring', target_class: 'tracked' },
  rps: { url: RPS_URL, target_keyword: 'rps courses', target_class: 'tracked' }
}, null, 2));
