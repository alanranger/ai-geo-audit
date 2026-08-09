/**
 * Re-check pages for hub /photography-courses-coventry page-audit rows + note BLOCK 03 ship.
 * Usage: node scripts/run-hub-page-audit-2026-08-10.mjs
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  normalizePath,
  scanPageForLink,
  linkStatusFromScan,
  toAbsoluteUrl
} from '../lib/configIntegrity/pageLinkAudit.mjs';
import { logMasterMutation } from '../lib/masterTableMutations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

const PROPERTY = 'https://www.alanranger.com';
const HUB = '/photography-courses-coventry';
const NOTE =
  'Hub BLOCK 03 compare table updated live 10 Aug 2026 — exact-match anchors hub→spokes (beginner photography classes, photo editing course, portrait photography course, photography tuition, photography lessons online, photography mentoring, rps courses). Stored: 03 Page Builds/Webpages/photography-courses-coventry/BLOCK-03-compare-courses-table-2026-08-10.html';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE env');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });
const now = new Date().toISOString();

async function fetchHtml(abs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const resp = await fetch(abs, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'AlanRangerSEO-PageAudit/1.0 (+https://www.alanranger.com)',
        Accept: 'text/html,application/xhtml+xml'
      }
    });
    const finalUrl = resp.url || abs;
    const status = resp.status;
    const text = status >= 200 && status < 400 ? await resp.text() : '';
    const html = text.length > 1_500_000 ? text.slice(0, 1_500_000) : text;
    return { ok: resp.ok, status, finalUrl, html, error: null };
  } catch (err) {
    return { ok: false, status: 0, finalUrl: abs, html: '', error: String(err?.message || err) };
  } finally {
    clearTimeout(t);
  }
}

// 1) Load existing hub audits + any latest-run findings with preferred/assigned hub
const { data: existing, error: e1 } = await sb
  .from('config_integrity_page_audit')
  .select('*')
  .eq('property_url', PROPERTY)
  .eq('from_path', HUB);
if (e1) throw e1;

const { data: run, error: e2 } = await sb
  .from('config_integrity_runs')
  .select('findings')
  .eq('property_url', PROPERTY)
  .order('run_at', { ascending: false })
  .limit(1)
  .maybeSingle();
if (e2) throw e2;

const findings = Array.isArray(run?.findings) ? run.findings : [];
const hubItems = new Map();

for (const row of existing || []) {
  hubItems.set(row.finding_key, {
    finding_key: row.finding_key,
    keyword: row.keyword,
    from_path: HUB,
    to_path: row.to_path
  });
}

// Preferred = hub → assigned specialist (strengthen direction)
for (const f of findings) {
  if (Number(f.check) !== 3) continue;
  const preferred = normalizePath(f.preferred_path || '');
  const assigned = normalizePath(f.assigned_path || '');
  if (preferred !== HUB || !assigned || assigned === HUB) continue;
  const id = String(f.findingId || f.finding_id || '').trim();
  // regenerate key if IDs not in findings jsonb
  const keyword = String(f.subject || '').trim();
  const finding_key =
    id ||
    // keep stable if already in page_audit
    [...hubItems.values()].find(
      (x) =>
        normalizePath(x.to_path) === assigned &&
        String(x.keyword || '').toLowerCase() === keyword.toLowerCase()
    )?.finding_key;
  if (!finding_key) continue;
  hubItems.set(finding_key, {
    finding_key,
    keyword,
    from_path: HUB,
    to_path: assigned
  });
}

const items = [...hubItems.values()];
if (!items.length) {
  console.error('No hub page-audit items found');
  process.exit(1);
}

// Prefetch hub once + unique targets
const hubFetch = await fetchHtml(toAbsoluteUrl(HUB));
const toMeta = new Map();
const uniqueTo = [...new Set(items.map((i) => normalizePath(i.to_path)).filter(Boolean))];
for (const to of uniqueTo) {
  const r = await fetchHtml(toAbsoluteUrl(to));
  const finalPath = normalizePath(r.finalUrl || to);
  toMeta.set(to, {
    ok: r.ok && r.status >= 200 && r.status < 400,
    status: r.status,
    finalPath,
    matchesLocked: finalPath === to,
    error: r.error
  });
}

const priorKeys = items.map((i) => i.finding_key);
const { data: prior } = await sb
  .from('config_integrity_page_audit')
  .select('finding_key, first_link_detected_at')
  .in('finding_key', priorKeys);
const firstMap = new Map((prior || []).map((p) => [p.finding_key, p.first_link_detected_at]));

const rows = [];
for (const it of items) {
  const toPath = normalizePath(it.to_path);
  const keyword = String(it.keyword || '').trim();
  const scan = hubFetch.html
    ? scanPageForLink(hubFetch.html, toPath, keyword)
    : { linkPresent: false, strongAnchor: false, sampleHref: '', sampleAnchor: '' };
  const link_status =
    hubFetch.error && !hubFetch.html ? 'error' : linkStatusFromScan(scan);
  const target = toMeta.get(toPath) || {
    ok: false,
    status: 0,
    finalPath: '',
    matchesLocked: false,
    error: 'not_fetched'
  };
  let firstLink = firstMap.get(it.finding_key) || null;
  if (link_status === 'present' && !firstLink) firstLink = now;
  rows.push({
    finding_key: it.finding_key,
    property_url: PROPERTY,
    keyword,
    from_path: HUB,
    to_path: toPath,
    link_status,
    sample_href: scan.sampleHref || null,
    sample_anchor: scan.sampleAnchor || null,
    from_http_status: hubFetch.status || null,
    from_fetch_error: hubFetch.error || null,
    target_ok: Boolean(target.ok && target.matchesLocked),
    target_http_status: target.status || null,
    target_final_path: target.finalPath || null,
    target_matches_locked: Boolean(target.matchesLocked),
    anchor_text: keyword,
    link_to_url: toAbsoluteUrl(toPath),
    checked_at: now,
    first_link_detected_at: firstLink,
    detail: {
      linkPresent: scan.linkPresent,
      strongAnchor: scan.strongAnchor,
      targetError: target.error || null,
      note: NOTE
    }
  });
}

const { error: upErr } = await sb.from('config_integrity_page_audit').upsert(rows, {
  onConflict: 'finding_key'
});
if (upErr) throw upErr;

// Compare before/after for the known fixed pair
const FIXED_EXPECT = new Set([
  'beginner photography classes',
  'portrait photography course'
]);

// Work-state notes for every hub audit row that is now present (or was already), and
// expected fixes even if still weak (record ship anyway)
const { data: states } = await sb
  .from('config_integrity_finding_state')
  .select('finding_key, note, progress, decision_type')
  .in(
    'finding_key',
    rows.map((r) => r.finding_key)
  );

const stateByKey = new Map((states || []).map((s) => [s.finding_key, s]));
const stateUpserts = [];
for (const r of rows) {
  const prev = stateByKey.get(r.finding_key);
  const priorNote = String(prev?.note || '').trim();
  if (priorNote.includes('Hub BLOCK 03 compare table updated live 10 Aug')) continue;
  const tags =
    r.link_status === 'present'
      ? 'page-audit=present after recheck'
      : `page-audit=${r.link_status} after recheck`;
  const note = priorNote
    ? `${priorNote} | ${NOTE} | ${tags}`
    : `${NOTE} | ${tags}`;
  stateUpserts.push({
    finding_key: r.finding_key,
    property_url: PROPERTY,
    progress: prev?.progress || 'in_progress',
    decision_type: prev?.decision_type || null,
    note: note.slice(0, 1800),
    worked_at: prev?.worked_at || now,
    updated_at: now,
    last_seen_at: now
  });
}
if (stateUpserts.length) {
  const { error: stErr } = await sb.from('config_integrity_finding_state').upsert(stateUpserts, {
    onConflict: 'finding_key'
  });
  if (stErr) throw stErr;
}

await logMasterMutation(sb, {
  tableName: 'config_integrity_page_audit',
  scriptName: 'run-hub-page-audit-2026-08-10.mjs',
  args: `from=${HUB} n=${rows.length}`,
  rowCount: rows.length,
  notes: NOTE
});

const summary = rows.map((r) => ({
  finding_key: r.finding_key,
  keyword: r.keyword,
  to_path: r.to_path,
  link_status: r.link_status,
  sample_anchor: r.sample_anchor,
  strong: Boolean(r.detail?.strongAnchor),
  expectedFix: FIXED_EXPECT.has(String(r.keyword || '').toLowerCase())
}));

const present = summary.filter((s) => s.link_status === 'present');
const weak = summary.filter((s) => s.link_status === 'weak');
const absent = summary.filter((s) => s.link_status === 'absent');
const expectedOk = summary.filter((s) => s.expectedFix && s.link_status === 'present');

console.log(
  JSON.stringify(
    {
      hubHttp: hubFetch.status,
      hubFinal: hubFetch.finalUrl,
      audited: rows.length,
      present: present.length,
      weak: weak.length,
      absent: absent.length,
      expectedFixesPresent: expectedOk.length,
      stateNotesUpdated: stateUpserts.length,
      rows: summary
    },
    null,
    2
  )
);
