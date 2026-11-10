/**
 * Soft opt-in Stage 2 (QUESTION-2026-11-10-soft-opt-in-stage-2-apply-20; Claude confirmed, Alan 13:06 / 13:37):
 * records the consent basis in public.marketing_decisions — one batch row, one row per person keyed by the sha256 email
 * hash (no personal data), and an exclusion row for the checkout decliner. Nothing else is written: subscribed,
 * suppressed, profile_state, Squarespace and the suppression list are never touched. The next customer rebuild applies
 * facts.consent_source = soft_opt_in_existing_customer (lib/marketing/consent-basis.mjs).
 *   node scripts/marketing-consent-basis-record.mjs            dry run (checks + what would be written; ids / hash prefixes only)
 *   node scripts/marketing-consent-basis-record.mjs --apply    upsert by decision_key, history appended
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOFT_OPT_IN, SOFT_OPT_IN_BATCH, SOFT_OPT_IN_EXCLUDED } from '../lib/marketing/consent-basis.mjs';

export const SOURCE = 'QUESTION-2026-11-10-soft-opt-in-stage-2-apply-20.md';
export const REASON = 'existing-customer soft opt-in, Alan 10 Nov 2026, JLR excluded, Into the Blue included, checkout decliners excluded';
const BY = 'Cursor (Agent K) for Alan, Claude-confirmed Stage 2';
const DECIDED_AT = '2026-11-10T13:37:00Z';

/** The 20 (Stage 1's 19 incl. Into the Blue + 784a7e27 confirmed by Alan); person ids only. */
export const BATCH = [
  '085bc6cd-fcbf-45a1-9b20-3459a4b364f9', '0a4fb843-5316-49a8-8428-cb1393a6ac8a', '0a69a89f-01f1-469f-915e-ebb293cd0f5e', '2604232d-a481-42d6-9fd9-a3a3d7ad639d',
  '29d13fbc-e2d6-493d-8388-d16a6e188da6', '3c26383a-2df8-45d1-904f-d49d4b3fc4c5', '4a0b2acf-837a-43c2-b6ea-ea95cb2176b4', '4d90eb79-e380-4c66-9842-9685fbe2dec7',
  '784a7e27-89c7-4901-b104-ba8d9fb8a949', '85206abd-d451-42e0-a02f-60369aaeda68', '8e8f7d1e-f6b7-4a60-80cb-8ce3c913fb85', '913c84bf-45aa-4845-88f8-bfa74983e707',
  '9bc0c40d-5d19-4366-b7c0-7562b34ee665', '9ef89879-6dae-4c5c-abea-fc8e0b54d876', 'adfca0d5-7455-4b9c-adc8-3a0cdb6d206e', 'b4bd87bb-13fd-4411-892c-de80e940623c',
  'c041e427-2b7e-408f-9cf5-6e6263391ded', 'c23d2d01-6977-4c47-b4af-05cd12e084e1', 'dd0954e0-8bb8-4d1a-95d4-42b77630b30e', 'e76617be-3e01-4f9d-a111-f1e18c665a78'
];
/** Bought via Squarespace checkout on an alias that declined the newsletter (Alan 13:37): never swept in later. */
export const EXCLUDED = ['a70d5d94-aff2-4b4c-b26b-6f03ff13d182'];

/** Why a batch person may not be recorded now (empty = ok): must still be an email-only recent buyer, not blocked. */
const CHECKS = [
  ['no_email', (p) => !p.email],
  ['suppressed', (p, f, ctx) => !!f.suppressed || ctx.suppressedHashes.has(ctx.hash(p.email))],
  ['unsubscribe_event', (p, f, ctx) => ctx.unsubscribed.has(p.email)],
  ['owner_hold_or_pending', (p, f) => !!(f.owner || f.relationship_hold || f.identity_pending)],
  ['not_a_person', (p, f) => (f.record_type || 'person') !== 'person'],
  ['squarespace_contact_not_subscribed', (p, f) => f.profile_state === 'active' && !f.subscribed]
];
export function blockers(p, ctx) {
  if (!p || p.facts?.stale) return ['missing_or_stale'];
  return CHECKS.filter(([, bad]) => bad(p, p.facts || {}, ctx)).map(([k]) => k);
}

export function decisionRows(people, hash, batchIds = BATCH, excludedIds = EXCLUDED) {
  const row = (key, ref, decision, reason) => ({ decision_key: `consent_basis|${key}`, kind: 'consent_basis', ref_key: ref, decision, reason, decided_by: 'Alan', decided_at: DECIDED_AT, source: SOURCE });
  const batch = row(SOFT_OPT_IN_BATCH, SOFT_OPT_IN_BATCH, `${SOFT_OPT_IN} (batch of ${batchIds.length})`, REASON);
  const each = batchIds.map((id) => hash(people.get(id).email)).map((h) => row(h, h, SOFT_OPT_IN, `${REASON} (batch ${SOFT_OPT_IN_BATCH})`));
  const excl = excludedIds.map((id) => hash(people.get(id).email)).map((h) => row(h, h, SOFT_OPT_IN_EXCLUDED, `Declined at checkout: bought via Squarespace checkout on an address that declined the newsletter (Alan 13:37, 10 Nov 2026). Never swept into a soft opt-in batch (batch ${SOFT_OPT_IN_BATCH}).`));
  return [batch, ...each, ...excl];
}

function loadEnv() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  for (const name of ['.env.vercel.prod', '.env.local']) {
    try {
      for (const line of readFileSync(resolve(root, name), 'utf8').split(/\r?\n/)) {
        const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '');
      }
    } catch { /* optional */ }
  }
}

async function upsertWithHistory(sb, rows) {
  const { data: cur, error: e1 } = await sb.from('marketing_decisions').select('decision_key, history, decision, reason, decided_at').in('decision_key', rows.map((r) => r.decision_key));
  if (e1) throw new Error(e1.message);
  const now = new Date().toISOString();
  const out = rows.map((r) => {
    const prev = (cur || []).find((c) => c.decision_key === r.decision_key);
    const entry = { at: now, by: BY, action: prev ? 'updated' : 'recorded', decision: r.decision, ...(prev ? { previous: { decision: prev.decision, reason: prev.reason, decided_at: prev.decided_at } } : {}) };
    return { ...r, recorded_by: BY, recorded_at: now, history: [...(prev?.history || []), entry] };
  });
  const { error } = await sb.from('marketing_decisions').upsert(out, { onConflict: 'decision_key' });
  if (error) throw new Error(error.message);
  return out.length;
}

async function main() {
  loadEnv();
  const { serviceClient, selectAll, emailHash, normEmail } = await import('../lib/marketing/store.mjs');
  const sb = serviceClient();
  const ids = [...BATCH, ...EXCLUDED];
  const people = new Map((await selectAll(sb, 'customer_person', 'person_id, email, facts', (q) => q.in('person_id', ids))).map((p) => [p.person_id, { ...p, email: normEmail(p.email) }]));
  const supp = await selectAll(sb, 'marketing_suppression', 'email_hash, resolved_at');
  const unsub = await selectAll(sb, 'sqs_email_events', 'email', (q) => q.eq('event_type', 'UNSUBSCRIBED'));
  const ctx = { hash: emailHash, suppressedHashes: new Set(supp.filter((s) => !s.resolved_at).map((s) => s.email_hash)), unsubscribed: new Set(unsub.map((e) => normEmail(e.email))) };
  const blocked = BATCH.map((id) => ({ person_id: id, reasons: blockers(people.get(id), ctx) })).filter((x) => x.reasons.length);
  const missingExcl = EXCLUDED.filter((id) => !people.get(id)?.email);
  console.log(JSON.stringify({ batch: BATCH.length, excluded: EXCLUDED.length, found: people.size, blocked, excluded_missing: missingExcl }, null, 2));
  if (blocked.length || missingExcl.length) { console.error('STOP: a batch person no longer qualifies (or an id is missing). Nothing written.'); process.exit(2); }
  const rows = decisionRows(people, emailHash);
  for (const r of rows) console.log(`${process.argv.includes('--apply') ? 'WRITE' : 'would write'}  ${r.decision_key.slice(0, 22)}…  ${r.decision}`);
  if (!process.argv.includes('--apply')) { console.log('dry run: nothing written (pass --apply)'); return; }
  console.log(JSON.stringify({ upserted: await upsertWithHistory(sb, rows) }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((e) => { console.error(e.message || e); process.exit(1); });
