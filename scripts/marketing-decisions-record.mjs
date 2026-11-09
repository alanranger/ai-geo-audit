/**
 * Records Alan's 9 Nov decisions in public.marketing_decisions (who / when / why; history kept; never deleted).
 *   node scripts/marketing-decisions-record.mjs            dry run: prints what would be written
 *   node scripts/marketing-decisions-record.mjs --apply    writes (upsert by decision_key, history appended)
 * - plan_approved: only from GPT's explicit note on strategy_initiative_links ("Overall eight-week editorial plan
 *   approved by Alan …"); per-draft release approval stays separate.
 * - keep_blocked: each blocked contact currently subscribed again (by email hash; no names) — Alan: keep blocked.
 *   No consent change: marketing_suppression and Squarespace are not touched.
 * - deferred: the 9 Nov Hay Woods Outlook note (Alan does it himself).
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { emailHash, selectAll } from '../lib/marketing/store.mjs';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const APPLY = process.argv.includes('--apply');
const PROP = 'https://www.alanranger.com';
const BY = 'Cursor (recorded for Alan, lead instruction 9 Nov 2026)';
const SOURCE = 'QUESTION-2026-11-09-decisions-close-across-views-results-dedupe.md';

async function planRecord() {
  const { data, error } = await sb.from('strategy_initiative_links').select('note, set_at').eq('property_url', PROP).ilike('note', 'Overall eight-week editorial plan approved by Alan%').order('set_at').limit(100);
  if (error) throw new Error(error.message);
  if (!data.length) return [];
  return [{ decision_key: 'plan_approved|gpt-8w-2026-11', kind: 'plan_approved', ref_key: 'gpt-8w-2026-11', decision: 'approved overall (editorial)', reason: data[0].note, decided_by: 'Alan (GPT chat)', decided_at: data[0].set_at, source: `strategy_initiative_links.note (GPT, ${data.length} links)` }];
}
async function keepBlockedRecords() {
  const people = await selectAll(sb, 'customer_person', 'person_id, facts', (q) => q.eq('facts->>subscribed', 'true').not('facts->>suppressed', 'is', null));
  const hashes = [...new Set(people.map((p) => emailHash(p.facts?.email)))];
  const { data } = await sb.from('marketing_suppression').select('email_hash, resolved_at').in('email_hash', hashes);
  const open = hashes.filter((h) => !(data || []).some((r) => r.email_hash === h && r.resolved_at));
  return open.map((h) => ({ decision_key: `keep_blocked|${h}`, kind: 'keep_blocked', ref_key: h, decision: 'keep blocked', reason: 'Alan: "ok keep them blocked" (9 Nov). No consent change.', decided_by: 'Alan', decided_at: '2026-11-09T09:15:00Z', source: SOURCE }));
}
const deferRecord = () => [{ decision_key: 'deferred|step|2026-11-09|Outlook personal notes|2026-11-09', kind: 'deferred', ref_key: 'step|2026-11-09|Outlook personal notes|2026-11-09', decision: 'deferred: Alan does it himself', reason: 'Hay Woods Outlook note: Alan deferred it to his own work today (9 Nov); not a dashboard decision.', decided_by: 'Alan', decided_at: '2026-11-09T09:15:00Z', source: SOURCE }];

async function write(rows) {
  const keys = rows.map((r) => r.decision_key);
  const { data: cur } = await sb.from('marketing_decisions').select('decision_key, history, decision, reason, decided_at').in('decision_key', keys);
  const now = new Date().toISOString();
  const out = rows.map((r) => {
    const prev = (cur || []).find((c) => c.decision_key === r.decision_key);
    const entry = { at: now, by: BY, action: prev ? 'updated' : 'recorded', decision: r.decision, ...(prev ? { previous: { decision: prev.decision, reason: prev.reason, decided_at: prev.decided_at } } : {}) };
    return { ...r, recorded_by: BY, recorded_at: now, history: [...(prev?.history || []), entry] };
  });
  const { error } = await sb.from('marketing_decisions').upsert(out, { onConflict: 'decision_key' });
  if (error) throw new Error(error.message);
}

const count = async () => (await sb.from('marketing_decisions').select('kind')).data?.reduce((m, r) => ({ ...m, [r.kind]: (m[r.kind] || 0) + 1 }), {}) || {};
const rows = [...(await planRecord()), ...(await keepBlockedRecords()), ...deferRecord()];
console.log('before', JSON.stringify(await count()));
for (const r of rows) console.log(`${APPLY ? 'WRITE' : 'would write'}  ${r.kind}  ${r.kind === 'keep_blocked' ? `${r.ref_key.slice(0, 8)}…` : r.ref_key}  · ${r.decided_by} ${r.decided_at}`);
if (APPLY) await write(rows);
console.log('after', JSON.stringify(await count()));
