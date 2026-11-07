/**
 * Segment engine (pure). Only currently subscribed, unsuppressed people with a live Squarespace profile can qualify,
 * then the segment's structured query decides (lib/marketing/query): "has done X" needs confirmed records, "has not
 * done X" with probable or incomplete history is undecided — never silently "never". Every person who doesn't
 * qualify gets one reason, so the counts always add up.
 */
import { evalNode, rowCtx } from './query/evaluate.mjs';
import { condText, describe } from './query/english.mjs';

export const DEFAULT_CENTRE = 'CV4 9HW';

/**
 * Built-in segments as structured queries (Claude C8, 7 Nov 2026): one evaluator serves segments, the Customers query
 * builder, saved groups and snapshots, so the same definition gives the same number everywhere. "$max_miles" and
 * "$promoted_date" are filled per campaign (a condition whose parameter isn't set is left out).
 */
const C = (field, op, value = null) => ({ type: 'cond', field, op, value });
const G = (match, items) => ({ type: 'group', match, items });
const Q = (root) => ({ query: { version: 1, root }, version: 1 });
const notOnPromotedDate = C('future_booking', 'none', { on: '$promoted_date' });
const anyCat = (cats) => C('booking', 'exists', { cats });

export const BUILTIN_SEGMENTS = [
  { segment_id: 'beginners-no-lightroom-local', name: 'Beginners booked, no Lightroom, within 30 miles',
    description: 'Booked a beginners course (attendance is not recorded, so "booked", not "graduated"); no Lightroom booking, confirmed or probable; within the radius.',
    definition: Q(G('all', [anyCat(['beginners']), C('booking', 'none', { cats: ['lightroom'] }), C('miles', 'lte', '$max_miles')])) },
  { segment_id: 'local-class-prospects', name: 'Local class prospects (within 30 miles)',
    description: 'Course / tuition history within the radius of the class centre, not already booked on the promoted date. Set the promoted date and radius per campaign.',
    definition: Q(G('all', [anyCat(['course', 'beginners', 'lightroom', 'one_to_one']), C('miles', 'lte', '$max_miles'), notOnPromotedDate])) },
  { segment_id: 'abstract-macro', name: 'Abstract & macro prospects',
    description: 'Workshop or tuition history (abstract/macro, day workshops, woodland, 1-2-1, courses); no radius; excludes anyone booked on the promoted date.',
    definition: Q(G('all', [anyCat(['abstract_macro', 'day_workshop', 'woodland', 'one_to_one', 'course']), notOnPromotedDate])) },
  { segment_id: 'residential-prospects', name: 'Residential prospects (national)',
    description: 'Previous residential or landscape day-workshop customers anywhere in the UK; excludes anyone booked on the promoted date.',
    definition: Q(G('all', [anyCat(['residential', 'day_workshop']), notOnPromotedDate])) },
  { segment_id: 'pick-n-mix', name: 'Pick n Mix prospects',
    description: 'Beginners / course / 1-2-1 learners, excluding anyone with a Pick n Mix payment in the last 12 months (treated as an active plan).',
    definition: Q(G('all', [anyCat(['beginners', 'course', 'lightroom', 'one_to_one']), C('purchase', 'none', { cats: ['pick_n_mix'], within: { n: 12, unit: 'months' } })])) },
  { segment_id: 'christmas-vouchers', name: 'Christmas vouchers: voucher buyers + repeat customers',
    description: 'Bought a gift voucher, bought a place for someone else, or booked 2+ times. The voucher recipient is not the buyer.',
    definition: Q(G('any', [anyCat(['voucher_bought']), C('bought_for_others', 'gte', 1), C('bookings', 'gte', 2)])) },
  { segment_id: 'lapsed-buyers', name: 'Lapsed buyers (last booking over 24 months ago)',
    description: 'Last evidenced booking or order more than 24 months ago and nothing booked ahead. Booking Sheet coverage starts 2024, so older activity is Squarespace only.',
    definition: Q(G('all', [G('any', [C('booking', 'exists', { time: 'past' }), C('purchase', 'exists', {})]), C('booking', 'none', { within: { n: 24, unit: 'months' } }), C('purchase', 'none', { within: { n: 24, unit: 'months' } }), C('future_booking', 'none', {})])) },
  { segment_id: 'academy-trial-unconverted', name: 'Academy trial, not converted',
    description: 'Took an Academy trial and has no active membership; linked by exact email AND separately subscribed to marketing (membership alone is not permission).',
    definition: Q(G('all', [C('academy', 'in', ['trial'])])) }
];

/** Fill "$param" values; a condition whose parameter isn't set is left out (legacy definitions pass through). */
const PARAM = /^\$[a-z_]+$/;
const usesParam = (v) => (typeof v === 'string' ? PARAM.test(v) : !!v && typeof v === 'object' && Object.values(v).some(usesParam));
function fill(v, vals) {
  if (typeof v === 'string' && PARAM.test(v)) return vals[v] ?? null;
  if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, vals)]));
  return v;
}
function fillNode(n, vals) {
  if (n.type === 'group') return { ...n, items: n.items.map((k) => fillNode(k, vals)).filter(Boolean) };
  const value = fill(n.value, vals);
  return usesParam(n.value) && JSON.stringify(value).includes('null') ? null : { ...n, value };
}
export function resolveParams(def, params = {}) {
  if (!def?.query) return def;
  const vals = { $max_miles: Number(params.max_miles) || 30, $promoted_date: params.promoted_date || null };
  return { ...def, query: { ...def.query, root: fillNode(def.query.root, vals) } };
}

/** Base consent gate: first failing reason, or null. */
export function consentReason(f) {
  if (!f || f.stale) return 'no_longer_in_sources';
  if (f.record_type === 'system') return 'system_record';
  if (!f.email) return 'no_email';
  if (f.profile_state === 'none') return 'no_squarespace_profile';
  if (f.profile_state === 'deleted') return 'deleted_in_squarespace';
  if (f.suppressed) return `suppressed:${f.suppressed}`;
  if (!f.subscribed) return 'not_subscribed';
  return null;
}

/** The query's verdict for one person; out = the first top-level condition that isn't a yes, in plain English. */
function queryReason(person, d, ctx) {
  const res = evalNode(d.query.root, { ...rowCtx(person, ctx), windows: ctx.windows });
  if (res.r === 'yes') return null;
  const kid = d.query.root.match === 'all' ? (res.kids || []).find((k) => k.r !== 'yes') : null;
  const text = kid ? (kid.node.type === 'group' ? describe(kid.node, 1) : condText(kid.node)) : describe(d.query.root, 1);
  return `${res.r === 'unknown' ? 'undecided' : 'not'}: ${text}`;
}

/**
 * Segments, saved groups and snapshots all run here (one evaluator, C8): consent gate first, then the query.
 * Alan's business address passes the query (he sees his own sends) but is counted apart, so a segment's count is the
 * same number the Customers query shows for the same definition.
 */
export function personReason(person, d, ctx) {
  const gate = consentReason(person.facts);
  if (gate) return gate;
  if (person.facts?.admin) return null;
  if (!d?.query) return 'not: no structured definition';
  return queryReason(person, d, ctx);
}

/**
 * Evaluate one or more segments over all people → deduplicated audience by email, plus one exclusion reason per
 * person who didn't qualify (for a combined audience: the reason from the first segment).
 */
export function evaluate(people, definitions, ctx) {
  const chosen = new Map();
  const reasons = {};
  let admin = 0;
  for (const person of people) {
    const f = person.facts;
    const why = definitions.map((d) => personReason(person, d, ctx));
    if (!why.some((w) => !w)) { reasons[why[0]] = (reasons[why[0]] || 0) + 1; continue; }
    if (chosen.has(f.email)) { reasons.duplicate_email = (reasons.duplicate_email || 0) + 1; continue; }
    chosen.set(f.email, person);
    if (f.admin) admin += 1;
  }
  return { count: chosen.size - admin, admin_included: admin, members: [...chosen.values()], exclusions: reasons };
}
