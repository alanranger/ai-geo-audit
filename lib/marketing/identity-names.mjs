/**
 * Name → email directory and the exact-name rule (Alan, option 1, 9 Nov 2026). Every source that holds a client's
 * name next to an email (Squarespace profiles and order forms, Booking Sheet Workshops / Courses-Classes / PnM Plans
 * rows, the other email-bearing sheet tabs, plan statement files, Memberstack) says "this name has this address".
 * A name-only record whose exact full name names exactly ONE such address is that person (confirmed). Anything else
 * stays its own record: several addresses, a partial / fuzzy name, Alan's own name (owner) or a permanently
 * excluded client's name — never merged into an owner or an owner-excluded record.
 */
import { emailHash, normEmail, normName } from './store.mjs';
import { recordType } from './record-type.mjs';

export const OWNER_EXCLUSION = 'owner_permanent_marketing_exclusion';
export const isAdminEmail = (e) => /@alanranger\.com$/i.test(String(e || ''));

/** Review reasons for records left as their own person (the "undecided — review" queue). */
export const REVIEW_REASONS = { multiple: 'multiple_candidates', fuzzy: 'fuzzy_name', partial: 'partial_name', buyer: 'buyer_only_order_ref' };

const fullName = (...parts) => normName(parts.filter(Boolean).join(' '));

/**
 * guards = { owners: Set(email), excludedHashes: Set(sha256 of email), separated: Set('name:…' anchors) } plus the
 * 10 Nov identity plan (identity-aliases.mjs): alias (address → primary address), pins (name → { email, rule }),
 * unmatched (name anchors Alan left unmatched), heldEmails, rules (false = the 9 Nov behaviour, no rule 3).
 * Sheet rows naming Alan's own or business address never teach a name (a client row can carry Alan's address).
 */
export function newDirectory(guards = {}) {
  return {
    byName: new Map(), bySurname: new Map(), byFirst: new Map(), owners: guards.owners || new Set(), excludedHashes: guards.excludedHashes || new Set(), separated: guards.separated || new Set(),
    alias: guards.alias || new Map(), aliasRule: guards.aliasRule || new Map(), pins: guards.pins || new Map(), unmatched: guards.unmatched || new Set(), heldEmails: guards.heldEmails || new Set(), rules: guards.rules !== false
  };
}

/** The primary address an alias belongs to (the address itself when it is not an alias). */
export const canonicalEmail = (dir, e) => dir.alias?.get(e) || e;

export const isBanned = (dir, email) => { const e = normEmail(email); return !!e && dir.excludedHashes.has(emailHash(e)); };
const isOwnerEmail = (dir, e) => dir.owners.has(e);

function teach(dir, name, email, { ownerSource = false } = {}) {
  const n = normName(name);
  const e = normEmail(email);
  if (!n || !e || isAdminEmail(e) || (isOwnerEmail(dir, e) && !ownerSource)) return;
  if (!dir.byName.has(n)) dir.byName.set(n, new Set());
  dir.byName.get(n).add(e);
  const parts = n.split(' ');
  const surname = parts.length > 1 ? parts[parts.length - 1] : null;
  if (surname) dir.bySurname.set(surname, [...(dir.bySurname.get(surname) || []), { first: parts[0], email: e }]);
  dir.byFirst.set(parts[0], [...(dir.byFirst.get(parts[0]) || []), { first: parts[0], email: e }]);
}

/** Build the directory from loaded rows (pure). */
export function nameDirectory(src, guards) {
  const dir = newDirectory(guards);
  for (const p of src.profiles || []) teach(dir, fullName(p.first_name, p.last_name), p.email, { ownerSource: true });
  for (const m of src.members || []) teach(dir, m.name, m.email, { ownerSource: true });
  for (const o of src.orders || []) if (!o.testmode) teach(dir, fullName(o.attendee_first_name, o.attendee_last_name), o.attendee_email);
  for (const r of [...(src.workshops || []), ...(src.courses || []), ...(src.contacts || [])]) teach(dir, r.client_name, r.email);
  for (const p of [...(src.sheetPlans || []), ...(src.plans || [])]) teach(dir, p.client_name, p.email);
  return dir;
}

const similarFirst = (a, b) => a.startsWith(b) || b.startsWith(a) || (a.length >= 3 && b.length >= 3 && a.slice(0, 3) === b.slice(0, 3));

/** Fuzzy (same surname, similar first name) or partial (one word = a first name) candidates, as primary addresses (raw: as taught). */
export function looseEmails(dir, n, { raw = false } = {}) {
  const parts = n.split(' ');
  const hits = parts.length < 2 ? dir.byFirst.get(n) || [] : (dir.bySurname.get(parts[parts.length - 1]) || []).filter((x) => similarFirst(x.first, parts[0]));
  return [...new Set(hits.map((x) => x.email).filter((e) => !isOwnerEmail(dir, e)).map((e) => (dir.rules && !raw ? canonicalEmail(dir, e) : e)))];
}

/** Rule 3 (10 Nov): exactly one candidate is accepted, unless it is excluded or on a relationship hold. */
const acceptsSingle = (dir, emails) => dir.rules && emails.length === 1 && !isBanned(dir, emails[0]) && !dir.heldEmails.has(emails[0]);

/** No exact match: same surname with a similar first name (fuzzy), or a one-word name matching a first name (partial). */
function looseMatch(dir, n) {
  const emails = looseEmails(dir, n);
  if (!emails.length) return { kind: 'none' };
  const kind = n.includes(' ') ? 'fuzzy' : 'partial';
  if (acceptsSingle(dir, emails)) return { kind: 'unique', email: emails[0], rule: `r3_${kind}` };
  return { kind, count: emails.length };
}

/** An exact name's addresses as people: aliases of one primary count once (rules 1 / 2 / 4 and Alan's alias decisions). */
function exactMatch(dir, n, emails) {
  const people = dir.rules ? [...new Set(emails.map((e) => canonicalEmail(dir, e)))] : emails;
  const rule = people.length < emails.length ? emails.map((e) => dir.aliasRule.get(e)).find(Boolean) || null : null;
  if (people.length === 1) return { kind: 'unique', email: people[0], rule };
  return { kind: 'multiple', count: people.length };
}

/** Alan's decisions on this exact name (unmatched / attach to one address), then the rule pin. */
function decided(dir, n) {
  if (!dir.rules) return null;
  if (dir.unmatched.has(`name:${n}`)) return { kind: 'unmatched' };
  const pin = dir.pins.get(n);
  return pin ? { kind: 'unique', email: canonicalEmail(dir, pin.email), rule: pin.rule } : null;
}

/**
 * { kind: 'unique', email, rule? } | 'multiple' | 'fuzzy' | 'partial' | 'owner' | 'excluded' | 'separated' | 'system' |
 * 'unmatched' | 'none'. Owner wins over everything: a name that is Alan's own is never a client. A permanently excluded
 * client's name never merges anywhere (their records stay as they are). `rule` names the 10 Nov rule / decision used.
 */
export function resolveName(dir, name) {
  const n = normName(name);
  if (!n) return { kind: 'none' };
  const emails = [...(dir.byName.get(n) || [])];
  if (emails.some((e) => isOwnerEmail(dir, e))) return { kind: 'owner' };
  if (emails.some((e) => isBanned(dir, e))) return { kind: 'excluded' };
  const type = recordType({ name });
  if (type === 'system') return { kind: 'system' };
  if (dir.separated.has(`name:${n}`)) return { kind: 'separated' };
  const fixed = decided(dir, n);
  if (fixed) return fixed;
  if (emails.length) return exactMatch(dir, n, emails);
  return type === 'organisation' ? { kind: 'none' } : looseMatch(dir, n);
}

/** Names that are Alan's own (an owner address's profile / member name). */
export function ownerNames(dir) {
  return new Set([...dir.byName].filter(([, emails]) => [...emails].some((e) => isOwnerEmail(dir, e))).map(([n]) => n));
}

/** A sheet row's own address, when it can identify the client: not Alan's business / own address, not excluded. */
export function usableEmail(dir, email) {
  const e = normEmail(email);
  if (!e || !e.includes('@') || isAdminEmail(e) || isOwnerEmail(dir, e) || isBanned(dir, e)) return null;
  return e;
}
