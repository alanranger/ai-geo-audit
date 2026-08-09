/**
 * FIX: photography tuition off cannibal page → /private-photography-lessons
 * Usage: node scripts/apply-2026-08-10-fix-photography-tuition-target.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { assignIntegrityFindingIds } from '../lib/configIntegrity/findingIds.mjs';
import { logMasterMutation } from '../lib/masterTableMutations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

const PROPERTY = 'https://www.alanranger.com';
const KW = 'photography tuition';
const OLD_PATH = '/photography-tuition-services';
const NEW_PATH = '/private-photography-lessons';
const LOCKED = path.join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v11.csv');

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE env');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });
const now = new Date().toISOString();
const note =
  'Corrected 10 Aug — /photography-tuition-services is money_role=cannibal, repointed to /private-photography-lessons (commercial).';

function parseCsvLine(line) {
  const cols = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      q = !q;
      continue;
    }
    if (c === ',' && !q) {
      cols.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  cols.push(cur);
  return cols;
}

function escCsv(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function pathOnly(raw) {
  try {
    if (/^https?:\/\//i.test(raw)) {
      let p = (new URL(raw).pathname || '/').toLowerCase();
      if (p.length > 1) p = p.replace(/\/+$/, '');
      return p || '/';
    }
  } catch {
    /* ignore */
  }
  let p = String(raw || '')
    .toLowerCase()
    .split(/[?#]/)[0] || '/';
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p || '/';
}

function updateLockedCsv() {
  const raw = fs.readFileSync(LOCKED, 'utf8');
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const ki = header.indexOf('keyword');
  const ti = header.indexOf('target_page');
  let hit = null;
  const out = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCsvLine(lines[i]);
    const kw = String(cols[ki] || '')
      .trim()
      .toLowerCase();
    if (kw === KW) {
      hit = { before: String(cols[ti] || '').trim(), after: NEW_PATH };
      cols[ti] = NEW_PATH;
    }
    out.push(cols.map(escCsv).join(','));
  }
  if (!hit) throw new Error('LOCKED missing: ' + KW);
  fs.writeFileSync(LOCKED, out.join('\n') + '\n', 'utf8');
  return hit;
}

function cannId(assigned, preferred) {
  const [row] = assignIntegrityFindingIds([
    {
      check: 3,
      subject: KW,
      preferred_path: preferred || '',
      assigned_path: assigned,
      detail: `Google prefers ${preferred || '?'}; assigned page ${assigned}`
    }
  ]);
  return row.findingId;
}

const lockedReport = updateLockedCsv();

// Clear primary claim on cannibal page(s) where this keyword is still primary
const { data: allOw, error: owErr } = await sb
  .from('traditional_seo_target_keyword_overrides')
  .select('id, page_url, target_keyword, target_class, notes')
  .eq('property_url', PROPERTY);
if (owErr) throw owErr;

const cleared = [];
for (const row of allOw || []) {
  const kw = String(row.target_keyword || '')
    .trim()
    .toLowerCase();
  if (kw !== KW) continue;
  const p = pathOnly(row.page_url);
  if (p === NEW_PATH) continue;
  const { error: uErr } = await sb
    .from('traditional_seo_target_keyword_overrides')
    .update({
      target_keyword: '',
      target_class: 'longtail_by_design',
      notes: note,
      updated_at: now
    })
    .eq('id', row.id);
  if (uErr) throw uErr;
  cleared.push({ page_url: row.page_url, from: p });
}

// Ensure target page claims this keyword (page-primary for check-6 export)
const pageUrlCandidates = [
  `https://alanranger.com${NEW_PATH}`,
  `https://www.alanranger.com${NEW_PATH}`
];
let targetRow = (allOw || []).find((r) => pathOnly(r.page_url) === NEW_PATH);
if (targetRow) {
  const { error: uErr } = await sb
    .from('traditional_seo_target_keyword_overrides')
    .update({
      target_keyword: KW,
      target_class: 'tracked',
      notes:
        note +
        ' Prior primary was photography tutor (Option C); tuition is the accepted money term (Alan 10 Aug FIX).',
      updated_at: now
    })
    .eq('id', targetRow.id);
  if (uErr) throw uErr;
} else {
  const { error: iErr } = await sb.from('traditional_seo_target_keyword_overrides').insert({
    property_url: PROPERTY,
    page_url: pageUrlCandidates[0],
    target_keyword: KW,
    target_class: 'tracked',
    notes: note,
    updated_at: now
  });
  if (iErr) throw iErr;
}

// Prefer preferred from latest integrity findings (check 3 if present)
const { data: run } = await sb
  .from('config_integrity_runs')
  .select('findings')
  .eq('property_url', PROPERTY)
  .order('run_at', { ascending: false })
  .limit(1)
  .maybeSingle();
let preferred = NEW_PATH;
for (const f of Array.isArray(run?.findings) ? run.findings : []) {
  if (Number(f.check) !== 3) continue;
  if (
    String(f.subject || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim() !== KW
  )
    continue;
  preferred = String(f.preferred_path || preferred).trim() || preferred;
  break;
}

const newKey = cannId(NEW_PATH, preferred);
const oldKey = cannId(OLD_PATH, preferred);

const stateRows = [
  {
    finding_key: newKey,
    property_url: PROPERTY,
    progress: 'in_progress',
    decision_type: 'accept',
    note,
    worked_at: now,
    updated_at: now,
    last_seen_at: now,
    cleared_at: null
  },
  {
    finding_key: oldKey,
    property_url: PROPERTY,
    progress: 'done',
    decision_type: 'accept',
    note: `Superseded by retarget → ${NEW_PATH} (${newKey}). ${note}`,
    worked_at: now,
    updated_at: now,
    last_seen_at: now,
    cleared_at: now
  }
];

const { error: stErr } = await sb.from('config_integrity_finding_state').upsert(stateRows, {
  onConflict: 'finding_key'
});
if (stErr) throw stErr;

await logMasterMutation(sb, {
  tableName: 'traditional_seo_target_keyword_overrides',
  scriptName: 'apply-2026-08-10-fix-photography-tuition-target.mjs',
  args: `${KW} → ${NEW_PATH}`,
  rowCount: cleared.length + 1,
  notes: note
});

console.log(
  JSON.stringify(
    {
      lockedReport,
      cleared,
      finding: { oldKey, newKey, preferred },
      stateUpserts: stateRows.length
    },
    null,
    2
  )
);
