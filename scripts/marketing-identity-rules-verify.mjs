/**
 * READ-ONLY check of the 10 Nov identity rules 1–4 + Alan's decisions. Builds the customer list in memory twice from
 * the same loaded sources (rules off = the 9 Nov behaviour; rules on + decisions) and diffs them per person.
 * Decisions come from marketing_identity_decisions, or from the record script's ROWS before they are stored.
 *   node scripts/marketing-identity-rules-verify.mjs [--out=C:/TEMP/x.json] [--db]
 * --db also compares the stored customer_person facts with the in-memory "rules on" build (after a rebuild).
 * stdout / --out = person_ids, rule names and fact keys only (no names or addresses).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceClient, selectAll } from '../lib/marketing/store.mjs';
import { loadSources, computeAll } from '../lib/marketing/rebuild.mjs';
import { decisionRows } from './marketing-identity-decisions-record.mjs';

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
const CONSENT_KEYS = ['email', 'subscribed', 'suppressed', 'profile_state', 'consent_source'];
const RULE_OF = (m) => (m.match(/name_(r[1-4]_[a-z_]+|decision|exact_unique)$/) || [null, m])[1];

const pendingOf = (facts) => [...facts].filter(([, f]) => f.identity_pending && !f.attached_to && f.record_type !== 'system' && !f.owner).map(([a]) => a);

function anchorsFromRows(rows, anchorOf) {
  return rows.map((r) => ({ kind: r.kind, subject_anchor: anchorOf.get(r.subject_person_id) || null, target_anchor: r.target_person_id ? anchorOf.get(r.target_person_id) || null : null }));
}

/** Where an old record's source rows went in the new build, and by which rule. */
function outcomeOf(anchor, d) {
  const now = d.nu.facts.get(anchor);
  if (now?.identity_pending) return { outcome: 'still_in_queue', reasons: now.identity_pending };
  const oldKeys = new Set(d.old.st.links.filter((l) => l.anchor === anchor).map((l) => `${l.source}|${l.source_id}`));
  const moved = d.nu.st.links.filter((l) => oldKeys.has(`${l.source}|${l.source_id}`) && l.anchor !== anchor);
  const targets = [...new Set(moved.map((l) => l.anchor))];
  if (!moved.length) return { outcome: now ? 'decided_unmatched' : 'gone', rules: [...new Set(d.nu.st.links.filter((l) => l.anchor === anchor).map((l) => RULE_OF(l.match_method)))] };
  return { outcome: 'merged', rules: [...new Set(moved.map((l) => RULE_OF(l.match_method)))], into: targets.map((a) => d.id(a)) };
}

function consentChanges(d) {
  const changed = [];
  for (const [anchor, o] of d.old.facts) {
    const n = d.nu.facts.get(anchor);
    if (!n) continue;
    const keys = CONSENT_KEYS.filter((k) => JSON.stringify(o[k] ?? null) !== JSON.stringify(n[k] ?? null));
    if (keys.length) changed.push({ person_id: d.id(anchor), keys });
  }
  return changed;
}

function factDiff(d) {
  const out = [];
  for (const [anchor, o] of d.old.facts) {
    const n = d.nu.facts.get(anchor);
    if (!n) { out.push({ anchor, person_id: d.id(anchor), gone: true }); continue; }
    const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].filter((k) => JSON.stringify(o[k] ?? null) !== JSON.stringify(n[k] ?? null));
    if (keys.length) out.push({ anchor, person_id: d.id(anchor), keys });
  }
  for (const anchor of d.nu.facts.keys()) if (!d.old.facts.has(anchor)) out.push({ anchor, person_id: d.id(anchor), added: true });
  return out;
}

/** Records the plan names (queue, primaries, aliases, separate) + records whose links moved because of it. */
function involved(d, decisions) {
  const set = new Set(d.oldQueue);
  for (const r of decisions) [r.subject_anchor, r.target_anchor].filter(Boolean).forEach((a) => set.add(a));
  const ip = d.nu.st.identityPlan;
  const anchorOfEmail = (e) => d.nu.st.byEmail.get(e) || `email:${e}`;
  for (const [alias, primary] of ip.plan.alias) { set.add(anchorOfEmail(alias)); set.add(`email:${alias}`); set.add(anchorOfEmail(primary)); }
  for (const p of d.nu.st.persons.values()) if (p.alias_of) set.add(p.anchor);
  const oldLink = new Map(d.old.st.links.map((l) => [`${l.source}|${l.source_id}`, l.anchor]));
  for (const l of d.nu.st.links) { const was = oldLink.get(`${l.source}|${l.source_id}`); if (was && was !== l.anchor) { set.add(was); set.add(l.anchor); } }
  return set;
}

function decisionReport(d) {
  return d.rows.map(([pending, primary, aliases, separate]) => {
    const pa = d.anchorOf.get(pending);
    const o = outcomeOf(pa, d);
    const prim = primary ? d.anchorOf.get(primary) : null;
    const aliasState = aliases.map((a) => { const an = d.anchorOf.get(a); const f = d.nu.facts.get(an); return { person_id: a, state: !f ? 'merged_record_stale' : (f.alias_of === prim ? 'alias_record_under_primary' : 'NOT_MERGED') }; });
    const sepState = separate.map((s) => { const f = d.nu.facts.get(d.anchorOf.get(s)); return { person_id: s, state: f && !f.alias_of && !f.attached_to ? 'kept_separate' : 'CHECK' }; });
    const ok = primary ? o.outcome === 'merged' && (o.into || []).every((x) => x === primary) : o.outcome === 'decided_unmatched';
    return { pending, outcome: primary ? (ok ? 'merged_into_primary' : `CHECK:${o.outcome}`) : (ok ? 'left_unmatched_decided' : `CHECK:${o.outcome}`), primary, aliases: aliasState, separate: sepState };
  });
}

async function main() {
  const sb = serviceClient();
  const src = await loadSources(sb);
  const people = await selectAll(sb, 'customer_person', 'person_id, anchor_key, facts');
  const anchorOf = new Map(people.map((p) => [p.person_id, p.anchor_key]));
  const idOf = new Map(people.map((p) => [p.anchor_key, p.person_id]));
  const { ROWS } = await import('./marketing-identity-decisions-record.mjs');
  const decisions = src.identityDecisions?.length ? src.identityDecisions : anchorsFromRows(decisionRows(), anchorOf);
  const d = { anchorOf, rows: ROWS, id: (a) => idOf.get(a) || `new:${String(a).split(':')[0]}` };
  d.old = computeAll({ ...src, identityRules: false }, TODAY);
  d.nu = computeAll({ ...src, identityDecisions: decisions }, TODAY);
  d.oldQueue = pendingOf(d.old.facts);
  const newQueue = pendingOf(d.nu.facts);
  const outcomes = d.oldQueue.map((a) => ({ person_id: d.id(a), reasons: d.old.facts.get(a).identity_pending, ...outcomeOf(a, d) }));
  const diff = factDiff(d);
  const inv = involved(d, decisions);
  const tally = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  const out = {
    at: new Date().toISOString(), decisions_source: src.identityDecisions?.length ? 'marketing_identity_decisions' : 'record script ROWS (not stored yet)', decision_rows: decisions.length,
    queue_before: d.oldQueue.length, queue_after: newQueue.length, queue_after_ids: newQueue.map(d.id),
    outcome_counts: tally(outcomes, (o) => `${o.outcome}:${(o.rules || []).join('+') || '-'}`), outcomes,
    decision_rows_report: decisionReport(d),
    rules_summary: { aliases: d.nu.st.identityPlan.plan.alias.size, decisions: d.nu.st.identityPlan.decisions, resolved_by_rule: tally([...d.nu.st.identityPlan.resolved.values()], (r) => r) },
    consent_changed_on_kept_records: consentChanges(d),
    facts_changed: { total: diff.length, involved: diff.filter((x) => inv.has(x.anchor)).length, outside_plan: diff.filter((x) => !inv.has(x.anchor)).map(({ anchor, ...x }) => x) },
    records_gone: diff.filter((x) => x.gone).map((x) => ({ person_id: x.person_id, kind: String(x.anchor).split(':')[0] })), records_added: diff.filter((x) => x.added).map((x) => ({ person_id: x.person_id, kind: String(x.anchor).split(':')[0] }))
  };
  if (process.argv.includes('--db')) out.db_vs_memory = dbCompare(people, d.nu);
  if (process.argv.includes('--db-old')) out.db_vs_rules_off = dbCompare(people, d.old);
  if (arg('out')) writeFileSync(arg('out'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ...out, outcomes: `${out.outcomes.length} rows`, decision_rows_report: `${out.decision_rows_report.length} rows`, queue_after_ids: `${newQueue.length} ids` }, null, 2));
}

/** Key-order-insensitive JSON (jsonb re-orders object keys and drops undefined). */
function canonical(v) {
  if (v === undefined || v === null) return 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object') return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** Stored facts vs an in-memory build (rules on after a rebuild; rules off before it = drift): differing anchors, by key. */
function dbCompare(people, build) {
  const live = people.filter((p) => !p.facts?.stale);
  const liveAnchors = new Set(live.map((p) => p.anchor_key));
  const diffs = [];
  for (const p of live) {
    const n = build.facts.get(p.anchor_key);
    if (!n) { diffs.push({ person_id: p.person_id, live_in_db_not_built: true }); continue; }
    const keys = Object.keys({ ...n, ...p.facts }).filter((k) => canonical(n[k]) !== canonical(p.facts[k]));
    if (keys.length) diffs.push({ person_id: p.person_id, keys });
  }
  const builtNotLive = [...build.facts.keys()].filter((a) => !liveAnchors.has(a)).length;
  const byKey = diffs.flatMap((x) => x.keys || ['record']).reduce((m, k) => ({ ...m, [k]: (m[k] || 0) + 1 }), {});
  return { live_db: live.length, built: build.facts.size, differing: diffs.length, differing_keys: byKey, diffs: diffs.slice(0, 40), built_not_live_in_db: builtNotLive };
}

main().catch((e) => { console.error(e.stack || e.message || e); process.exit(1); });
