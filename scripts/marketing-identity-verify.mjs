/**
 * Read-only check of the stored customer build (9 Nov 2026 identity change). Prints counts and person_ids only.
 *   node scripts/marketing-identity-verify.mjs --out=C:/TEMP/before.json            (snapshot)
 *   node scripts/marketing-identity-verify.mjs --out=C:/TEMP/after.json --compare=C:/TEMP/before.json
 * Consent fingerprint per person = sha256 of [email, subscribed, suppressed, profile_state, consent_source].
 */
import crypto from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceClient, selectAll } from '../lib/marketing/store.mjs';
import { Q, clientHealth } from '../lib/marketing/client-health.mjs';
import { runQuery } from '../lib/marketing/query/table.mjs';
import { rowCtx } from '../lib/marketing/query/evaluate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['.env.vercel.prod', '.env.local']) {
  try {
    for (const line of readFileSync(resolve(root, name), 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '');
    }
  } catch { /* optional */ }
}
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || null;
const TODAY = new Date().toISOString().slice(0, 10);
const ctx = { today: TODAY, asOf: TODAY, engagementComplete: false, windows: { warm_days: 90, cooling_days: 180 } };
const EXCLUDED = ['b73f802f-ccb3-49a2-94f2-108e5396f543', 'ea7568f6-b9f3-4c06-a07d-927cfdcb5e35'];
const RECENT = ['p0_6', 'p6_12'];

const fingerprint = (p) => crypto.createHash('sha256').update(JSON.stringify([p.email || null, !!p.facts?.subscribed, p.facts?.suppressed || null, p.facts?.profile_state || null, p.facts?.consent_source || null])).digest('hex');

function queries(people) {
  const noEmail = runQuery(people, { root: Q.people(Q.band(RECENT), Q.consent(['no_email'])) }, ctx);
  const recent = runQuery(people, { root: Q.people(Q.band(RECENT)) }, ctx);
  const h = clientHealth(people, (p) => ({ ...rowCtx(p, ctx), windows: ctx.windows }), { asOf: TODAY });
  const queue = h.apart.identity_review;
  return {
    recent_no_email: { people: noEmail.header.people, emailable: noEmail.header.eligible_addresses, undecided_review_link: noEmail.results.unknown, members: noEmail.members.map((p) => p.person_id) },
    recent_purchasers: { people: recent.header.people, emailable: recent.header.eligible_addresses, still_no_email: recent.members.filter((p) => !p.facts.email).length },
    review_queue: queue ? { panel: queue.n, query: runQuery(people, { root: queue.root }, ctx).total, stored_pending: people.filter((p) => p.facts.identity_pending && p.facts.record_type === 'person' && !p.facts.owner && !p.facts.attached_to).length } : null,
    recent_card_no_email: h.cards.recent_not_eligible.no_email.n
  };
}

function compare(before, now) {
  const prev = new Map(before.consent.map((x) => [x.person_id, x.fp]));
  const kept = now.consent.filter((x) => prev.has(x.person_id));
  return { existing_people_compared: kept.length, consent_changed: kept.filter((x) => prev.get(x.person_id) !== x.fp).map((x) => x.person_id), before_people_now_stale: before.consent.filter((x) => !now.consent.some((y) => y.person_id === x.person_id)).length };
}

async function main() {
  const sb = serviceClient();
  const all = await selectAll(sb, 'customer_person', 'person_id, anchor_key, email, display_name, facts');
  const people = all.filter((p) => !p.facts?.stale);
  const alan = people.find((p) => p.anchor_key === 'name:alan ranger');
  const q = queries(people);
  const out = {
    at: new Date().toISOString(), live_people: people.length, stale_records: all.length - people.length,
    ...q, recent_no_email: { ...q.recent_no_email, members: undefined },
    alan_name: alan ? { person_id: alan.person_id, owner: !!alan.facts.owner, in_query: q.recent_no_email.members.includes(alan.person_id) } : null,
    exclusions: EXCLUDED.map((id) => { const p = all.find((x) => x.person_id === id); return { person_id: id, anchor: p?.anchor_key?.split(':')[0], stale: !!p?.facts?.stale, owner_kind: p?.facts?.owner_kind || null, suppressed: p?.facts?.suppressed || null, subscribed: !!p?.facts?.subscribed }; }),
    blocked_but_subscribed: people.filter((p) => p.facts.suppressed && p.facts.subscribed).map((p) => ({ person_id: p.person_id, consent_blocked: !!p.facts.suppressed })),
    consent: people.map((p) => ({ person_id: p.person_id, fp: fingerprint(p) }))
  };
  const prev = arg('compare');
  if (prev) out.compare = compare(JSON.parse(readFileSync(prev, 'utf8')), out);
  if (arg('out')) writeFileSync(arg('out'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ...out, consent: `${out.consent.length} fingerprints` }, null, 2));
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
