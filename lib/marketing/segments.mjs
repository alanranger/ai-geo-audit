/**
 * Segment engine (pure). Only currently subscribed, unsuppressed people with a live Squarespace profile can qualify.
 * "Has done X" counts confirmed history (probable only when a segment allows it); "has not done X" treats probable
 * evidence as done, and people with incomplete history are reported separately, never silently counted as "never".
 * Every person who doesn't qualify gets one reason, so the counts always add up.
 */
import { engagementView } from './engagement.mjs';
import { milesBetween } from './facts.mjs';
import { evalNode, rowCtx } from './query/evaluate.mjs';

export const DEFAULT_CENTRE = 'CV4 9HW';

export const BUILTIN_SEGMENTS = [
  { segment_id: 'beginners-no-lightroom-local', name: 'Beginners booked, no Lightroom, within 30 miles',
    description: 'Booked a beginners course (attendance is not recorded, so "booked", not "graduated"); no Lightroom booking or probable Lightroom history.',
    definition: { include_any: ['beginners'], exclude_any: ['lightroom'], distance: { max_miles: 30 }, separate_incomplete: true } },
  { segment_id: 'local-class-prospects', name: 'Local class prospects (within 30 miles)',
    description: 'Course / tuition history within 30 miles of the class centre, not already booked on the promoted date. Set the promoted date and radius per campaign.',
    definition: { include_any: ['course', 'beginners', 'lightroom', 'one_to_one'], distance: { max_miles: 30 }, exclude_booked_on_date: null } },
  { segment_id: 'abstract-macro', name: 'Abstract & macro prospects',
    description: 'Workshop or tuition history (abstract/macro, day workshops, woodland, 1-2-1, courses); no radius; excludes anyone booked on the promoted date.',
    definition: { include_any: ['abstract_macro', 'day_workshop', 'woodland', 'one_to_one', 'course'], exclude_booked_on_date: null } },
  { segment_id: 'residential-prospects', name: 'Residential prospects (national)',
    description: 'Previous residential or landscape day-workshop customers anywhere in the UK; excludes anyone booked on the promoted date.',
    definition: { include_any: ['residential', 'day_workshop'], exclude_booked_on_date: null } },
  { segment_id: 'pick-n-mix', name: 'Pick n Mix prospects',
    description: 'Beginners / course / 1-2-1 learners, excluding anyone with a Pick n Mix payment in the last 12 months (treated as an active plan).',
    definition: { include_any: ['beginners', 'course', 'lightroom', 'one_to_one'], exclude_recent: { cat: 'pick_n_mix', months: 12 } } },
  { segment_id: 'christmas-vouchers', name: 'Christmas vouchers: voucher buyers + repeat customers',
    description: 'Bought a gift voucher, bought a place for someone else, or booked 2+ times. The voucher recipient is not the buyer.',
    definition: { any_of: [{ include_any: ['voucher_bought'] }, { gift_buyer: true }, { min_bookings: 2 }] } },
  { segment_id: 'lapsed-buyers', name: 'Lapsed buyers (last booking over 24 months ago)',
    description: 'Last evidenced booking or order more than 24 months ago and nothing booked ahead. Booking Sheet coverage starts 2024, so older activity is Squarespace only.',
    definition: { last_booking_older_than_months: 24, no_future_bookings: true } },
  { segment_id: 'academy-trial-unconverted', name: 'Academy trial, not converted',
    description: 'Took an Academy trial and has no active membership; linked by exact email AND separately subscribed to marketing (membership alone is not permission).',
    definition: { academy: 'trial' } }
];

const monthsAgo = (today, m) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - m);
  return d.toISOString().slice(0, 10);
};

/** Base consent gate: first failing reason, or null. */
export function consentReason(f) {
  if (!f || f.stale) return 'no_longer_in_sources';
  if (!f.email) return 'no_email';
  if (f.profile_state === 'none') return 'no_squarespace_profile';
  if (f.profile_state === 'deleted') return 'deleted_in_squarespace';
  if (f.suppressed) return `suppressed:${f.suppressed}`;
  if (!f.subscribed) return 'not_subscribed';
  return null;
}

const hasCat = (f, cat, allowProbable) => { const k = f.cats?.[cat]; return !!k && (k.c > 0 || (allowProbable && k.p > 0)); };
const confirmedBookings = (f) => (f.bookings || []).filter((b) => b.role !== 'buyer_for_other').length;

function historyReason(f, d) {
  if (d.include_any && !d.include_any.some((c) => hasCat(f, c, d.allow_probable))) return 'no_matching_history';
  const hit = (d.exclude_any || []).find((c) => hasCat(f, c, true));
  if (hit) return `has_history:${hit}`;
  if (d.separate_incomplete && f.history_incomplete) return 'history_incomplete';
  if (d.min_bookings && confirmedBookings(f) < d.min_bookings) return 'fewer_bookings';
  if (d.gift_buyer && !(f.bought_for_others > 0)) return 'not_a_gift_buyer';
  return null;
}

function anyOfReason(f, d) {
  if (!d.any_of) return null;
  return d.any_of.some((sub) => !historyReason(f, sub)) ? null : 'no_matching_history';
}

function distanceReason(f, d, centre) {
  if (!d.distance?.max_miles) return null;
  const miles = milesBetween(centre, f);
  if (miles == null) return d.distance.include_unknown ? null : 'distance_unknown';
  return miles > d.distance.max_miles ? 'too_far' : null;
}

function lapsedReason(f, d, today) {
  if (!d.last_booking_older_than_months) return null;
  const cut = monthsAgo(today, d.last_booking_older_than_months);
  if (!f.last_booking) return 'no_evidenced_booking';
  if (f.last_booking >= cut || (f.last_booking_probable && f.last_booking_probable >= cut)) return 'booked_recently';
  return null;
}

function recentCatReason(f, d, today) {
  if (!d.exclude_recent) return null;
  const k = f.cats?.[d.exclude_recent.cat];
  const last = [k?.last_c, k?.last_p].filter(Boolean).sort().pop();
  return last && last >= monthsAgo(today, d.exclude_recent.months) ? `recent:${d.exclude_recent.cat}` : null;
}

function timingReason(f, d, today) {
  if (d.no_future_bookings && f.future?.length) return 'has_future_booking';
  if (d.exclude_booked_on_date && f.future?.some((b) => b.date === d.exclude_booked_on_date)) return 'already_booked_that_date';
  return lapsedReason(f, d, today) || recentCatReason(f, d, today);
}

/**
 * Release 2: engagement bands (opens and clicks separately) and recent exposure. Unknown engagement only fails a rule
 * that explicitly asks for a known band; it is never read as cold / never opened.
 */
function engagementReason(f, d, ctx) {
  if (d.exclude_emailed_within_days && f.engagement?.last_delivered_at) {
    const days = (Date.parse(`${ctx.today}T00:00:00Z`) - Date.parse(f.engagement.last_delivered_at)) / 86400000;
    if (days < d.exclude_emailed_within_days) return 'recently_emailed';
  }
  if (!d.engagement) return null;
  const v = engagementView(f.engagement, ctx.engagementComplete, ctx.windows, ctx.today);
  const want = new Set(d.engagement.bands || []);
  const signal = d.engagement.signal || 'any';
  const ok = signal === 'any' ? (want.has(v.open) || want.has(v.click)) : want.has(v[signal]);
  return ok ? null : `engagement:${signal === 'click' ? v.click : v.open}`;
}

function academyReason(f, d) {
  if (!d.academy) return null;
  if (f.academy === 'member') return 'academy_member';
  return f.academy === d.academy ? null : 'not_academy_trial';
}

/** Alan's own business address is never a customer but always receives the campaign (so he sees his own sends). */
export function segmentReason(f, d, ctx) {
  if (f?.admin) return consentReason(f);
  return consentReason(f) || anyOfReason(f, d) || (d.any_of ? null : historyReason(f, d)) || academyReason(f, d)
    || distanceReason(f, d, ctx.centre) || timingReason(f, d, ctx.today) || engagementReason(f, d, ctx);
}

/** Saved query groups: the same consent gate first, then the query; an undecided (unknown) result never qualifies. */
function queryReason(person, d, ctx) {
  const r = evalNode(d.query.root, { ...rowCtx(person, ctx), windows: ctx.windows }).r;
  if (r === 'yes') return null;
  return r === 'unknown' ? 'query:unknown' : 'query:not_matched';
}

export function personReason(person, d, ctx) {
  if (!d.query) return segmentReason(person.facts, d, ctx);
  const gate = consentReason(person.facts);
  return gate || (person.facts?.admin ? null : queryReason(person, d, ctx));
}

/**
 * Evaluate one or more segments over all people → deduplicated audience by email, plus one exclusion reason per
 * person who didn't qualify (for a combined audience: the reason from the first segment).
 */
export function evaluate(people, definitions, ctx) {
  const chosen = new Map();
  const reasons = {};
  for (const person of people) {
    const f = person.facts;
    const why = definitions.map((d) => personReason(person, d, ctx));
    if (why.some((w) => !w)) {
      const key = f.email;
      if (chosen.has(key)) reasons.duplicate_email = (reasons.duplicate_email || 0) + 1;
      else chosen.set(key, person);
    } else reasons[why[0]] = (reasons[why[0]] || 0) + 1;
  }
  return { count: chosen.size, members: [...chosen.values()], exclusions: reasons };
}
