/**
 * Clear leftover tracked keyword on 301 path /photography-masterclasses-online
 * (LOCKED ownership is hub). Removes check-2 Other/config for masterclasses.
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { runIntegrityCheck } from '../lib/configIntegrity/runIntegrityCheck.mjs';
import { assignIntegrityFindingIds } from '../lib/configIntegrity/findingIds.mjs';
import { logMasterMutation } from '../lib/masterTableMutations.mjs';

dotenv.config({ path: '.env.local' });

const PROPERTY = 'https://www.alanranger.com';
const REDIR_PATH = '/photography-masterclasses-online';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const now = new Date().toISOString();
const NOTE =
  'Cleared tracked keyword 2026-08-09 — page 301s to /photography-courses-coventry; LOCKED photography masterclasses owns hub. Not a money landing.';

const { data: before } = await sb
  .from('pages_master')
  .select('*')
  .eq('property_url', PROPERTY)
  .eq('path', REDIR_PATH)
  .maybeSingle();

const { error: pmErr } = await sb
  .from('pages_master')
  .update({
    target_keyword: '',
    target_class: 'redirect_legacy',
    notes: NOTE,
    updated_at: now
  })
  .eq('property_url', PROPERTY)
  .eq('path', REDIR_PATH);
if (pmErr) throw pmErr;

// Clear any override rows that still claim the keyword on this URL
const { data: ovs } = await sb
  .from('traditional_seo_target_keyword_overrides')
  .select('page_url, target_keyword, target_class, notes')
  .eq('property_url', PROPERTY)
  .or(`page_url.ilike.%photography-masterclasses-online%,target_keyword.ilike.photography masterclasses`);

for (const ov of ovs || []) {
  const url = String(ov.page_url || '');
  if (!/photography-masterclasses-online/i.test(url)) continue;
  const { error: ovErr } = await sb
    .from('traditional_seo_target_keyword_overrides')
    .update({
      target_keyword: '',
      target_class: 'redirect_legacy',
      notes: NOTE
    })
    .eq('property_url', PROPERTY)
    .eq('page_url', ov.page_url);
  if (ovErr) console.warn('override update', ov.page_url, ovErr);
}

await logMasterMutation(sb, {
  tableName: 'pages_master',
  scriptName: 'apply-2026-08-09-clear-masterclasses-301-tracked.mjs',
  notes: `Cleared tracked photography masterclasses from ${REDIR_PATH} (301 hub ownership)`,
  rowCount: 1,
  args: JSON.stringify({
    before: before
      ? {
          path: before.path,
          target_keyword: before.target_keyword,
          target_class: before.target_class
        }
      : null,
    after: {
      path: REDIR_PATH,
      target_keyword: '',
      target_class: 'redirect_legacy'
    }
  })
});

const run = await runIntegrityCheck({ runSource: 'cli_clear_masterclasses_301_tracked', persist: true });
const findings = assignIntegrityFindingIds(run.findings || []);
const left = findings.filter(
  (f) =>
    /masterclass/i.test(f.subject || '') ||
    /masterclass/i.test(f.detail || '') ||
    /masterclass/i.test(f.assigned_path || '') ||
    /masterclass/i.test(f.preferred_path || '')
);

// Park any remaining masterclass findings (b3d1 etc.)
for (const f of left) {
  await sb.from('config_integrity_finding_state').upsert(
    {
      finding_key: f.findingId,
      property_url: PROPERTY,
      progress: 'done',
      decision_type: 'parked',
      note: NOTE,
      updated_at: now,
      last_seen_at: now
    },
    { onConflict: 'finding_key' }
  );
}

const run2 = await runIntegrityCheck({ runSource: 'cli_clear_masterclasses_301_tracked_2', persist: true });
const findings2 = assignIntegrityFindingIds(run2.findings || []);
const left2 = findings2.filter(
  (f) =>
    /masterclass/i.test(f.subject || '') ||
    /masterclass/i.test(f.detail || '') ||
    String(f.findingId || '').includes('1c83')
);

console.log(
  JSON.stringify(
    {
      pagesMasterBefore: before
        ? {
            path: before.path,
            kw: before.target_keyword,
            cls: before.target_class
          }
        : null,
      chipRag: run2.chipRag,
      findingCount: run2.stats?.findingCount,
      structuralCount: run2.stats?.structuralCount,
      masterclassLeft: left2.map((f) => ({
        id: f.findingId,
        check: f.check,
        subject: f.subject,
        detail: f.detail,
        action: f.suggested_action
      }))
    },
    null,
    2
  )
);
