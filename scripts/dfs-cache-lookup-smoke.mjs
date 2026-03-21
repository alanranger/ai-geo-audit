/**
 * Optional live check: query dfs_page_backlinks_cache using the same URL variants as the API.
 *
 * Usage (repo root, .env with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY):
 *   node scripts/dfs-cache-lookup-smoke.mjs "https://www.alanranger.com/some-path"
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  normalizeDfsPageUrl,
  expandUrlListForBacklinkCacheQuery
} from '../lib/dfs-page-url-keys.js';

const arg = process.argv[2] || 'https://www.alanranger.com/';
const supabaseUrl = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !key) {
  console.error('Skip: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env for this smoke test.');
  process.exit(0);
}

const canon = normalizeDfsPageUrl(arg);
const variants = expandUrlListForBacklinkCacheQuery([canon]);
const supabase = createClient(supabaseUrl, key);
const { data, error } = await supabase
  .from('dfs_page_backlinks_cache')
  .select('page_url,row_count,fetched_at')
  .in('page_url', variants)
  .limit(10);

if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(JSON.stringify({ input: arg, canonical: canon, queryVariants: variants, rowCount: data?.length || 0, rows: data }, null, 2));
