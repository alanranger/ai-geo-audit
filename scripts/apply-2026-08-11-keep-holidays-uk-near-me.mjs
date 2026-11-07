/**
 * Record keep_specialist: photography holidays uk → /photography-workshops-near-me
 * (multi-day workshop hub). Alan 11 Aug 2026.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { assignIntegrityFindingIds } from '../lib/configIntegrity/findingIds.mjs';
import { runIntegrityCheck } from '../lib/configIntegrity/runIntegrityCheck.mjs';
import { logMasterMutation } from '../lib/masterTableMutations.mjs';
import * as pla from '../lib/configIntegrity/pageLinkAudit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

const PROPERTY = 'https://www.alanranger.com';
const KW = 'photography holidays uk';
const TARGET = '/photography-workshops-near-me';
const PREFERRED = '/photography-workshops';
const now = new Date().toISOString();

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE env');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const [row] = assignIntegrityFindingIds([
  {
    check: 3,
    subject: KW,
    preferred_path: PREFERRED,
    assigned_path: TARGET,
    detail: `Google prefers ${PREFERRED}; assigned page ${TARGET}`
  }
]);
const finding_key = row.findingId;
console.log('finding_key', finding_key);

const { error: stErr } = await sb.from('config_integrity_finding_state').upsert(
  {
    finding_key,
    property_url: PROPERTY,
    progress: 'in_progress',
    decision_type: 'keep_specialist',
    note: 'Keep multi-day hub /photography-workshops-near-me for photography holidays uk (Alan 11 Aug).',
    worked_at: now,
    updated_at: now,
    last_seen_at: now,
    cleared_at: null
  },
  { onConflict: 'finding_key' }
);
if (stErr) throw stErr;

console.log('pageLinkAudit exports', Object.keys(pla));
const auditFn =
  pla.auditPageLinks ||
  pla.auditFindingPageLinks ||
  pla.runPageLinkAudit ||
  pla.default;
if (typeof auditFn === 'function') {
  try {
    const audit = await auditFn({
      sb,
      propertyUrl: PROPERTY,
      findingKey: finding_key,
      keyword: KW,
      fromPath: PREFERRED,
      toPath: TARGET,
      preferred_path: PREFERRED,
      assigned_path: TARGET,
      subject: KW
    });
    console.log('audit', audit);
  } catch (e) {
    console.warn('audit failed', e.message);
  }
}

await logMasterMutation(sb, {
  tableName: 'config_integrity_finding_state',
  scriptName: 'apply-2026-08-11-keep-holidays-uk-near-me.mjs',
  args: `${KW} → ${TARGET}`,
  rowCount: 1,
  notes: 'Alan: multi-day hub decision for holidays uk'
});

const result = await runIntegrityCheck({ runSource: 'cli_keep_holidays_uk_near_me', persist: true });
const withIds = assignIntegrityFindingIds(result.findings || []);
const hit = withIds.find((f) => String(f.subject || '').toLowerCase() === KW);
console.log(
  JSON.stringify(
    {
      finding_count: (result.findings || []).length,
      chip_rag: result.chip_rag,
      stats: result.stats,
      hit: hit
        ? {
            id: hit.findingId,
            suggested_action: hit.suggested_action,
            assigned: hit.assigned_path,
            preferred: hit.preferred_path
          }
        : null
    },
    null,
    2
  )
);
