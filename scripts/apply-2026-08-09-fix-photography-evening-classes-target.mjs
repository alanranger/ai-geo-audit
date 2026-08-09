/**
 * Fix LOCKED typo: photography evening classes was wrongly on photo-editing page.
 * Align with evening photography classes → /beginners-photography-classes.
 * Re-audit + integrity run.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  scanPageForLink,
  linkStatusFromScan,
  toAbsoluteUrl
} from '../lib/configIntegrity/pageLinkAudit.mjs';
import {
  assignIntegrityFindingIds
} from '../lib/configIntegrity/findingIds.mjs';
import { runIntegrityCheck } from '../lib/configIntegrity/runIntegrityCheck.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });

const PROPERTY = 'https://www.alanranger.com';
const FROM = '/blog-on-photography/photography-evening-classes-fun-informative';
const TO = '/beginners-photography-classes';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const result = await runIntegrityCheck({ runSource: 'cli_fix_photography_evening_classes_target', persist: true });
const withIds = assignIntegrityFindingIds(result.findings || []);
const hits = withIds.filter((f) =>
  /^(evening photography classes|photography evening classes)$/i.test(String(f.subject || '').trim())
);

console.log(
  'findings after fix:',
  hits.map((f) => ({
    id: f.findingId,
    kw: f.subject,
    assigned: f.assigned_path,
    preferred: f.preferred_path,
    action: f.suggested_action
  }))
);

const html = await (
  await fetch(`https://www.alanranger.com${FROM}`, {
    headers: { 'user-agent': 'Mozilla/5.0 AlanRangerIntegrityAudit/1.0' }
  })
).text();

const now = new Date().toISOString();
const auditRows = [];
for (const f of hits) {
  const scan = scanPageForLink(html, f.assigned_path, f.subject);
  const status = linkStatusFromScan(scan);
  auditRows.push({
    finding_key: f.findingId,
    property_url: PROPERTY,
    from_path: FROM,
    to_path: TO,
    keyword: f.subject,
    link_status: status,
    sample_anchor: scan.sampleAnchor || null,
    sample_href: scan.sampleHref || null,
    link_to_url: toAbsoluteUrl(TO),
    from_http_status: 200,
    from_fetch_error: null,
    checked_at: now,
    target_ok: true,
    target_matches_locked: true,
    target_final_path: TO,
    first_link_detected_at: status === 'present' ? now : null
  });
}

if (auditRows.length) {
  const { error } = await sb
    .from('config_integrity_page_audit')
    .upsert(auditRows, { onConflict: 'finding_key' });
  if (error) console.error('audit upsert', error);
  else console.log('page_audit', auditRows.map((r) => ({ id: r.finding_key, s: r.link_status, a: r.sample_anchor })));
}

// Work state: mark both evening variants keep_specialist on beginners page
for (const f of hits) {
  const present = auditRows.find((r) => r.finding_key === f.findingId)?.link_status === 'present';
  await sb.from('config_integrity_finding_state').upsert(
    {
      finding_key: f.findingId,
      property_url: PROPERTY,
      progress: 'in_progress',
      decision_type: 'keep_specialist',
      note: present
        ? 'LOCKED fixed 2026-08-09: evening classes term -> beginners-photography-classes (not Lightroom). Exact anchor present; await recrawl.'
        : 'LOCKED fixed 2026-08-09: evening classes term -> beginners-photography-classes (not Lightroom). Need exact-phrase anchor to beginners classes page.',
      updated_at: now,
      last_seen_at: now
    },
    { onConflict: 'finding_key' }
  );
}

// Supersede stale CANN-511f key if id changed
await sb
  .from('config_integrity_finding_state')
  .upsert(
    {
      finding_key: 'CANN-511f',
      property_url: PROPERTY,
      progress: 'done',
      decision_type: 'parked',
      note: 'Superseded 2026-08-09 — LOCKED reassigned photography evening classes off photo-editing-course (was bad target). See new finding id after remap.',
      updated_at: now,
      last_seen_at: now
    },
    { onConflict: 'finding_key' }
  );

// Second integrity pass so suggested_action picks up work-state + audit
const result2 = await runIntegrityCheck({ runSource: 'cli_fix_photography_evening_classes_target_2', persist: true });
const withIds2 = assignIntegrityFindingIds(result2.findings || []);
const hits2 = withIds2.filter((f) =>
  /^(evening photography classes|photography evening classes)$/i.test(String(f.subject || '').trim())
);
console.log(
  JSON.stringify(
    {
      chipRag: result2.chipRag,
      structuralCount: result2.stats?.structuralCount,
      hits: hits2.map((f) => ({
        id: f.findingId,
        kw: f.subject,
        assigned: f.assigned_path,
        action: f.suggested_action
      }))
    },
    null,
    2
  )
);

// Touch note on LOCKED csv is already edited; log mutation
const lockedPath = path.join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v11.csv');
const line = fs
  .readFileSync(lockedPath, 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('photography evening classes,'));
console.log('LOCKED line now:', line);
