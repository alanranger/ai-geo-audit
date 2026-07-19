/**
 * Apply v10 Ruling 3a photographer uncross overrides + pages_master mirror.
 * Usage: node scripts/apply-v10-photographer-uncross-overrides.mjs
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
const HIRE_URL = 'https://alanranger.com/hire-a-professional-photographer-in-coventry';
const NEAR_URL = 'https://alanranger.com/professional-photographer-near-me';
const NOTE = 'Ruling 3a uncross (Alan 2026-07-19) — hire hub owns general/local photographer terms; near-me URL page is the Headshots & Portraits specialist and owns portrait/freelance/for-hire terms';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });
const now = new Date().toISOString();

async function readOverride(page_url) {
  const { data, error } = await sb
    .from('traditional_seo_target_keyword_overrides')
    .select('target_keyword, notes')
    .eq('property_url', PROPERTY)
    .eq('page_url', page_url)
    .maybeSingle();
  if (error) throw error;
  return data || {};
}

async function upsertOverride(page_url, target_keyword, notes) {
  const { error } = await sb.from('traditional_seo_target_keyword_overrides').upsert({
    property_url: PROPERTY,
    page_url,
    target_keyword,
    target_class: 'tracked',
    notes,
    updated_at: now
  }, { onConflict: 'property_url,page_url' });
  if (error) throw error;
}

async function mirrorPagesMaster(pagePath, target_keyword, notes) {
  const { error } = await sb.from('pages_master').update({
    target_keyword,
    target_class: 'tracked',
    notes,
    updated_at: now
  }).eq('property_url', PROPERTY).eq('path', pagePath);
  if (error) throw error;
}

const hire = await readOverride(HIRE_URL);
const hireKw = String(hire.target_keyword || '').trim() || 'hire a professional photographer';
await upsertOverride(HIRE_URL, hireKw, NOTE);
await mirrorPagesMaster('/hire-a-professional-photographer-in-coventry', hireKw, NOTE);

await upsertOverride(NEAR_URL, 'portrait photographer', NOTE);
await mirrorPagesMaster('/professional-photographer-near-me', 'portrait photographer', NOTE);

await logMasterMutation(sb, {
  tableName: 'pages_master',
  scriptName: 'apply-v10-photographer-uncross-overrides.mjs',
  args: 'hire+near-me mirror',
  rowCount: 2,
  notes: 'Ruling 3a uncross notes + near-me primary → portrait photographer'
});

console.log(JSON.stringify({
  hire: { url: HIRE_URL, target_keyword: hireKw, target_class: 'tracked' },
  near_me: { url: NEAR_URL, target_keyword: 'portrait photographer', target_class: 'tracked' }
}, null, 2));
