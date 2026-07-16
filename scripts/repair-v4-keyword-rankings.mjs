// Align keyword_rankings with LOCKED-v4 on the latest ranked audit_date (2026-07-14).
// - delete empty stub rows on other dates
// - patch class/location on existing ranked rows
// - insert only the 22 new keywords into that audit_date

import { config as dotenvConfig } from 'dotenv';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { parseCsvLine } from '../lib/keyword-ranking/parse-tracking-csv.js';
import { resolveTrackedSegment } from '../lib/keyword-ranking/tracked-set-v3.js';

dotenvConfig({ path: '.env.local' });

const PROPERTY = 'https://www.alanranger.com';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const csv = readFileSync(join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v4.csv'), 'utf8');
const v4Rows = csv.trim().split(/\r?\n/).slice(1).map((line) => {
  const f = parseCsvLine(line);
  return {
    keyword: f[0],
    tracking_location: f[1],
    location_name_dfs: f[2],
    keyword_class: f[3],
    target_page: f[4],
  };
}).filter((r) => r.keyword);

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: rankedDates } = await sb
  .from('keyword_rankings')
  .select('audit_date')
  .eq('property_url', PROPERTY)
  .not('best_rank_absolute', 'is', null)
  .order('audit_date', { ascending: false })
  .limit(1);
const auditDate = rankedDates?.[0]?.audit_date || '2026-07-14';
console.log('Using ranked audit_date', auditDate);

// Delete empty stubs not on the ranked date
const { error: delErr, count: delCount } = await sb
  .from('keyword_rankings')
  .delete({ count: 'exact' })
  .eq('property_url', PROPERTY)
  .neq('audit_date', auditDate)
  .is('best_rank_absolute', null)
  .gte('audit_date', '2026-07-15');
if (delErr) throw delErr;
console.log('Deleted empty stubs', delCount);

const { data: existing, error: exErr } = await sb
  .from('keyword_rankings')
  .select('keyword')
  .eq('property_url', PROPERTY)
  .eq('audit_date', auditDate);
if (exErr) throw exErr;
const existingSet = new Set((existing || []).map((r) => r.keyword.toLowerCase()));

let patched = 0;
let inserted = 0;
for (const row of v4Rows) {
  const key = row.keyword.toLowerCase();
  const body = {
    keyword_class: row.keyword_class || null,
    class_unmapped: !row.keyword_class,
    location_name: row.location_name_dfs || null,
    location_unmapped: !row.location_name_dfs,
    segment: resolveTrackedSegment(row.keyword, row.keyword_class, null),
    segment_source: 'manual',
  };
  if (existingSet.has(key)) {
    const { error } = await sb
      .from('keyword_rankings')
      .update(body)
      .eq('property_url', PROPERTY)
      .eq('audit_date', auditDate)
      .eq('keyword', row.keyword);
    if (error) console.warn('patch fail', row.keyword, error.message);
    else patched += 1;
  } else {
    const { error } = await sb.from('keyword_rankings').insert({
      property_url: PROPERTY,
      audit_date: auditDate,
      keyword: row.keyword,
      ...body,
      page_type: 'Landing',
      best_rank_group: null,
      best_rank_absolute: null,
      best_url: null,
      best_title: row.keyword,
      search_volume: null,
      has_ai_overview: false,
      ai_total_citations: 0,
      ai_alan_citations_count: 0,
    });
    if (error) console.warn('insert fail', row.keyword, error.message);
    else inserted += 1;
  }
}

const { data: census } = await sb
  .from('keyword_rankings')
  .select('keyword_class')
  .eq('property_url', PROPERTY)
  .eq('audit_date', auditDate);

const counts = { brand: 0, 'local-money': 0, 'national-money': 0, other: 0 };
for (const r of census || []) {
  if (counts[r.keyword_class] != null) counts[r.keyword_class] += 1;
  else counts.other += 1;
}

console.log(JSON.stringify({
  auditDate,
  patched,
  inserted,
  total: (census || []).length,
  counts,
}, null, 2));
