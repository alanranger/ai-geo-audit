/**
 * photography masterclasses: legacy /photography-masterclasses-online 301s to hub.
 * LOCKED already updated to /photography-courses-coventry; park open work.
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { assignIntegrityFindingIds } from '../lib/configIntegrity/findingIds.mjs';
import { runIntegrityCheck } from '../lib/configIntegrity/runIntegrityCheck.mjs';

dotenv.config({ path: '.env.local' });
const PROPERTY = 'https://www.alanranger.com';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const now = new Date().toISOString();

const result = await runIntegrityCheck({
  runSource: 'cli_park_masterclasses_301',
  persist: true
});
const findings = assignIntegrityFindingIds(result.findings || []);
const hits = findings.filter((f) =>
  /photography masterclasses/i.test(String(f.subject || ''))
);

console.log(
  'after LOCKED remaps:',
  hits.map((f) => ({
    id: f.findingId,
    assigned: f.assigned_path,
    preferred: f.preferred_path,
    action: f.suggested_action
  }))
);

// Park all masterclass findings + legacy CANN-5586
const parkIds = new Set(['CANN-5586', ...hits.map((f) => f.findingId)]);
for (const id of parkIds) {
  await sb.from('config_integrity_finding_state').upsert(
    {
      finding_key: id,
      property_url: PROPERTY,
      progress: 'done',
      decision_type: 'parked',
      note:
        'Parked 2026-08-09 Alan: /photography-masterclasses-online is 301 to /photography-courses-coventry (hub is fine). LOCKED repointed to hub. Not an open fix.',
      updated_at: now,
      last_seen_at: now
    },
    { onConflict: 'finding_key' }
  );
}

// Clear stale absent page-audit on old key
await sb.from('config_integrity_page_audit').delete().eq('finding_key', 'CANN-5586');

const result2 = await runIntegrityCheck({
  runSource: 'cli_park_masterclasses_301_2',
  persist: true
});
const findings2 = assignIntegrityFindingIds(result2.findings || []);
const hits2 = findings2.filter((f) => /photography masterclasses/i.test(String(f.subject || '')));
console.log(
  JSON.stringify(
    {
      chipRag: result2.chipRag,
      findingCount: result2.stats?.findingCount,
      structuralCount: result2.stats?.structuralCount,
      masterclasses: hits2.map((f) => ({
        id: f.findingId,
        assigned: f.assigned_path,
        preferred: f.preferred_path,
        action: f.suggested_action
      }))
    },
    null,
    2
  )
);
