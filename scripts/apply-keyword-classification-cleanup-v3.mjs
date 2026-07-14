/**
 * Apply keyword classification cleanup v3 (2026-07-14).
 * Zero audit spend — updates config + Supabase metadata only.
 *
 * Usage: node scripts/apply-keyword-classification-cleanup-v3.mjs
 */

import dotenv from 'dotenv';
import { readFileSync, copyFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  REMOVED_FROM_TRACKING_EXACT,
  SEGMENT_OVERRIDES,
  filterTrackedKeywords,
  isTrackedKeyword,
} from '../lib/keyword-ranking/tracked-set-v3.js';
import { resolveKeywordClass } from '../lib/keyword-ranking/tracking-class.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(root, '.env.local') });
dotenv.config({ path: join(root, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const propertyUrl = 'https://www.alanranger.com';

const headers = {
  'Content-Type': 'application/json',
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
  Prefer: 'return=minimal',
};

async function sbGet(path) {
  const r = await fetch(`${supabaseUrl}${path}`, { headers: { ...headers, Prefer: 'return=representation' } });
  if (!r.ok) throw new Error(`GET ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function sbPatch(path, body) {
  const r = await fetch(`${supabaseUrl}${path}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PATCH ${path}: ${r.status} ${await r.text()}`);
}

async function main() {
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const driveDir = 'C:/Users/alan/Google Drive/Claude shared resources/07 Data & Exports';
  const repoCsv = join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v3.csv');
  mkdirSync(driveDir, { recursive: true });
  copyFileSync(repoCsv, join(driveDir, 'keyword-tracking-locations-and-class-LOCKED-v3.csv'));
  console.log('✓ Copied v3 CSV to Drive 07 Data & Exports');

  const latestDate = '2026-07-14';
  const rows = await sbGet(
    `/rest/v1/keyword_rankings?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.${latestDate}&select=id,keyword,segment,keyword_class`
  );
  console.log(`✓ Loaded ${rows.length} rows for ${latestDate}`);

  const tracked = filterTrackedKeywords(rows.map((r) => r.keyword));
  console.log(`✓ Tracked set: ${tracked.length} keywords (removed: ${REMOVED_FROM_TRACKING_EXACT.join(', ')})`);

  let segmentUpdates = 0;
  let classUpdates = 0;
  for (const row of rows) {
    if (!isTrackedKeyword(row.keyword)) continue;
    const key = String(row.keyword || '').trim().toLowerCase();
    const seg = SEGMENT_OVERRIDES[key];
    const clsInfo = resolveKeywordClass(row.keyword);
    const patch = {};
    if (seg && row.segment !== seg) {
      patch.segment = seg;
      patch.segment_source = 'manual';
      patch.segment_confidence = 1;
      patch.segment_reason = 'manual: Alan segment ruling 2026-07-14';
      segmentUpdates += 1;
    }
    if (clsInfo.keyword_class && row.keyword_class !== clsInfo.keyword_class) {
      patch.keyword_class = clsInfo.keyword_class;
      patch.class_unmapped = clsInfo.class_unmapped === true;
      classUpdates += 1;
    }
    if (Object.keys(patch).length) {
      await sbPatch(`/rest/v1/keyword_rankings?id=eq.${row.id}`, patch);
    }
  }
  console.log(`✓ Updated segments on ${segmentUpdates} rows, classes on ${classUpdates} rows`);

  const audits = await sbGet(
    `/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&order=audit_date.desc&limit=1&select=id,ranking_ai_data`
  );
  const audit = audits[0];
  if (!audit) throw new Error('No audit_results row found');

  const rankingAiData = audit.ranking_ai_data || {};
  rankingAiData.targetKeywords = tracked;
  rankingAiData.keywordsUpdated = new Date().toISOString();
  rankingAiData.trackedSetVersion = 3;
  rankingAiData.trackedSetChangeDate = '2026-07-14';
  if (rankingAiData.summary) {
    rankingAiData.summary.totalKeywords = tracked.length;
  }

  await sbPatch(`/rest/v1/audit_results?id=eq.${audit.id}`, { ranking_ai_data: rankingAiData });
  console.log(`✓ Saved targetKeywords (${tracked.length}) on latest audit_results`);

  const byClass = {};
  for (const kw of tracked) {
    const cls = resolveKeywordClass(kw).keyword_class;
    byClass[cls] = (byClass[cls] || 0) + 1;
  }
  console.log('Class census:', byClass);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
