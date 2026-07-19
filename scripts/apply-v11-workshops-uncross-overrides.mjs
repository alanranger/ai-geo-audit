/**
 * Apply v11 Ruling 3b workshops uncross overrides + pages_master mirror.
 * Usage: node scripts/apply-v11-workshops-uncross-overrides.mjs
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
const LANDSCAPE_URL = 'https://alanranger.com/landscape-photography-workshops';
const HUB_URL = 'https://alanranger.com/photography-workshops';
const LANDSCAPE_NOTE = "/landscape-photography-workshops = Half & One-Day workshops page; owns generic 'photography workshops' (480) + landscape + nature (Ruling 3b, Alan 2026-07-19)";
const HUB_NOTE = 'owns uk/near-me/one-day + macro (event-collection pointer shipped) — Ruling 3b Alan 2026-07-19';

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

const landscape = await readOverride(LANDSCAPE_URL);
const landscapeKw = String(landscape.target_keyword || '').trim() || 'landscape photography workshop';
await upsertOverride(LANDSCAPE_URL, landscapeKw, LANDSCAPE_NOTE);
await mirrorPagesMaster('/landscape-photography-workshops', landscapeKw, LANDSCAPE_NOTE);

const hubKw = 'photography workshops uk';
await upsertOverride(HUB_URL, hubKw, HUB_NOTE);
await mirrorPagesMaster('/photography-workshops', hubKw, HUB_NOTE);

await logMasterMutation(sb, {
  tableName: 'pages_master',
  scriptName: 'apply-v11-workshops-uncross-overrides.mjs',
  args: 'landscape+hub mirror',
  rowCount: 2,
  notes: 'Ruling 3b workshops uncross notes'
});

console.log(JSON.stringify({
  landscape: { url: LANDSCAPE_URL, target_keyword: landscapeKw, target_class: 'tracked' },
  hub: { url: HUB_URL, target_keyword: hubKw, target_class: 'tracked' }
}, null, 2));
