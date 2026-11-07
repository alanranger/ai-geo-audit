/**
 * Per-person facts for segments, from buildIdentities() output. History is kept in two evidence levels:
 *   c = confirmed (the person's own records: email / order-number / matching-name links)
 *   p = probable (a Booking Sheet name-only record whose exact name matches this one profile; never merged)
 * Booked ≠ attended: the Booking Sheet has no attendance column, so past bookings are "booked (past)" only.
 * Bookings bought for someone else are kept under bought_for_others, not in the buyer's own history.
 */
import { emailHash, normPostcode } from './store.mjs';
import { valueFacts } from './value.mjs';

const today = () => new Date().toISOString().slice(0, 10);
const when = (b) => b.event_date || b.order_date || null;

function emptyCat() { return { c: 0, p: 0, last_c: null, last_p: null, future_c: 0, future_p: 0 }; }

function bump(cats, cat, level, date, isFuture) {
  const k = cats[cat] || (cats[cat] = emptyCat());
  k[level] += 1;
  if (isFuture) k[`future_${level}`] += 1;
  else if (date && (!k[`last_${level}`] || date > k[`last_${level}`])) k[`last_${level}`] = date;
}

function bookingFacts(person, level, acc, now) {
  for (const b of person.bookings.values()) {
    if (b.cancelled) continue;
    const date = when(b);
    const isFuture = !!b.event_date && b.event_date >= now;
    if (b.role === 'buyer_for_other') { acc.bought_for_others += 1; continue; }
    b.cats.forEach((cat) => bump(acc.cats, cat, level, date, isFuture));
    if (b.channel === 'JLR') acc.jlr[level] += 1;
    if (isFuture) acc.future.push({ date: b.event_date, title: b.title, key: b.key, level, cats: [...b.cats] });
    else if (date) acc[`last_${level}`] = acc[`last_${level}`] && acc[`last_${level}`] > date ? acc[`last_${level}`] : date;
    if (level === 'c') acc.bookings.push({ key: b.key, date, event_date: b.event_date || null, title: b.title || null, cats: [...b.cats], src: [...b.src], role: b.role, channel: b.channel || null });
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

function consent(person, suppressed) {
  const p = person.profile;
  const sup = person.email ? suppressed.get(emailHash(person.email)) : null;
  return {
    subscribed: p ? !!p.accepts_marketing && !p.missing_since : false,
    consent_source: p ? 'squarespace_profile' : 'no_squarespace_profile',
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
  return { ...valueFacts(person, probableFrom, now), ...placeFacts(person), clicks: clicks || [], profile_created: person.profile?.created_on || null };
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
    email: person.email, name: person.name, ...consent(person, ctx.suppressed), ...location(person, ctx.ordersByEmail, ctx.geo),
    ...extraFacts(person, ctx, probableFrom, now),
    cats: acc.cats, future: acc.future.slice(0, 20), bookings: acc.bookings.slice(0, 40), last_booking: acc.last_c, last_booking_probable: acc.last_p,
    bought_for_others: acc.bought_for_others, jlr: acc.jlr, academy: person.academy, sources: person.sources, email_shared: !!person.email_shared,
    engagement: (person.email && ctx.engagement?.get(person.email)) || null, admin: !!person.admin,
    history_incomplete: !person.admin && (probableFrom.length > 0 || (person.profile?.order_count || 0) > linkedOrders)
  };
}

/** Facts for everyone; name-only records feed their unique candidate as probable evidence. */
export function allFacts(st, ctx) {
  const probable = new Map();
  for (const l of st.links) {
    if (!l.candidate_anchor || l.confirmed) continue;
    if (!probable.has(l.candidate_anchor)) probable.set(l.candidate_anchor, new Set());
    probable.get(l.candidate_anchor).add(l.anchor);
  }
  const out = new Map();
  for (const [anchor, person] of st.persons) {
    const from = [...(probable.get(anchor) || [])].map((a) => st.persons.get(a)).filter(Boolean);
    out.set(anchor, personFacts(person, ctx, from));
  }
  return out;
}

export function milesBetween(a, b) {
  if (a?.lat == null || b?.lat == null) return null;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}
