/**
 * Load LOCKED v4 CSV (inbox → Drive → repo), rebuild JSON assets, persist to Supabase.
 * Usage: node scripts/load-keyword-v4-set.mjs
 */

import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  censusFromByKeyword,
  loadByKeywordFromCsv,
} from '../lib/keyword-ranking/locked-config-merge.js';
import {
  persistLockedToSupabase,
  writeLockedConfigFiles,
} from '../lib/keyword-ranking/locked-config-persist.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const inboxV4 = 'C:/Users/alan/Google Drive/Claude shared resources/Claude Questions for Cursor/keyword-tracking-locations-and-class-LOCKED-v4.csv';
const driveV4 = 'C:/Users/alan/Google Drive/Claude shared resources/07 Data & Exports/keyword-tracking-locations-and-class-LOCKED-v4.csv';
const repoV4 = join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v4.csv');

function resolveV4Path() {
  for (const p of [inboxV4, driveV4, repoV4]) {
    if (existsSync(p)) return p;
  }
  return null;
}

const v4Path = resolveV4Path();
if (!v4Path) {
  console.error('BLOCKED: keyword-tracking-locations-and-class-LOCKED-v4.csv not found in inbox, Drive, or repo.');
  process.exit(2);
}

const byKeyword = loadByKeywordFromCsv(v4Path);
const census = censusFromByKeyword(byKeyword);
const files = writeLockedConfigFiles(byKeyword, 'v4');
console.log('wrote', files.count, 'rows from', v4Path);
console.log('census', census);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (supabaseUrl && supabaseKey) {
  await persistLockedToSupabase({
    supabaseUrl,
    supabaseKey,
    propertyUrl: process.env.GSC_PROPERTY_URL || 'https://www.alanranger.com',
    byKeyword,
    census,
    sourceName: 'keyword-tracking-locations-and-class-LOCKED-v4.csv',
  });
  console.log('persisted keywordTrackingLocked to Supabase');
}

console.log('Next: deploy, hard-refresh dashboard, run one Ranking & AI check for new-term surface data.');
