/**
 * Add tracked money-page keywords missing from Ranking & AI. Writes LOCKED v15 files.
 * Usage: node scripts/sync-tracked-page-keywords-now.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { loadLocalSupabaseEnv, isLegacyJwt } from '../lib/load-local-supabase-env.mjs';
import { syncTrackedPageKeywords } from '../lib/keyword-ranking/sync-tracked-page-keywords.mjs';

const env = loadLocalSupabaseEnv();
if (!env.url || !env.key || isLegacyJwt(env.key)) {
  console.error('Need sb_secret from .env.vercel.prod');
  process.exit(1);
}
const PROPERTY = 'https://www.alanranger.com';
const sb = createClient(env.url, env.key, { auth: { persistSession: false } });
const { data, error } = await sb
  .from('traditional_seo_target_keyword_overrides')
  .select('page_url, target_keyword, target_class')
  .eq('property_url', PROPERTY);
if (error) throw error;
const out = await syncTrackedPageKeywords({
  overrides: data || [],
  previousByPage: new Map(),
  propertyUrl: PROPERTY,
  writeFiles: true,
  supabaseUrl: env.url,
  supabaseKey: env.key,
});
console.log(JSON.stringify(out, null, 2));
