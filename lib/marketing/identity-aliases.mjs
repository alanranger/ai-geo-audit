/**
 * Identity auto-match rules + Alan's stored identity decisions (10 Nov 2026, Claude QUESTIONs
 * identity-auto-match-rules-jlr-private-email + identity-review-alan-decisions-22). Pure; no I/O.
 * For a review-queue name record whose candidate addresses are really one person:
 *   rule 1  exactly one private address (after rules 2 / 4) plus JLR work addresses → the private one; JLR = alias
 *   rule 2  every candidate shares the same local part (before @) → one person
 *   rule 3  a partial / fuzzy name with exactly one candidate → accepted (identity-names.mjs resolveName)
 *   rule 4  typo addresses: identical once punctuation is removed from the local part, or one character apart
 * Primary = the address with a live Squarespace contact (subscribed first when several), else the most recently used.
 * The other addresses are aliases: their records belong to the primary; an alias's own Squarespace contact stays a
 * record with its own consent, shown under the primary. Never into owner / excluded / relationship-hold records, never
 * across a pair Alan separated. Alan's decisions (marketing_identity_decisions) win over the rules.
 */
import { emailHash, normEmail, normName } from './store.mjs';
import { isAdminEmail, looseEmails } from './identity-names.mjs';

export const JLR_EMAIL = /@(?:[a-z0-9-]+\.)*(?:jaguarlandrover|jlr|jaguar|landrover)\.[a-z.]+$/i;
export const isJlrEmail = (e) => JLR_EMAIL.test(String(e || ''));
export const RULES = { r1: 'r1_jlr_private', r2: 'r2_same_local', r3f: 'r3_fuzzy', r3p: 'r3_partial', r4: 'r4_typo', decision: 'decision' };

const localOf = (e) => String(e).split('@')[0];
const domainOf = (e) => String(e).split('@')[1] || '';
const stripped = (s) => s.replace(/[^a-z0-9]/g, '');

/** At most one insertion, deletion or substitution apart. */
export function oneEditApart(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

/** 'r2' same local part · 'r4' typo (punctuation-insensitive local part on the same domain, or one character apart). */
export function relation(a, b) {
  if (a === b) return null;
  if (localOf(a) === localOf(b)) return 'r2';
  const samePunct = domainOf(a) === domainOf(b) && stripped(localOf(a)) === stripped(localOf(b));
  return samePunct || oneEditApart(a, b) ? 'r4' : null;
}

/** Are all addresses one connected group under rule 2 / 4? Returns the relation kinds used, or null. */
export function connectedGroup(emails) {
  if (emails.length < 2) return emails.length ? new Set() : null;
  const seen = new Set([emails[0]]);
  const kinds = new Set();
  for (let grew = true; grew;) {
    grew = false;
    for (const e of emails) {
      if (seen.has(e)) continue;
      const k = [...seen].map((s) => relation(s, e)).find(Boolean);
      if (k) { seen.add(e); kinds.add(k); grew = true; }
    }
  }
  return seen.size === emails.length ? kinds : null;
}

/** Live Squarespace contact first (subscribed before not subscribed), then most recently used, then address order. */
export function choosePrimary(emails, info) {
  const rank = (e) => {
    const c = info.contact.get(e);
    return [c ? 1 : 0, c?.subscribed ? 1 : 0, info.lastUsed.get(e) || ''];
  };
  const cmp = (a, b) => {
    const [x, y] = [rank(a), rank(b)];
    for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] > y[i] ? -1 : 1;
    return a.localeCompare(b);
  };
  return [...emails].sort(cmp)[0];
}

/** The rule (1, 2 or 4) that makes a candidate set one person, its primary and aliases; null when none applies. */
export function groupRule(candidates, info) {
  const list = [...new Set(candidates.map(normEmail).filter(Boolean))];
  if (list.length < 2) return null;
  const priv = list.filter((e) => !isJlrEmail(e));
  const kinds = priv.length ? connectedGroup(priv) : null;
  if (!kinds) return null;
  const jlr = priv.length < list.length;
  const rule = jlr ? RULES.r1 : (kinds.has('r4') ? RULES.r4 : RULES.r2);
  const primary = choosePrimary(priv, info);
  return { rule, primary, aliases: list.filter((e) => e !== primary), also: jlr && kinds.size ? [...kinds] : [] };
}

const pairKey = (a, b) => [a, b].sort().join('|');

/** Never-merge guard: owner / business / excluded / held addresses, held name records, pairs Alan separated. */
export function guardOk(group, nameAnchor, info) {
  const all = [group.primary, ...group.aliases];
  if (info.heldAnchors.has(nameAnchor) || all.some((e) => info.blocked(e))) return false;
  return !all.some((a) => all.some((b) => a < b && info.separatePairs.has(pairKey(a, b))));
}

/** Facts the rules need: Squarespace contacts, last use per address, blocked addresses, separated pairs. */
export function identityInfo(src, separatePairs = new Set()) {
  const owners = new Set((src.owners || []).map((o) => normEmail(o.email)).filter(Boolean));
  const banned = new Set((src.suppression || []).filter((s) => s.reason === 'owner_permanent_marketing_exclusion' && !s.resolved_at).map((s) => s.email_hash));
  const contact = new Map((src.profiles || []).filter((p) => p.email && !p.missing_since).map((p) => [normEmail(p.email), { subscribed: !!p.accepts_marketing }]));
  const heldAnchors = new Set((src.holds || []).map((h) => h.anchor_key));
  const emailOf = anchorEmailer(src);
  const heldEmails = new Set([...heldAnchors].map(emailOf).filter(Boolean));
  const blocked = (e) => isAdminEmail(e) || owners.has(e) || banned.has(emailHash(e)) || heldEmails.has(e);
  return { contact, lastUsed: lastUsedByEmail(src), heldAnchors, heldEmails, blocked, separatePairs };
}

const USE_DATES = [
  ['orders', (o) => [[o.customer_email, o.created_on], [o.attendee_email, o.created_on]]],
  ['workshops', (r) => [[r.email, r.event_start]]],
  ['courses', (r) => [[r.email, r.from_date]]],
  ['contacts', (r) => [[r.email, r.date_booked || r.event_date]]],
  ['sheetPlans', (r) => [[r.email, r.start_date]]],
  ['plans', (r) => [[r.email, r.starts]]],
  ['members', (m) => [[m.email, m.academy_detail?.joined || m.joined]]],
  ['profiles', (p) => [[p.email, p.last_order_on || p.created_on]]]
];

/** Most recent date each address was used on any record (orders, sheet rows, plans, Academy, Squarespace profile). */
export function lastUsedByEmail(src) {
  const out = new Map();
  for (const [key, pairs] of USE_DATES) {
    for (const row of src[key] || []) {
      for (const [email, date] of pairs(row)) {
        const e = normEmail(email);
        const d = date ? String(date).slice(0, 10) : '';
        if (e && d > (out.get(e) || '')) out.set(e, d);
      }
    }
  }
  return out;
}

/** anchor → the address it stands for: 'email:<address>' or a Squarespace profile 'sqs:<id>'; name records have none. */
export function anchorEmailer(src) {
  const byProfile = new Map((src.profiles || []).map((p) => [`sqs:${p.profile_id}`, normEmail(p.email)]));
  return (anchor) => {
    const a = String(anchor || '');
    if (a.startsWith('email:')) return a.slice(6);
    return byProfile.get(a) || null;
  };
}

export function emptyPlan() {
  return { alias: new Map(), aliasRule: new Map(), pins: new Map(), unmatched: new Set(), separatePairs: new Set() };
}

const nameOf = (anchor) => (String(anchor).startsWith('name:') ? String(anchor).slice(5) : null);

function applyDecision(plan, d, emailOf) {
  if (d.kind === 'unmatched') return nameOf(d.subject_anchor) ? !!plan.unmatched.add(d.subject_anchor) : false;
  const target = emailOf(d.target_anchor);
  if (!target) return false;
  if (d.kind === 'attach') return nameOf(d.subject_anchor) ? !!plan.pins.set(nameOf(d.subject_anchor), { email: target, rule: RULES.decision }) : false;
  const subject = emailOf(d.subject_anchor);
  if (!subject || subject === target) return false;
  if (d.kind === 'separate') return !!plan.separatePairs.add(pairKey(subject, target));
  if (d.kind !== 'alias') return false;
  plan.alias.set(subject, target);
  plan.aliasRule.set(subject, RULES.decision);
  return true;
}

/**
 * Alan's confirmed decisions → plan. rows = active marketing_identity_decisions with anchors resolved
 * ({ kind, subject_anchor, target_anchor }). A decision naming an owner / excluded / held record is never applied.
 */
export function decisionPlan(rows, src, info) {
  const plan = emptyPlan();
  const emailOf = anchorEmailer(src);
  const report = { applied: 0, skipped_guard: 0, skipped_invalid: 0 };
  for (const d of rows || []) {
    const ids = [d.subject_anchor, d.target_anchor].filter(Boolean);
    const guarded = ids.some((a) => info.heldAnchors.has(a) || (emailOf(a) && info.blocked(emailOf(a))));
    if (guarded && d.kind !== 'separate') { report.skipped_guard += 1; continue; }
    if (applyDecision(plan, d, emailOf)) report.applied += 1;
    else report.skipped_invalid += 1;
  }
  return { plan, report };
}

/** Candidate addresses of a name as taught (not yet folded into primaries): exact-name entry, else fuzzy / partial matches. */
export function candidateEmails(dir, name) {
  const n = normName(name);
  const exact = dir.byName.get(n);
  return exact?.size ? [...exact] : looseEmails(dir, n, { raw: true });
}

function addGroup(plan, n, g) {
  if ([g.primary, ...g.aliases].some((e) => plan.alias.has(e) && plan.alias.get(e) !== g.primary)) return false;
  for (const a of g.aliases) { plan.alias.set(a, g.primary); plan.aliasRule.set(a, g.rule); }
  plan.pins.set(n, { email: g.primary, rule: g.rule });
  return true;
}

/**
 * Rules 1, 2 and 4 over the review queue of a first pass (st.review), skipping names Alan decided. Adds to `plan`
 * (decisions already in it win). Returns { anchor → rule } for the records it resolves.
 */
export function rulePlan(first, plan, info) {
  const resolved = new Map();
  for (const anchor of first.review.keys()) {
    const n = nameOf(anchor);
    if (!n || plan.pins.has(n) || plan.unmatched.has(anchor)) continue;
    const g = groupRule(candidateEmails(first.dir, first.persons.get(anchor)?.name || n), info);
    if (g && guardOk(g, anchor, { ...info, separatePairs: new Set([...info.separatePairs, ...plan.separatePairs]) }) && addGroup(plan, n, g)) resolved.set(anchor, g.rule);
  }
  return resolved;
}

/** primary address → its aliases (for facts.aliases). */
export function aliasesByPrimary(plan) {
  const out = new Map();
  for (const [alias, primary] of plan.alias) out.set(primary, [...(out.get(primary) || []), alias]);
  return out;
}
