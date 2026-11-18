/**
 * Export 09-url-target-keywords.csv from DB SoT via the shared builder (page_url order).
 * UTF-8 BOM for Excel. Writes shared-resources, config/, Drive outbox.
 *
 * Usage: node scripts/export-09-url-target-keywords.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { loadLocalSupabaseEnv, isLegacyJwt } from '../lib/load-local-supabase-env.mjs';
import { buildCsv09Body, loadLocked } from '../lib/configIntegrity/checks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = loadLocalSupabaseEnv(root);

const PROPERTY = 'https://www.alanranger.com';
const outRepo = path.join(root, '../alan-shared-resources/csv/09-url-target-keywords.csv');
const outAudit = path.join(root, 'config/09-url-target-keywords.csv');
const outDrive = path.join(
  'C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude/09-url-target-keywords.csv'
);

const supabaseUrl = env.url;
const supabaseKey = env.key;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (isLegacyJwt(supabaseKey)) {
  console.error('Legacy API keys are disabled. Use sb_secret from .env.vercel.prod (not the JWT in .env.local).');
  process.exit(1);
}

const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

async function fetchAll() {
  const out = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await sb
      .from('traditional_seo_target_keyword_overrides')
      .select('page_url, target_keyword, target_class, notes')
      .eq('property_url', PROPERTY)
      .order('page_url')
      .range(from, from + page - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < page) break;
    from += page;
  }
  return out;
}

const master = await fetchAll();
const body = buildCsv09Body(master, loadLocked());

const byClass = master.reduce((a, r) => {
  const c = r.target_class || 'null';
  a[c] = (a[c] || 0) + 1;
  return a;
}, {});

function writeRetry(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, p);
  } catch {
    fs.writeFileSync(p, content, 'utf8');
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

for (const p of [outRepo, outAudit, outDrive]) {
  try {
    writeRetry(p, body);
    console.log('wrote', p, master.length, 'rows');
  } catch (err) {
    console.warn('write failed', p, err.message);
  }
}
console.log('by target_class:', byClass);
