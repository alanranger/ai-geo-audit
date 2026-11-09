/**
 * DRY RUN (read-only) of the 9 Nov 2026 identity change: Booking Sheet emails (Workshops "Email Address" + the other
 * email-bearing tabs) and the exact-unique-name rule. Reads the Booking Sheet workbook (never writes it) and the live
 * Supabase tables (select only); writes nothing to the database.
 *   node scripts/marketing-identity-dry-run.mjs ["<path to Booking Sheet .xlsm>"] [--sample=C:/TEMP/x.json]
 * stdout = counts and person_ids only. The 20-row sample (names / emails) goes to the --sample path (local only).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import xlsx from 'xlsx';
import { serviceClient, selectAll, normName } from '../lib/marketing/store.mjs';
import { loadSources, computeAll, identitySummary } from '../lib/marketing/rebuild.mjs';
import { parseWorkshopsTab } from '../lib/booking-sheet-workshops.mjs';
import { parseContactTabs } from '../lib/booking-sheet-contacts.mjs';
import { Q, consentStateOf } from '../lib/marketing/client-health.mjs';
import { runQuery } from '../lib/marketing/query/table.mjs';
import { FIELD } from '../lib/marketing/query/fields.mjs';
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

const args = process.argv.slice(2);
const FILE = args.find((a) => !a.startsWith('--')) || 'G:/Dropbox/1. Bookings/Booking_Sheet_2026_-_WITH_PRODUCT_MAPPING_3.xlsm';
const SAMPLE = (args.find((a) => a.startsWith('--sample=')) || '--sample=C:/TEMP/agentk-identity-dry-run-sample.json').slice(9);
const PROP = 'https://www.alanranger.com';
const TODAY = new Date().toISOString().slice(0, 10);
const OWNER_IDS = ['b73f802f-ccb3-49a2-94f2-108e5396f543', 'ea7568f6-b9f3-4c06-a07d-927cfdcb5e35'];
const RECENT = ['p0_6', 'p6_12'];

const wsKey = (r) => `${r.event_start || ''}|${normName(r.client_name)}|${String(r.order_ref || '').trim()}`;

/** Parsed sheet rows keep their stored id when the same row is already in the table (stable link ids for the diff). */
function withStoredIds(parsed, stored) {
  const pool = new Map();
  for (const s of stored) pool.set(wsKey(s), [...(pool.get(wsKey(s)) || []), s.id]);
  let fresh = 0;
  return parsed.map((r) => {
    const ids = pool.get(wsKey(r));
    const id = ids?.length ? ids.shift() : `new:${fresh += 1}`;
    return { id, event_start: r.event_start, theme_location: r.theme_location, source: r.source, order_ref: r.order_ref, client_name: r.client_name, is_multi_day: r.is_multi_day, email: r.email };
  });
}

function tabEmails(rowsByTab, knownEmails) {
  const out = {};
  for (const [tab, rows] of Object.entries(rowsByTab)) {
    const emails = new Set(rows.map((r) => r.email).filter(Boolean));
    out[tab] = { rows: rows.length, rows_with_email: rows.filter((r) => r.email).length, distinct_emails: emails.size, emails_new_to_customers: [...emails].filter((e) => !knownEmails.has(e)).length };
  }
  return out;
}

const ctx = { today: TODAY, asOf: TODAY, engagementComplete: false, windows: { warm_days: 90, cooling_days: 180 } };
function customersQuery(people) {
  const run = (rootNode) => runQuery(people, { root: rootNode }, ctx);
  const noEmail = run(Q.people(Q.band(RECENT), Q.consent(['no_email'])));
  const recent = run(Q.people(Q.band(RECENT)));
  return {
    recent_no_email: { people: noEmail.header.people, emailable: noEmail.header.eligible_addresses, undecided_review: noEmail.results.unknown },
    recent_purchasers: { people: recent.header.people, emailable: recent.header.eligible_addresses, still_no_email: recent.members.filter((p) => !p.facts.email && !p.facts.owner).length, owner_records_apart: recent.header.owner_addresses },
    members: noEmail.members.map((p) => p.person_id)
  };
}

const RULE = (m) => (/exact_unique/.test(m) ? 'name_exact_unique' : (/^order_ref\+/.test(m) ? 'order_ref' : (/^email_/.test(m) ? 'row_email' : m)));

function mergeDiff(oldPeople, oldLinks, st, idByAnchor) {
  const newLink = new Map(st.links.map((l) => [`${l.source}|${l.source_id}`, l]));
  const linksByPerson = new Map();
  for (const l of oldLinks) linksByPerson.set(l.person_id, [...(linksByPerson.get(l.person_id) || []), l]);
  const merged = [];
  for (const p of oldPeople) {
    if (!p.anchor_key.startsWith('name:') || p.facts?.stale || st.persons.has(p.anchor_key)) continue;
    const moved = (linksByPerson.get(p.person_id) || []).map((l) => newLink.get(`${l.source}|${l.source_id}`)).filter(Boolean);
    const targets = [...new Set(moved.map((l) => l.anchor))];
    merged.push({ person_id: p.person_id, old_anchor: p.anchor_key, old_net: p.facts?.value?.c?.net || 0, targets: targets.map((a) => ({ anchor: a, person_id: idByAnchor.get(a) || 'new' })), rules: [...new Set(moved.map((l) => RULE(l.match_method)))], rows: moved.length });
  }
  return merged;
}

function tally(list, fn) { return list.reduce((m, x) => { const k = fn(x); m[k] = (m[k] || 0) + 1; return m; }, {}); }

function emailsByTab(d) {
  const ws = d.parsedWs;
  const emails = new Set(ws.map((r) => r.email).filter(Boolean));
  return {
    Workshops: { rows: ws.length, rows_with_email: ws.filter((r) => r.email).length, distinct_emails: emails.size, emails_new_to_customers: [...emails].filter((e) => !d.knownEmails.has(e)).length, stored_rows_matched: d.workshops.filter((r) => !String(r.id).startsWith('new:')).length },
    'Courses-Classes (already synced)': { rows: d.src.courses.length, rows_with_email: d.src.courses.filter((r) => r.email).length },
    'PnM Plans (already synced)': { rows: d.src.sheetPlans.length, rows_with_email: d.src.sheetPlans.filter((r) => r.email).length },
    ...tabEmails(Object.groupBy(d.contacts.rows, (r) => r.tab), d.knownEmails)
  };
}

function mergeCounts(merged) {
  const isNew = (t) => t.person_id === 'new';
  return {
    total: merged.length, by_rule: tally(merged, (m) => m.rules.join('+') || 'none'),
    into_existing_contact: merged.filter((m) => m.targets.length && !m.targets.some(isNew)).length, into_new_email_record: merged.filter((m) => m.targets.some(isNew)).length,
    split_over_several_targets: merged.filter((m) => m.targets.length > 1).length, gbp_moved: Math.round(merged.reduce((a, m) => a + m.old_net, 0)),
    into_owner_records: merged.flatMap((m) => m.targets).filter((t) => OWNER_IDS.includes(t.person_id)).length
  };
}

function ownerChecks(d) {
  const alan = d.oldByAnchor.get('name:alan ranger');
  const exclusion = (id) => {
    const old = d.live.find((p) => p.person_id === id);
    const f = old ? d.facts.get(old.anchor_key) : null;
    return { person_id: id, kept: !!f, owner_kind: f?.owner_kind || null, suppressed_unchanged: (f?.suppressed || null) === (old?.facts?.suppressed || null) };
  };
  return {
    alan_name_record: alan?.person_id || null, alan_name_owner_after: !!d.facts.get('name:alan ranger')?.owner,
    alan_name_in_query_before: d.before.members.includes(alan?.person_id), alan_name_in_query_after: d.after.members.includes(alan?.person_id),
    exclusions: OWNER_IDS.map(exclusion),
    owner_record_ids: d.newPeople.filter((p) => p.facts.owner).map((p) => ({ person_id: p.person_id, kind: p.facts.owner_kind, was_owner: !!d.oldByAnchor.get(p.anchor_key)?.facts?.owner }))
  };
}

function consentChanges(d) {
  const changed = (p) => {
    const o = d.oldByAnchor.get(p.anchor_key);
    return !!o && (!!o.facts?.subscribed !== !!p.facts.subscribed || (o.facts?.suppressed || null) !== (p.facts.suppressed || null));
  };
  return d.newPeople.filter(changed).map((p) => p.person_id);
}

function reviewCounts(d) {
  const recent = (p) => RECENT.includes(FIELD.get('purchase_band').get(rowCtx(p, ctx)));
  return {
    individuals: d.pending.filter((p) => p.facts.record_type === 'person' && !p.facts.owner).length, b2b_organisations: d.pending.filter((p) => p.facts.record_type === 'organisation').length,
    individuals_recent_buyers: d.pending.filter((p) => p.facts.record_type === 'person' && recent(p)).length, by_reason: d.sum.review_by_reason, b2b_without_email_not_in_review: d.sum.organisations_without_email,
    list: d.pending.map((p) => ({ person_id: p.person_id, reason: p.facts.identity_pending, b2b: p.facts.record_type === 'organisation', recent_buyer: recent(p) }))
  };
}

/** Where each person of the "before" recent / no-email query ends up (consent state of the contact they joined). */
function fateOfBefore(d, merged) {
  const into = new Map(merged.map((m) => [m.person_id, m.targets[0]?.anchor]));
  const byId = new Map(d.newPeople.map((p) => [p.person_id, p]));
  const fate = (id) => {
    if (d.after.members.includes(id)) return 'still_no_email_decided';
    const now = byId.get(id);
    if (now?.facts.identity_pending) return 'review_queue';
    if (now?.facts.owner) return `owner_${now.facts.owner_kind}`;
    if (now?.facts.record_type === 'organisation') return 'now_b2b_organisation';
    const target = into.has(id) ? d.newPeople.find((p) => p.anchor_key === into.get(id)) : null;
    return target ? `merged:${consentStateOf(rowCtx(target, ctx))}` : 'other';
  };
  return tally(d.before.members, fate);
}

async function load() {
  const sb = serviceClient();
  const wb = xlsx.read(readFileSync(FILE), { type: 'buffer', cellDates: false, raw: true });
  const src = await loadSources(sb);
  const parsedWs = parseWorkshopsTab(wb, { propertyUrl: PROP, sourceFile: FILE }).rows;
  const contacts = parseContactTabs(wb, { propertyUrl: PROP, sourceFile: FILE });
  const oldPeople = await selectAll(sb, 'customer_person', 'person_id, anchor_key, email, facts');
  const oldLinks = await selectAll(sb, 'customer_identity_link', 'source, source_id, person_id, match_method');
  return { src, parsedWs, contacts, workshops: withStoredIds(parsedWs, src.workshops), oldPeople, oldLinks };
}

async function main() {
  const d = await load();
  d.idByAnchor = new Map(d.oldPeople.map((p) => [p.anchor_key, p.person_id]));
  d.knownEmails = new Set(d.oldPeople.map((p) => p.email).filter(Boolean));
  d.live = d.oldPeople.filter((p) => !p.facts?.stale);
  d.oldByAnchor = new Map(d.live.map((p) => [p.anchor_key, p]));
  const { st, facts } = computeAll({ ...d.src, workshops: d.workshops, contacts: d.contacts.rows }, TODAY);
  d.facts = facts;
  d.newPeople = [...facts].map(([anchor, f]) => ({ person_id: d.idByAnchor.get(anchor) || `new:${anchor.split(':')[0]}`, anchor_key: anchor, facts: f }));
  d.sum = identitySummary(facts);
  d.pending = d.newPeople.filter((p) => p.facts.identity_pending && !p.facts.attached_to);
  d.before = customersQuery(d.live);
  d.after = customersQuery(d.newPeople);
  const merged = mergeDiff(d.live, d.oldLinks, st, d.idByAnchor);
  const counts = {
    as_of: TODAY, workbook: FILE.split(/[\\/]/).pop(), emails_by_tab: emailsByTab(d), persons_auto_merged: mergeCounts(merged),
    new_email_records: d.newPeople.filter((p) => p.person_id === 'new:email').length, review_queue: reviewCounts(d), owner_records: d.sum.owner_records,
    owner_checks: ownerChecks(d), consent_changes_on_existing_people: consentChanges(d),
    customers_query: { before: { ...d.before, members: undefined }, after: { ...d.after, members: undefined }, fate_of_before_recent_no_email: fateOfBefore(d, merged) }
  };
  const sample = merged.filter((m) => m.rules.length).sort((a, b) => b.old_net - a.old_net).slice(0, 20)
    .map((m) => ({ ...m, old_name: d.oldByAnchor.get(m.old_anchor)?.facts?.name || null, target_emails: m.targets.map((t) => facts.get(t.anchor)?.email || null) }));
  writeFileSync(SAMPLE, JSON.stringify({ note: 'LOCAL ONLY — contains names / emails. Do not copy to Drive.', sample }, null, 2));
  writeFileSync(SAMPLE.replace(/\.json$/, '-counts.json'), JSON.stringify(counts, null, 2));
  console.log(JSON.stringify({ ...counts, review_queue: { ...counts.review_queue, list: `${counts.review_queue.list.length} rows (counts file)` } }, null, 2));
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
