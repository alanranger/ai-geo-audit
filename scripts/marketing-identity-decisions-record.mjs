/**
 * Alan's 22 identity-review decisions (QUESTION-2026-11-10-identity-review-alan-decisions-22, approved 10 Nov 12:55–13:00)
 * → marketing_identity_decisions. Person ids only. Refuses to write when any pending / primary / alias id is an owner,
 * excluded or relationship-hold record. Dry run unless --apply; never duplicates an active decision.
 *   node scripts/marketing-identity-decisions-record.mjs [--apply]
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE = 'QUESTION-2026-11-10-identity-review-alan-decisions-22.md';
const DECIDED_BY = 'Alan (checked against his mailbox, Stripe and order emails), 10 Nov 2026';
const REASON = 'Alan identity-review decision, 10 Nov 2026';

/** [pending, primary | null (leave unmatched), aliases, separate] */
export const ROWS = [
  ['965e851d-4291-4eb7-9df4-0d0479eafa2d', '3be9df38-dda2-437a-bc4b-60ef03af0af5', ['a0e7d83a-921f-40b0-a33d-0a5e0cb9a0dc'], []],
  ['1984c1a3-5215-4204-a86e-1ee1e3f4cda1', '784a7e27-89c7-4901-b104-ba8d9fb8a949', ['1cc7c698-2131-4a6d-9ba6-4a4a85fb2780'], []],
  ['eae844c4-cf56-401d-9492-a6493ac0a51d', 'e4892692-f057-4aca-8375-b95e3d4c6ccb', ['351da2b9-8798-4642-b3af-c5e85599b839', '539a362c-4716-4661-90f7-28168a4bea1c'], []],
  ['16bf7601-7d64-4875-a4a4-985090a54345', 'fd09f99d-d4df-46e4-9785-4e2609e24855', ['0bdb316d-8003-498b-8692-0e527ec390e9'], []],
  ['a949e5e9-ee25-42b4-918d-31694e6f7f37', 'a70d5d94-aff2-4b4c-b26b-6f03ff13d182', ['ed0b80c7-aed2-422c-bb14-1b5027a3826f'], []],
  ['857b9bda-bf9f-434c-81e2-81ef071b855b', 'c3b3302a-924b-468f-8903-394a80684eb8', ['ff85050a-8141-4cab-8871-5144481ddb9b'], []],
  ['d51fb210-5256-43fe-88e2-25d6e7f80df7', '90db8c01-c72d-4934-a9e3-9d3c47fe1979', ['99fc3309-26de-4450-8c4c-04b8f1362fa6'], []],
  ['0de7afe4-1fe3-417f-ad35-a629ae680f85', 'acbac8d9-fbf4-4136-b355-782b90596a31', [], ['19b11992-a3b4-432a-9897-7a2b5c60a77c', '0216fb30-e544-4962-be57-8fab88f8e0b7']],
  ['8c8730bf-fdb6-4b35-b086-d328ebc76c4d', 'cfb6b10a-284c-4ea1-8f43-dc9510820617', ['50d73f75-e248-43cf-b02f-9c1c49369e45'], []],
  ['d2803025-d090-4519-a7a2-a4a543e9d5b7', 'c90cb185-898e-43ab-a47e-16de8bcdf3f7', ['1a6c2cfd-01c7-4b84-a192-2e5815c3bc3d'], []],
  ['d1bcd327-8f1d-4b8d-9977-83598942fdcd', 'a1b1fc17-e831-423f-841e-1d2f8800a54c', [], ['2ec9fb00-9c47-409a-b653-278d90a95403']],
  ['ea582272-aece-44be-813d-173ed509abf5', 'ebd0ebd7-2bd5-4320-83db-e3b3fe3d4796', ['45e7016c-e907-4c8c-89e9-0cd9b45a0269'], []],
  ['a1aad0d9-74f7-44ba-bda9-c7e210ae7bbe', 'c25c6f73-fc93-45f4-9d26-acd2aa9eaa4b', ['efab546f-44d7-4bee-a44c-90f2b9bc23b9', '7dacefeb-962a-4e1c-ae71-d9301a516e75', '7dbac452-3be2-477c-a172-e4729de61e56'], []],
  ['c089da77-6fa4-45d3-8ec1-f0e0890af3b4', '59a9a6c2-e54f-44a4-a6f4-6afa9615b2a8', ['a78815c0-5ca7-43a9-a250-ecb7cce49b49'], []],
  ['b1bf2ef9-7b4c-4c5b-b054-3c549b5d210d', '68cb2801-79ac-49cf-8436-55ab9aa3094e', ['c3746810-83dc-4204-86b9-ececa52bf814'], []],
  ['6e7ffca3-2eaf-4e20-97d5-8f6a0f8129c7', '2a1de192-d6e7-4105-9046-73ceee08551c', [], ['6c96bc6e-20d0-4229-bc72-6645881c7666']],
  ['d9560409-2dae-4638-a8cd-bacf518eb87b', '209f3124-edd7-4e7a-9f36-bea8be5f291d', ['739ed806-7b5a-4f91-b4bd-30e7154cd1fc'], []],
  ['b02eaeca-fc4f-4231-b702-d181ab2c3323', 'e569337d-2528-4331-a6db-39247825d803', [], ['f2db6c05-b3d0-41e1-86d2-ee7dc28c0661']],
  ['64f17aad-9441-4ff7-a346-e2661f96bb42', null, [], []],
  ['b9eb58f2-4bcc-4238-ac80-1dde174c49d9', '13b683f0-452b-49c5-820f-337fc6dabbea', ['5bfa7748-0e67-43d1-9e6b-3be329d1c4a7'], []],
  ['a2f4f30e-51b6-456e-aac3-1d0a428c730c', '542bf6b7-5dba-40c4-a1a1-26a6ccb371b2', ['9b67b447-d5f0-40fc-b929-fc3a51dbba88', 'c5ee2b61-3a21-48d3-87cc-1032f345148b'], []],
  ['84a088c2-34e3-4d95-9c65-7b2606504481', 'ca5131e7-0087-40e8-8417-7dc36b6509c5', ['143f0b18-ad66-4be3-afb0-da002032e66d'], []]
];

/** One decision row per relation: attach (pending → primary), alias (alias → primary), separate, unmatched. */
export function decisionRows(rows = ROWS) {
  return rows.flatMap(([pending, primary, aliases, separate]) => (primary
    ? [{ kind: 'attach', subject_person_id: pending, target_person_id: primary }, ...aliases.map((a) => ({ kind: 'alias', subject_person_id: a, target_person_id: primary })), ...separate.map((s) => ({ kind: 'separate', subject_person_id: s, target_person_id: primary }))]
    : [{ kind: 'unmatched', subject_person_id: pending, target_person_id: null }]));
}

/** Owner / excluded / relationship-hold reasons for one person (empty = safe to merge). */
export function guardReasons(p, holds) {
  if (!p) return ['missing'];
  const f = p.facts || {};
  return [f.owner && `owner:${f.owner_kind || 'flag'}`, f.relationship_hold && 'relationship_hold', holds.has(p.person_id) && 'relationship_hold_row', holds.has(p.anchor_key) && 'relationship_hold_anchor'].filter(Boolean);
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

async function main() {
  loadEnv();
  const { serviceClient, selectAll } = await import('../lib/marketing/store.mjs');
  const sb = serviceClient();
  const rows = decisionRows();
  const ids = [...new Set(rows.flatMap((r) => [r.subject_person_id, r.target_person_id]).filter(Boolean))];
  const people = new Map((await selectAll(sb, 'customer_person', 'person_id, anchor_key, facts', (q) => q.in('person_id', ids))).map((p) => [p.person_id, p]));
  const holdRows = await selectAll(sb, 'marketing_relationship_holds', 'person_id, anchor_key', (q) => q.is('cleared_at', null));
  const holds = new Set(holdRows.flatMap((h) => [h.person_id, h.anchor_key]));
  const merging = new Set(rows.filter((r) => r.kind !== 'separate').flatMap((r) => [r.subject_person_id, r.target_person_id]).filter(Boolean));
  const blocked = [...merging].map((id) => ({ person_id: id, reasons: guardReasons(people.get(id), holds) })).filter((x) => x.reasons.length);
  const separateFlags = rows.filter((r) => r.kind === 'separate').map((r) => ({ person_id: r.subject_person_id, reasons: guardReasons(people.get(r.subject_person_id), holds) })).filter((x) => x.reasons.length);
  const kinds = rows.reduce((m, r) => ({ ...m, [r.kind]: (m[r.kind] || 0) + 1 }), {});
  console.log(JSON.stringify({ table_rows: ROWS.length, decision_rows: rows.length, kinds, ids: ids.length, found: people.size, blocked, separate_flagged: separateFlags }, null, 2));
  if (blocked.length) { console.error('STOP: a pending / primary / alias id is an owner, excluded or relationship-hold record (or missing). Nothing written.'); process.exit(2); }
  if (!process.argv.includes('--apply')) { console.log('dry run: nothing written (pass --apply)'); return; }
  const active = await selectAll(sb, 'marketing_identity_decisions', 'kind, subject_person_id, target_person_id', (q) => q.is('cleared_at', null));
  const key = (r) => `${r.kind}|${r.subject_person_id}|${r.target_person_id || ''}`;
  const have = new Set(active.map(key));
  const fresh = rows.filter((r) => !have.has(key(r))).map((r) => ({ ...r, reason: REASON, decided_by: DECIDED_BY, source: SOURCE, set_by: 'Cursor (Agent K) for Alan' }));
  if (fresh.length) {
    const { error } = await sb.from('marketing_identity_decisions').insert(fresh);
    if (error) throw new Error(error.message);
  }
  console.log(JSON.stringify({ inserted: fresh.length, already_active: rows.length - fresh.length }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch((e) => { console.error(e.message || e); process.exit(1); });
