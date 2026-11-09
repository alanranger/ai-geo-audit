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
 * guards = { owners: Set(email), excludedHashes: Set(sha256 of email), separated: Set('name:…' anchors) }.
 * Sheet rows naming Alan's own or business address never teach a name (a client row can carry Alan's address).
 */
export function newDirectory(guards = {}) {
  return { byName: new Map(), bySurname: new Map(), byFirst: new Map(), owners: guards.owners || new Set(), excludedHashes: guards.excludedHashes || new Set(), separated: guards.separated || new Set() };
}

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

/** No exact match: same surname with a similar first name (fuzzy), or a one-word name matching a first name (partial). */
function looseMatch(dir, n) {
  const parts = n.split(' ');
  const single = parts.length < 2;
  const hits = single ? dir.byFirst.get(n) || [] : (dir.bySurname.get(parts[parts.length - 1]) || []).filter((x) => similarFirst(x.first, parts[0]));
  const emails = new Set(hits.map((x) => x.email).filter((e) => !isOwnerEmail(dir, e)));
  if (!emails.size) return { kind: 'none' };
  return { kind: single ? 'partial' : 'fuzzy', count: emails.size };
}

/**
 * { kind: 'unique', email } | 'multiple' | 'fuzzy' | 'partial' | 'owner' | 'excluded' | 'separated' | 'system' | 'none'.
 * Owner wins over everything: a name that is Alan's own is never a client. A permanently excluded client's name never
 * merges anywhere (their records stay as they are).
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
  if (emails.length === 1) return { kind: 'unique', email: emails[0] };
  if (emails.length > 1) return { kind: 'multiple', count: emails.length };
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
