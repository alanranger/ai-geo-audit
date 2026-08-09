/**
 * BATCH2 panel reassignments + keep-specialist decision_type records.
 * Usage: node scripts/apply-2026-08-10-batch2-panel-decisions.mjs
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
const LOCKED = path.join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v11.csv');

const REASSIGNS = [
  { keyword: 'beginner photography classes', target: '/beginners-photography-classes', vol: 720, rank: 3 },
  { keyword: 'photography workshops', target: '/photography-workshops', vol: 480, rank: 24 },
  { keyword: 'beginning photography lessons', target: '/photography-courses-coventry', vol: 170, rank: 5 },
  { keyword: 'photographer coventry', target: '/hire-a-professional-photographer-in-coventry', vol: 170, rank: 25 },
  { keyword: 'camera courses near me', target: '/photography-courses-coventry', vol: 90, rank: 2 },
  { keyword: 'photography courses gloucestershire', target: '/batsford-arboretum-photography', vol: 50, rank: 4 },
  { keyword: 'photography tuition', target: '/photography-tuition-services', vol: 30, rank: 4 },
  { keyword: 'photography workshops coventry', target: '/photography-courses-coventry', vol: 10, rank: 3 },
  { keyword: 'professional photographer coventry', target: '/hire-a-professional-photographer-in-coventry', vol: 10, rank: 5 },
  { keyword: 'beginners photography lessons coventry', target: '/photography-courses-coventry', vol: 2, rank: 2 }
];

const KEEPS = [
  {
    keyword: 'free photography classes near me',
    target: '/free-online-photography-course',
    note: '"free" intent; keep free course over hub. Alan 10 Aug.'
  },
  {
    keyword: 'photography vouchers',
    target: '/photography-gift-vouchers',
    note: 'Same commercial intent as near-me path — keep clean vouchers URL. Alan 10 Aug.'
  },
  {
    keyword: 'photography gift card',
    target: '/photography-gift-vouchers',
    note: 'False conflict risk path form vs near-me URL; keep clean vouchers URL. Alan 10 Aug.'
  },
  {
    keyword: 'photography courses solihull',
    target: '/photography-courses-coventry',
    note: "Don't chase a Solihull event page; keep stable hub. Alan 10 Aug."
  }
];

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE env');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });
const now = new Date().toISOString();

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

function updateLockedCsv() {
  const raw = fs.readFileSync(LOCKED, 'utf8');
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const ki = header.indexOf('keyword');
  const ti = header.indexOf('target_page');
  const want = new Map(REASSIGNS.map((r) => [r.keyword.toLowerCase(), r.target]));
  const report = [];
  const out = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseCsvLine(lines[i]);
    const kw = String(cols[ki] || '').trim();
    const nkw = kw.toLowerCase();
    if (want.has(nkw)) {
      const before = String(cols[ti] || '').trim();
      const after = want.get(nkw);
      cols[ti] = after;
      report.push({ keyword: kw, before, after, changed: before !== after });
      want.delete(nkw);
    }
    out.push(cols.map(escCsv).join(','));
  }
  if (want.size) throw new Error('LOCKED missing: ' + [...want.keys()].join(', '));
  fs.writeFileSync(LOCKED, out.join('\n') + '\n', 'utf8');
  return report;
}

function pathOnly(raw) {
  try {
    if (/^https?:\/\//i.test(raw)) {
      let p = (new URL(raw).pathname || '/').toLowerCase();
      if (p.length > 1) p = p.replace(/\/+$/, '');
      return p || '/';
    }
  } catch { /* ignore */ }
  let p = String(raw || '').toLowerCase().split(/[?#]/)[0] || '/';
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p || '/';
}

async function clearWrongClaims() {
  const targets = new Map(REASSIGNS.map((r) => [r.keyword.toLowerCase(), r.target]));
  const { data, error } = await sb
    .from('traditional_seo_target_keyword_overrides')
    .select('id, page_url, target_keyword, target_class')
    .eq('property_url', PROPERTY);
  if (error) throw error;
  const cleared = [];
  for (const row of data || []) {
    const kw = String(row.target_keyword || '').trim().toLowerCase();
    if (!targets.has(kw)) continue;
    const want = targets.get(kw);
    const p = pathOnly(row.page_url);
    if (p === want) continue;
    const { error: uErr } = await sb
      .from('traditional_seo_target_keyword_overrides')
      .update({
        target_keyword: '',
        target_class:
          String(row.target_class || '').toLowerCase() === 'tracked'
            ? 'longtail_by_design'
            : row.target_class || 'legacy_unreviewed',
        notes: 'Cleared primary; LOCKED retarget BATCH2 panel 10 Aug (accept).',
        updated_at: now
      })
      .eq('id', row.id);
    if (uErr) throw uErr;
    cleared.push({ page_url: row.page_url, kw, want });
  }
  return cleared;
}

function cannId(keyword, assigned, preferred) {
  const [row] = assignIntegrityFindingIds([
    {
      check: 3,
      subject: keyword,
      preferred_path: preferred || '',
      assigned_path: assigned,
      detail: `Google prefers ${preferred || '?'}; assigned page ${assigned}`
    }
  ]);
  return row.findingId;
}

const lockedReport = updateLockedCsv();
const cleared = await clearWrongClaims();

// Prefer preferred paths from latest integrity run for notes
const { data: run } = await sb
  .from('config_integrity_runs')
  .select('findings')
  .eq('property_url', PROPERTY)
  .order('run_at', { ascending: false })
  .limit(1)
  .maybeSingle();
const findings = Array.isArray(run?.findings) ? run.findings : [];
const prefByKw = new Map();
const oldAssignedByKw = new Map();
for (const f of findings) {
  if (Number(f.check) !== 3) continue;
  const k = String(f.subject || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!prefByKw.has(k)) {
    prefByKw.set(k, String(f.preferred_path || '').trim());
    oldAssignedByKw.set(k, String(f.assigned_path || '').trim());
  }
}

const stateRows = [];
const idMap = { accepts: [], keeps: [] };

for (const r of REASSIGNS) {
  const nk = r.keyword.toLowerCase();
  const preferred = prefByKw.get(nk) || '';
  const oldAssigned = oldAssignedByKw.get(nk) || '';
  const finding_key = cannId(r.keyword, r.target, preferred);
  const oldKey = oldAssigned ? cannId(r.keyword, oldAssigned, preferred) : null;
  const note = `Accepted per Alan 10 Aug — vol ${r.vol}/rank ~${r.rank}; LOCKED → ${r.target}` +
    (oldKey && oldKey !== finding_key ? ` (id ${oldKey}→${finding_key})` : '');
  stateRows.push({
    finding_key,
    property_url: PROPERTY,
    progress: 'in_progress',
    decision_type: 'accept',
    note,
    worked_at: now,
    updated_at: now,
    last_seen_at: now,
    cleared_at: null
  });
  // Also mark old CANN id done so UI leftover doesn’t stick Decision needed
  if (oldKey && oldKey !== finding_key) {
    stateRows.push({
      finding_key: oldKey,
      property_url: PROPERTY,
      progress: 'done',
      decision_type: 'accept',
      note: `Superseded by retarget → ${r.target} (${finding_key}). Alan 10 Aug BATCH2.`,
      worked_at: now,
      updated_at: now,
      last_seen_at: now,
      cleared_at: now
    });
  }
  idMap.accepts.push({
    keyword: r.keyword,
    target: r.target,
    finding_key,
    oldKey,
    preferred,
    oldAssigned
  });
}

for (const r of KEEPS) {
  const nk = r.keyword.toLowerCase();
  const preferred = prefByKw.get(nk) || '';
  const finding_key = cannId(r.keyword, r.target, preferred);
  stateRows.push({
    finding_key,
    property_url: PROPERTY,
    progress: 'in_progress',
    decision_type: 'keep_specialist',
    note: r.note,
    worked_at: now,
    updated_at: now,
    last_seen_at: now,
    cleared_at: null
  });
  idMap.keeps.push({ keyword: r.keyword, target: r.target, finding_key, preferred });
}

const { error: stErr } = await sb.from('config_integrity_finding_state').upsert(stateRows, {
  onConflict: 'finding_key'
});
if (stErr) throw stErr;

await logMasterMutation(sb, {
  tableName: 'config_integrity_finding_state',
  scriptName: 'apply-2026-08-10-batch2-panel-decisions.mjs',
  args: 'BATCH2 panel 10 accept + 4 keep',
  rowCount: stateRows.length,
  notes: 'Alan 10 Aug panel Decision-needed batch'
});

console.log(
  JSON.stringify(
    {
      lockedReport,
      wrongClaimsCleared: cleared.length,
      stateUpserts: stateRows.length,
      idMap
    },
    null,
    2
  )
);
