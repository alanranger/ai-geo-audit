import { config as dotenvConfig } from 'dotenv';
import {
  loadExistingLockedByKeyword,
  persistLockedToSupabase,
  writeLockedConfigFiles,
} from '../lib/keyword-ranking/locked-config-persist.js';
import { censusFromByKeyword } from '../lib/keyword-ranking/locked-config-merge.js';

dotenvConfig({ path: '.env.local' });

const byKeyword = loadExistingLockedByKeyword();
const census = censusFromByKeyword(byKeyword);
writeLockedConfigFiles(byKeyword, 'v4');
const result = await persistLockedToSupabase({
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  propertyUrl: 'https://www.alanranger.com',
  byKeyword,
  census,
  sourceName: 'keyword-tracking-locations-and-class-LOCKED-v4.csv',
});
console.log(JSON.stringify({ ok: true, census, persisted: result }, null, 2));
