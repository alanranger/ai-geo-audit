/**
 * QUESTION-2026-11-12 presend-check-later-unsubscribes, proof on LIVE data with the LOCAL code. Person ids only.
 *   node scripts/presend-optout-proof.mjs --dry   every saved list holding a later opt-out: the verdict, nothing written
 *   node scripts/presend-optout-proof.mjs --run   the real pre-send check (presendCheck: re-reads consent from
 *       Squarespace, writes one new check result on each export) for 19 Nov, 7 Jan local and 28 Jan local
 * Both compare consent / contact / audience fields before and after; nothing is sent, loaded or written to Squarespace.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const ENV = Object.fromEntries(fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '').trim()]));
Object.assign(process.env, { SUPABASE_URL: ENV.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY, SQUARESPACE_API_KEY: ENV.SQUARESPACE_API_KEY });
const { consentFromDb, presendCheck, presendDry } = await import('../lib/marketing/list-load.mjs');
const sb = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const RUN = process.argv.includes('--run');
const OUT = '081ec7ca-ef72-444c-bdd2-599e87f76750';
const NAMED = [['19 Nov (575 list)', '171f5a2c-26fa-4f04-b794-855890c176c7'], ['7 Jan local (312 list)', '350761fb-eb89-4a64-848e-b087c6ac7d5f'], ['28 Jan local (238 list)', 'b181a720-9b33-4141-9259-003c51e74740']];
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

async function exportsWithOut() {
  const { data: m } = await sb.from('marketing_segment_export_members').select('export_id').eq('person_id', OUT);
  const ids = [...new Set((m || []).map((x) => x.export_id))];
  const { data } = await sb.from('marketing_segment_exports').select('export_id, list_name, sqs_list_id, is_test, created_at').in('export_id', ids).not('sqs_list_id', 'is', null).eq('is_test', false).order('created_at');
  return data || [];
}
/** Consent, contact and audience fields that must not change (the check result columns are excluded on purpose). */
async function protectedState(ids) {
  const members = [];
  for (const id of ids) {
    const { data } = await sb.from('marketing_segment_export_members').select('person_id, precheck_state, postcheck_state').eq('export_id', id).order('person_id').range(0, 4999);
    members.push([id, hash(data)]);
  }
  const { data: exps } = await sb.from('marketing_segment_exports').select('export_id, eligible_count, status, sqs_list_id, definition_snapshot, exclusions, segment_ids, campaign_key, list_name, status_history').in('export_id', ids).order('export_id');
  const { data: ex2 } = await sb.from('marketing_segment_exports').select('export_id, load_result').in('export_id', ids).order('export_id');
  const frozen = (ex2 || []).map((e) => ({ id: e.export_id, list_count: e.load_result?.list_count, imported: e.load_result?.imported, members: e.load_result?.members, log: (e.load_result?.presend_log || []).length }));
  const { data: person } = await sb.from('customer_person').select('facts').eq('person_id', OUT).maybeSingle();
  const { count: suppression } = await sb.from('marketing_suppression').select('*', { count: 'exact', head: true });
  const { count: subscribed } = await sb.from('sqs_profiles').select('*', { count: 'exact', head: true }).eq('accepts_marketing', true);
  const { count: people } = await sb.from('customer_person').select('*', { count: 'exact', head: true });
  return { members: Object.fromEntries(members), exports: hash(exps), frozen, opt_out_person: { subscribed: person?.facts?.subscribed, suppressed: person?.facts?.suppressed }, suppression, sqs_profiles_subscribed: subscribed, customer_person: people };
}
const line = (label, id, r) => ({ label, export_id: id, result: r.result, checked: r.checked, native: r.native_recipients, native_read_at: r.native_read_at, recipients_now: r.recipients_now, later_opt_outs: r.later_opt_outs, excluded: r.excluded_people?.map((p) => p.person_id), note: r.note, failures: r.failures, fail_people: r.people?.map((p) => p.person_id) });

const lists = await exportsWithOut();
const ids = RUN ? NAMED.map(([, id]) => id) : lists.map((l) => l.export_id);
const before = await protectedState(ids);
const out = [];
/**
 * presendCheck's own consent read is "sync profiles from Squarespace, then read": the Squarespace key exists only on
 * Vercel, so the same sync step runs there (POST sync profiles, read-only on Squarespace) and the check reads it at once.
 */
async function syncedConsent() {
  const r = await fetch('https://ai-geo-audit.vercel.app/api/aigeo/marketing', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-arp-admin-key': ENV.ARP_ADMIN_KEY }, body: JSON.stringify({ action: 'sync', step: 'profiles' }) });
  const j = await r.json();
  if (!j.ok) throw new Error(`profile sync failed: ${j.error}`);
  console.log(`consent re-read from Squarespace: ${j.profiles} contacts, ${j.subscribed} subscribed (${new Date().toISOString()})`);
  return { profiles: j.profiles, subscribed: j.subscribed, at: new Date().toISOString() };
}
if (RUN) {
  for (const [label, id] of NAMED) {
    const sync = await syncedConsent();
    out.push({ ...line(label, id, await presendCheck(sb, id, { consent: (db) => consentFromDb(db, sync) })), consent_synced_at: sync.at });
  }
} else {
  const c = await consentFromDb(sb);
  for (const l of lists) out.push(line(l.list_name, l.export_id, await presendDry(sb, l.export_id, c)));
}
const after = await protectedState(ids);
const changed = Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
for (const r of out) console.log(`${r.result} · ${r.label} · checked ${r.checked} · native ${r.native} · ${r.note || 'no later opt-outs'}${r.fail_people?.length ? ` · failing ids ${r.fail_people.join(', ')}` : ''}`);
console.log(`protected fields changed: ${changed.length ? changed.join(', ') : 'none'}`);
if (changed.includes('frozen')) console.log('frozen (expected only: one more presend_log line per run):', JSON.stringify(before.frozen), '→', JSON.stringify(after.frozen));
fs.writeFileSync(`outputs/presend-optout-proof-${RUN ? 'run' : 'dry'}-20261112.json`, JSON.stringify({ at: new Date().toISOString(), mode: RUN ? 'run' : 'dry', person_id: OUT, results: out, before, after, changed }, null, 2));
