/**
 * Per-person facts for segments, from buildIdentities() output. History is kept in two evidence levels:
 *   c = confirmed (the person's own records: email / order-number / matching-name links)
 *   p = probable (a Booking Sheet name-only record whose exact name matches this one profile; never merged)
 * Booked ≠ attended: the Booking Sheet has no attendance column, so past bookings are "booked (past)" only.
 * Bookings bought for someone else are kept under bought_for_others, not in the buyer's own history.
 */
import { emailHash, normPostcode } from './store.mjs';
import { valueFacts } from './value.mjs';
import { recordType } from './record-type.mjs';
import { consentBasisOf } from './consent-basis.mjs';

const today = () => new Date().toISOString().slice(0, 10);
const when = (b) => b.event_date || b.order_date || null;

function emptyCat() { return { c: 0, p: 0, last_c: null, last_p: null, future_c: 0, future_p: 0 }; }

function bump(cats, cat, level, date, isFuture) {
  const k = cats[cat] || (cats[cat] = emptyCat());
  k[level] += 1;
  if (isFuture) k[`future_${level}`] += 1;
  else if (date && (!k[`last_${level}`] || date > k[`last_${level}`])) k[`last_${level}`] = date;
}

/** The booked event's title, plus the purchased product title when it differs (a transfer or a reused order ref). */
function bookingTitles(b) {
  const title = b.event_title || b.title || null;
  return { title, purchased_title: b.purchased_title && b.purchased_title !== title ? b.purchased_title : null };
}

function bookingFacts(person, level, acc, now) {
  for (const b of person.bookings.values()) {
    if (b.cancelled) continue;
    const date = when(b);
    const isFuture = !!b.event_date && b.event_date >= now;
    if (b.role === 'buyer_for_other') { acc.bought_for_others += 1; continue; }
    b.cats.forEach((cat) => bump(acc.cats, cat, level, date, isFuture));
    if (b.channel === 'JLR') acc.jlr[level] += 1;
    const titles = bookingTitles(b);
    if (isFuture) acc.future.push({ date: b.event_date, ...titles, key: b.key, level, cats: [...b.cats] });
    else if (date) acc[`last_${level}`] = acc[`last_${level}`] && acc[`last_${level}`] > date ? acc[`last_${level}`] : date;
    if (level === 'c') acc.bookings.push({ key: b.key, date, event_date: b.event_date || null, ...titles, cats: [...b.cats], src: [...b.src], role: b.role, channel: b.channel || null });
  }
}

function paymentFacts(person, level, acc) {
  for (const pay of person.payments) {
    pay.cats.forEach((cat) => bump(acc.cats, cat, level, pay.date, false));
    if (pay.channel === 'JLR') acc.jlr[level] += 1;
    if (pay.date && (!acc[`last_${level}`] || pay.date > acc[`last_${level}`])) acc[`last_${level}`] = pay.date;
  }
}

/** Where the person's postcode comes from: Squarespace profile address, else the newest order's billing address. */
function location(person, ordersByEmail, geo) {
  const fromProfile = normPostcode(person.profile?.postcode);
  const order = person.email ? ordersByEmail.get(person.email) : null;
  const postcode = fromProfile || normPostcode(order?.billing_postcode);
  const g = postcode ? geo.get(postcode) : null;
  return { postcode, postcode_source: fromProfile ? 'squarespace_profile' : (postcode ? 'order_billing' : null), lat: g?.lat ?? null, lng: g?.lng ?? null };
}

/** consent_source: Alan's recorded basis (consent-basis.mjs) wins, before and after a Squarespace contact exists. */
function consent(person, suppressed, basis) {
  const p = person.profile;
  const sup = person.email ? suppressed.get(emailHash(person.email)) : null;
  return {
    subscribed: p ? !!p.accepts_marketing && !p.missing_since : false,
    consent_source: consentBasisOf(basis, person.email) || (p ? 'squarespace_profile' : 'no_squarespace_profile'),
    profile_state: p ? (p.missing_since ? 'deleted' : 'active') : 'none',
    suppressed: sup && !sup.resolved_at ? sup.reason : null
  };
}

/** Bookings this person holds a place on (own or as attendee; places bought for others are the buyer's purchase only). */
function placeFacts(person) {
  let bookings = 0;
  let places = 0;
  for (const b of person.bookings.values()) {
    if (b.cancelled || b.role === 'buyer_for_other') continue;
    bookings += 1;
    places += b.money?.places || 1;
  }
  return { booking_count: bookings, places };
}

/** Value, places, link clicks and contact-created date (query builder fields). */
function extraFacts(person, ctx, probableFrom, now) {
  const clicks = person.email ? ctx.clicks?.get(person.email) : null;
  const camps = person.email ? ctx.exposure?.get(person.email) : null;
  return { ...valueFacts(person, probableFrom, now), ...placeFacts(person), clicks: clicks || [], camps: camps || null, academy_detail: person.academy_detail || null, profile_created: person.profile?.created_on || null };
}

/** Facts for one person; `probableFrom` = name-only persons whose candidate is this person. */
export function personFacts(person, ctx, probableFrom = []) {
  const now = ctx.today || today();
  const acc = { cats: {}, future: [], bookings: [], bought_for_others: 0, jlr: { c: 0, p: 0 }, last_c: null, last_p: null };
  bookingFacts(person, 'c', acc, now);
  paymentFacts(person, 'c', acc);
  for (const other of probableFrom) { bookingFacts(other, 'p', acc, now); paymentFacts(other, 'p', acc); }
  const linkedOrders = person.sources.sqs_order || 0;
  return {
    email: person.email, name: person.name, ...consent(person, ctx.suppressed, ctx.consentBasis), ...location(person, ctx.ordersByEmail, ctx.geo),
    ...extraFacts(person, ctx, probableFrom, now),
    cats: acc.cats, future: acc.future.slice(0, 20), bookings: acc.bookings.slice(0, 40), last_booking: acc.last_c, last_booking_probable: acc.last_p,
    bought_for_others: acc.bought_for_others, jlr: acc.jlr, academy: person.academy, sources: person.sources, email_shared: !!person.email_shared,
    engagement: (person.email && ctx.engagement?.get(person.email)) || null, admin: !!person.admin,
    history_incomplete: !person.admin && (probableFrom.length > 0 || (person.profile?.order_count || 0) > linkedOrders)
  };
}

/** Name matches that mean "probably this same person" (not "the other person on an order this contact bought"). */
const SAME_PERSON_METHODS = new Set(['name_probable', 'admin_booking_form_name_probable', 'plan_file_name', 'plan_file_name_only', 'plan_sheet_name', 'plan_sheet_name_only']);
/** A plan's client-name record tied to the plan's email-confirmed client (statement file or PnM Plans tab). */
const PLAN_NAME_METHODS = new Set(['plan_file_name', 'plan_sheet_name']);

/**
 * One row per person (Claude C10): a Booking Sheet name-only record whose exact name matches exactly one contact is
 * shown under that contact as probable history (attached_to), not as a second row. Alan can separate them again
 * (marketing_identity_overrides action 'separate'); a name matching several contacts never attaches.
 */
function attachments(st, separated) {
  const out = new Map();
  const planned = new Map();
  for (const l of st.links) {
    if (!l.candidate_anchor || l.confirmed || !SAME_PERSON_METHODS.has(l.match_method) || separated.has(l.anchor)) continue;
    if (!l.anchor.startsWith('name:')) continue;
    if (PLAN_NAME_METHODS.has(l.match_method)) { planned.set(l.anchor, l.candidate_anchor); continue; }
    if (out.has(l.anchor) && out.get(l.anchor) !== l.candidate_anchor) out.set(l.anchor, null);
    else out.set(l.anchor, l.candidate_anchor);
  }
  for (const [a, to] of planned) out.set(a, to);
  return out;
}

/** Name records a plan (statement file or PnM Plans tab) ties to its email-confirmed client: their sales count as that client's confirmed spend. */
function planConfirmed(st, separated, attached) {
  const out = new Map();
  for (const l of st.links) {
    if (!PLAN_NAME_METHODS.has(l.match_method) || !l.candidate_anchor || separated.has(l.anchor) || attached.get(l.anchor) !== l.candidate_anchor) continue;
    if (!out.has(l.candidate_anchor)) out.set(l.candidate_anchor, new Set());
    out.get(l.candidate_anchor).add(l.anchor);
  }
  return out;
}

/** Facts for everyone; name-only records feed their unique candidate as probable evidence. */
export function allFacts(st, ctx) {
  const separated = ctx.separated || new Set();
  const probable = new Map();
  for (const l of st.links) {
    if (!l.candidate_anchor || l.confirmed || separated.has(l.anchor)) continue;
    if (!probable.has(l.candidate_anchor)) probable.set(l.candidate_anchor, new Set());
    probable.get(l.candidate_anchor).add(l.anchor);
  }
  const attached = attachments(st, separated);
  const confirmed = planConfirmed(st, separated, attached);
  const out = new Map();
  for (const [anchor, person] of st.persons) {
    const plan = confirmed.get(anchor) || new Set();
    const from = [...(probable.get(anchor) || [])].filter((a) => !plan.has(a)).map((a) => st.persons.get(a)).filter(Boolean);
    person.confirmedFrom = [...plan].map((a) => st.persons.get(a)).filter(Boolean);
    const attachedHere = [...attached].filter(([, to]) => to === anchor).map(([a]) => a);
    const alias = aliasFacts(person, st, ctx);
    out.set(anchor, { ...personFacts(person, ctx, from), record_type: recordType(person), attached_to: attached.get(anchor) || alias.alias_of || null, attached_records: attachedHere.length, ...alias, ...manualMarks(anchor, person, ctx, st) });
  }
  return out;
}

/** An alias address's own Squarespace contact and suppression (never merged into the primary's consent). */
function aliasConsent(email, st, ctx) {
  const p = st.profileByAddress?.get(email);
  const sup = ctx.suppressed?.get(emailHash(email));
  return { email, profile_state: p ? (p.missing_since ? 'deleted' : 'active') : 'none', subscribed: p ? !!p.accepts_marketing && !p.missing_since : false, suppressed: sup && !sup.resolved_at ? sup.reason : null };
}

/**
 * 10 Nov aliases: an alias's own Squarespace record sits under its primary (alias_of + attached_to, consent kept);
 * the primary lists its alias addresses with their own consent. Keys only appear when there is an alias.
 */
function aliasFacts(person, st, ctx) {
  const out = {};
  if (person.alias_of) out.alias_of = st.byEmail.get(person.alias_of) || null;
  const list = person.email ? st.aliasesOf?.get(person.email) : null;
  if (list?.length) out.aliases = list.map((e) => aliasConsent(e, st, ctx));
  return out;
}

const OWNER_EXCLUSION = 'owner_permanent_marketing_exclusion';

/**
 * Owner / test (Alan, counted apart, never a client in a list, count or audience): his own addresses, any record
 * carrying his name (identity ownerKind), and clients he permanently excluded (owner_permanent_marketing_exclusion —
 * their suppression and consent are unchanged).
 */
export function ownerKindOf(anchor, person, ctx, st) {
  if (person.email && ctx.owners?.has(person.email)) return 'address';
  const sup = person.email ? ctx.suppressed?.get(emailHash(person.email)) : null;
  if (sup && !sup.resolved_at && sup.reason === OWNER_EXCLUSION) return 'exclusion';
  return st?.ownerKind?.get(anchor) || null;
}

/** A record with no email whose identity is unresolved (several candidates, partial / fuzzy name, buyer-only order ref). */
function pendingReason(anchor, person, st, owner) {
  const reasons = st?.review?.get(anchor);
  return !owner && !person.email && reasons?.size ? [...reasons].sort().join(',') : null;
}

/** Alan's own flags on a person: relationship hold, credits held from cancelled events, owner / test, identity review. */
function manualMarks(anchor, person, ctx, st) {
  const ownerKind = ownerKindOf(anchor, person, ctx, st);
  return { relationship_hold: ctx.holds?.get(anchor) || null, credit_held: ctx.credits?.get(anchor) || [], owner: !!ownerKind, owner_kind: ownerKind, identity_pending: pendingReason(anchor, person, st, ownerKind) };
}

export function milesBetween(a, b) {
  if (a?.lat == null || b?.lat == null) return null;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}
