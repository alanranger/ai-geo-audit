/**
 * Export 09-url-target-keywords.csv from DB SoT + LOCKED-v4.
 * UTF-8 BOM for Excel. Writes shared-resources, config/, Drive outbox.
 *
 * Usage: node scripts/export-09-url-target-keywords.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

const PROPERTY = 'https://www.alanranger.com';
const lockedPath = path.join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v4.csv');
const outRepo = path.join(root, '../alan-shared-resources/csv/09-url-target-keywords.csv');
const outAudit = path.join(root, 'config/09-url-target-keywords.csv');
const outDrive = path.join(
  'C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude/09-url-target-keywords.csv'
);

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { q = !q; continue; }
      if (c === ',' && !q) { cols.push(cur); cur = ''; continue; }
      cur += c;
    }
    cols.push(cur);
    const o = {};
    headers.forEach((h, i) => { o[h] = (cols[i] || '').trim(); });
    return o;
  });
}

function esc(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

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
const locked = parseCsv(fs.readFileSync(lockedPath, 'utf8'));
const lockedByKw = new Map();
for (const r of locked) {
  lockedByKw.set(String(r.keyword || '').toLowerCase(), r);
}

const header = [
  'url',
  'target_keyword',
  'target_class',
  'keyword_class',
  'tracked_in_151',
  'notes'
];
const lines = [header.join(',')];
for (const row of master) {
  const kw = String(row.target_keyword || '').trim();
  const hit = kw ? lockedByKw.get(kw.toLowerCase()) : null;
  lines.push(
    [
      esc(row.page_url),
      esc(kw),
      esc(row.target_class || ''),
      esc(hit?.class || ''),
      esc(hit ? 'Y' : 'N'),
      esc(row.notes || '')
    ].join(',')
  );
}
// UTF-8 BOM for Excel (avoids â€" / mojibake on Windows)
const body = `\uFEFF${lines.join('\n')}\n`;

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
