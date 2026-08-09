/**
 * Apply 2026-08-10 cannibal reassignments + camera-courses dedupe.
 * - LOCKED-v11 target_page updates (where not already correct)
 * - Clear multi-event override spam for camera courses for beginners
 * - Point food photography LOCKED to blog Alan chose
 * - pages_master mirror for cleared event keyword rows
 * - Export 09 CSV once
 *
 * Usage: node scripts/apply-2026-08-10-cannibal-reassign-batch.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { logMasterMutation } from '../lib/masterTableMutations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

const PROPERTY = 'https://www.alanranger.com';
const LOCKED = path.join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v11.csv');
const NOTE = 'Reassigned per Alan 10 Aug — accept ranked/correct page (cannibal batch).';
const CAMERA_NOTE =
  'Deduped event-instance primary-keyword spam → hub. Cleared 2026-08-10 per Alan.';

const LOCKED_REASSIGNS = [
  { keyword: 'beginners photography course', target: '/photography-courses-coventry' },
  { keyword: 'photo workshops', target: '/photography-workshops' },
  { keyword: 'alan ranger', target: '/' },
  { keyword: 'landscape photography workshops', target: '/landscape-photography-workshops' },
  { keyword: 'rps distinctions', target: '/rps-courses-mentoring-distinctions' },
  { keyword: 'online photography classes', target: '/free-online-photography-course' },
  { keyword: 'food photography', target: '/blog-on-photography/food-photography-tips' },
  { keyword: 'photo editing classes', target: '/photo-editing-course-coventry' },
  { keyword: 'corporate photography training', target: '/corporate-photography-training' },
  { keyword: 'photographic workshops', target: '/photography-workshops' },
  { keyword: 'camera courses for beginners', target: '/photography-courses-coventry' }
];

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
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
  if (ki < 0 || ti < 0) throw new Error('LOCKED CSV missing keyword/target_page columns');

  const want = new Map(
    LOCKED_REASSIGNS.map((r) => [r.keyword.toLowerCase(), r.target])
  );
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
      if (before !== after) {
        cols[ti] = after;
        report.push({ keyword: kw, before, after, changed: true });
      } else {
        report.push({ keyword: kw, before, after, changed: false });
      }
      want.delete(nkw);
    }
    out.push(cols.map(escCsv).join(','));
  }
  const missing = [...want.entries()];
  if (missing.length) {
    throw new Error('LOCKED missing keywords: ' + missing.map((x) => x[0]).join(', '));
  }
  fs.writeFileSync(LOCKED, out.join('\n') + '\n', 'utf8');
  return report;
}

async function clearCameraEventOverrides() {
  const { data, error } = await sb
    .from('traditional_seo_target_keyword_overrides')
    .select('id, page_url, target_keyword, target_class')
    .eq('property_url', PROPERTY)
    .ilike('target_keyword', 'camera courses for beginners');
  if (error) throw error;
  const rows = data || [];
  const cleared = [];
  for (const row of rows) {
    const { error: uErr } = await sb
      .from('traditional_seo_target_keyword_overrides')
      .update({
        target_keyword: '',
        target_class: 'none_utility',
        notes: CAMERA_NOTE,
        updated_at: now
      })
      .eq('id', row.id);
    if (uErr) throw uErr;
    cleared.push(row.page_url);
    // mirror pages_master path
    try {
      const u = new URL(row.page_url);
      const p =
        u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '').toLowerCase() : u.pathname;
      await sb
        .from('pages_master')
        .update({
          target_keyword: '',
          target_class: 'none_utility',
          notes: CAMERA_NOTE,
          updated_at: now
        })
        .eq('property_url', PROPERTY)
        .eq('path', p);
    } catch {
      /* ignore mirror fail */
    }
  }
  return { count: cleared.length, urls: cleared };
}

/**
 * Clear stale page→keyword claims for reassigned keywords where the page path
 * is NOT the new LOCKED target (legacy event/subpage primaries).
 */
async function clearWrongPageClaims() {
  const targets = new Map(
    LOCKED_REASSIGNS.map((r) => [r.keyword.toLowerCase(), r.target])
  );
  const { data, error } = await sb
    .from('traditional_seo_target_keyword_overrides')
    .select('id, page_url, target_keyword, target_class')
    .eq('property_url', PROPERTY);
  if (error) throw error;

  const pathOnly = (raw) => {
    try {
      if (/^https?:\/\//i.test(raw)) {
        const u = new URL(raw);
        let p = (u.pathname || '/').toLowerCase();
        if (p.length > 1) p = p.replace(/\/+$/, '');
        return p || '/';
      }
    } catch {
      /* fall through */
    }
    let p = String(raw || '').toLowerCase().split(/[?#]/)[0] || '/';
    if (p.length > 1) p = p.replace(/\/+$/, '');
    return p || '/';
  };

  const updates = [];
  for (const row of data || []) {
    const kw = String(row.target_keyword || '').trim().toLowerCase();
    if (!targets.has(kw)) continue;
    // skip camera — handled above
    if (kw === 'camera courses for beginners') continue;
    const want = targets.get(kw);
    const p = pathOnly(row.page_url);
    if (p === want) continue;
    // Don't strip hub primary that is a DIFFERENT keyword mapping? These have the exact keyword.
    // Food: clear commercial page if it still has food photography? commercial has commercial photographer now OK
    // Clear only if keyword matches the reassigned one exactly.
    const { error: uErr } = await sb
      .from('traditional_seo_target_keyword_overrides')
      .update({
        target_keyword: '',
        target_class:
          String(row.target_class || '').toLowerCase() === 'tracked'
            ? 'longtail_by_design'
            : row.target_class || 'legacy_unreviewed',
        notes: NOTE,
        updated_at: now
      })
      .eq('id', row.id);
    if (uErr) throw uErr;
    updates.push({ page_url: row.page_url, cleared_keyword: row.target_keyword, want });
  }
  return updates;
}

/**
 * Ensure commercial/money page has a useful primary where appropriate.
 * Do not overwrite hub primaries for multi-keyword hubs.
 */
async function ensureTargetOverrides() {
  // food photography: set blog tip page primary
  const foodUrl = 'https://www.alanranger.com/blog-on-photography/food-photography-tips';
  await sb.from('traditional_seo_target_keyword_overrides').upsert(
    {
      property_url: PROPERTY,
      page_url: foodUrl,
      target_keyword: 'food photography',
      target_class: 'longtail_by_design',
      notes: NOTE + ' LOCKED money-for-this-term is this blog (Alan accept ranked page).',
      updated_at: now
    },
    { onConflict: 'property_url,page_url' }
  );
  await sb
    .from('pages_master')
    .update({
      target_keyword: 'food photography',
      target_class: 'longtail_by_design',
      notes: NOTE,
      updated_at: now
    })
    .eq('property_url', PROPERTY)
    .eq('path', '/blog-on-photography/food-photography-tips');
}

const lockedReport = updateLockedCsv();
const camera = await clearCameraEventOverrides();
const wrongClaims = await clearWrongPageClaims();
await ensureTargetOverrides();

await logMasterMutation(sb, {
  tableName: 'traditional_seo_target_keyword_overrides',
  scriptName: 'apply-2026-08-10-cannibal-reassign-batch.mjs',
  args: 'batch reassign + camera dedupe',
  rowCount: camera.count + wrongClaims.length,
  notes: 'Alan 2026-08-10 cannibal reassignments'
});

console.log(
  JSON.stringify(
    {
      lockedReport,
      cameraCleared: camera,
      wrongClaimsCleared: wrongClaims.length,
      wrongClaimsSample: wrongClaims.slice(0, 20)
    },
    null,
    2
  )
);
