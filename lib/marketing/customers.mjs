/** Customer list / detail for the Marketing tab (admin-key route only). */
import { engagementView } from './engagement.mjs';
import { milesBetween } from './facts.mjs';
import { evaluate, personReason } from './segments.mjs';
import { explain } from './query/table.mjs';
import { isListed } from './record-type.mjs';
import { allSegments, evalCtx, loadPeople, withParams } from './overview.mjs';
import { normName, selectAll } from './store.mjs';

const PAGE_SIZE = 50;

const DEFAULTS = { email: null, suppressed: null, postcode: null, postcode_source: null, cats: {}, last_booking: null, last_booking_probable: null, future: [], academy: null, bought_for_others: 0, sources: {} };

function row(p, ctx) {
  const f = { ...DEFAULTS, ...Object.fromEntries(Object.entries(p.facts || {}).filter(([, v]) => v != null)) };
  const miles = milesBetween(ctx.centre, f);
  return {
    person_id: p.person_id, kind: f.admin ? 'admin' : p.anchor_key.split(':')[0], name: f.name || p.display_name || null, email: f.email,
    subscribed: !!f.subscribed, suppressed: f.suppressed, profile_state: f.profile_state, postcode: f.postcode,
    postcode_source: f.postcode_source, miles: miles == null ? null : Math.round(miles), cats: f.cats,
    last_booking: f.last_booking, last_booking_probable: f.last_booking_probable, future: f.future,
    academy: f.academy, history_incomplete: !!f.history_incomplete, bought_for_others: f.bought_for_others, sources: f.sources,
    engagement: engagementView(f.engagement, ctx.engagementComplete, ctx.windows, ctx.today)
  };
}

const matches = (p, q) => !q || normName(p.display_name).includes(q) || String(p.facts?.email || '').includes(q);

export async function listCustomers(sb, { q, segment_id: segId, params = {}, page = 0, subscribed_only: subOnly } = {}) {
  const people = (await loadPeople(sb)).filter((p) => isListed(p.facts));
  const ctx = await evalCtx(sb, params);
  const query = normName(q || '') || String(q || '').trim().toLowerCase();
  let rows = people.filter((p) => matches(p, query) && (!subOnly || p.facts.subscribed));
  if (segId) {
    const seg = (await allSegments(sb)).find((s) => s.segment_id === segId);
    if (!seg) throw new Error('unknown segment');
    rows = evaluate(rows, [withParams(seg.definition, params)], ctx).members;
  }
  rows.sort((a, b) => String(b.facts.last_booking || '').localeCompare(String(a.facts.last_booking || '')));
  const start = Number(page) * PAGE_SIZE;
  return { total: rows.length, page: Number(page), page_size: PAGE_SIZE, centre: ctx.centre, rows: rows.slice(start, start + PAGE_SIZE).map((p) => row(p, ctx)) };
}

export async function customerDetail(sb, personId, params = {}, query = null) {
  const { data: p, error } = await sb.from('customer_person').select('person_id, anchor_key, display_name, facts').eq('person_id', personId).maybeSingle();
  if (error || !p) throw new Error('person not found');
  const links = await selectAll(sb, 'customer_identity_link', 'source, source_id, match_method, confirmed, candidate_person_id, raw_ref, detail', (qb) => qb.eq('person_id', personId));
  const candidateOf = await selectAll(sb, 'customer_identity_link', 'source, source_id, match_method, person_id, raw_ref', (qb) => qb.eq('candidate_person_id', personId));
  const attachedIds = [...new Set(candidateOf.map((l) => l.person_id))];
  const { data: attached } = attachedIds.length ? await sb.from('customer_person').select('person_id, display_name, attached:facts->>attached_to').in('person_id', attachedIds.slice(0, 50)) : { data: [] };
  const ctx = await evalCtx(sb, params);
  const segments = (await allSegments(sb)).map((s) => ({ segment_id: s.segment_id, name: s.name, reason: personReason(p, withParams(s.definition, params), ctx) }));
  const why = query ? explain(p, query, ctx) : null;
  const shownUnder = (attached || []).map((a) => ({ person_id: a.person_id, name: a.display_name, attached: !!a.attached, links: candidateOf.filter((l) => l.person_id === a.person_id).length }));
  return { ...row(p, ctx), record_type: p.facts.record_type || 'person', bookings: p.facts.bookings || [], links, probable_records: candidateOf, shown_under: shownUnder, segments, why, value: p.facts.value || null, timeline: await timeline(sb, p) };
}

const tl = (date, kind, text, extra = {}) => ({ date: date ? String(date).slice(0, 10) : null, at: date || null, kind, text, ...extra });

const SRC = { squarespace: 'Squarespace order', booking_sheet: 'Booking Sheet sale', plan: 'Plan payment' };
/** The purchase that paid for a booking (same Squarespace order), if this person bought it. */
const paidFor = (f, b) => (f.purchases || []).find((x) => x.key && x.key === b.key) || null;
function bookingText(b, paid) {
  const what = b.title || 'Booking';
  const was = b.purchased_title ? ` (bought as: ${b.purchased_title})` : '';
  if (paid?.plan_funded && !paid.net) return `${what}${was} — paid from Pick n Mix plan ${paid.plan_funded}`;
  if (!paid) return `${what}${was} — ${b.role === 'attendee' ? 'place bought by someone else / admin booking' : 'payment on the Booking Sheet'}`;
  return `${what}${was}`;
}
function purchaseText(x) {
  const order = x.key?.startsWith('sqs:') ? ` #${x.key.slice(4)}` : '';
  const plan = x.plan_funded && !x.net ? ` — paid from Pick n Mix plan ${x.plan_funded}` : '';
  const dup = x.duplicate_of ? ` — £${Math.round(x.dup_net)} is the same sale as ${x.duplicate_of} (not added again)` : '';
  return `${SRC[x.src] || 'Sale'}${order}${x.title ? `: ${x.title}` : ''}${plan}${dup}`;
}

/** Orders / sales, bookings (past and upcoming), emails received / opened / clicked, consent changes — newest first. */
async function timeline(sb, p) {
  const f = p.facts || {};
  const items = [
    ...(f.purchases || []).map((x) => tl(x.date, 'purchase', purchaseText(x), { amount: x.net, refunded: x.refunded || null, level: x.level, cancelled: !!x.cancelled && !x.duplicate_of, duplicate: !!x.duplicate_of, for_other: !!x.for_other, src: x.src })),
    ...(f.plans || []).map((pl) => tl(pl.starts, 'plan', `Pick n Mix plan${pl.plan_type ? ` · ${pl.plan_type}` : ''}${pl.ends ? ` · to ${pl.ends}` : ''} · paid £${Math.round(pl.paid_total)} (plan statement)`, { amount: null })),
    ...(f.bookings || []).map((b) => tl(b.event_date || b.date, b.event_date && b.event_date >= new Date().toISOString().slice(0, 10) ? 'upcoming' : 'booking', bookingText(b, paidFor(f, b)), { role: b.role, src: (b.src || []).join(' + '), amount: paidFor(f, b)?.net ?? null })),
    ...(f.future || []).filter((b) => b.level === 'p').map((b) => tl(b.date, 'upcoming', `${b.title || 'Booking'} (probable, name match)`, { level: 'p' }))
  ];
  if (f.email) items.push(...await emailTimeline(sb, f.email));
  if (f.suppressed) items.push(tl(null, 'consent', `Suppressed: ${f.suppressed}`));
  return items.sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 300);
}

async function emailTimeline(sb, email) {
  const { data: events, error } = await sb.from('sqs_email_events').select('email_id, event_type, url, event_at').eq('email', email).order('event_at', { ascending: false }).limit(600);
  if (error) throw new Error(error.message);
  if (!events?.length) return [];
  const ids = [...new Set(events.map((e) => e.email_id))];
  const camps = await selectAll(sb, 'sqs_email_campaigns', 'email_id, subject', (q) => q.in('email_id', ids.slice(0, 300)));
  const subj = new Map(camps.map((c) => [c.email_id, c.subject]));
  const VERB = { DELIVERED: 'Received', OPENED: 'Opened', CLICKED: 'Clicked', UNSUBSCRIBED: 'Unsubscribed from' };
  return events.map((e) => tl(e.event_at, `email_${e.event_type.toLowerCase()}`, `${VERB[e.event_type] || e.event_type} "${subj.get(e.email_id) || e.email_id}"${e.url ? ` → ${String(e.url).replace(/[?#].*$/, '').slice(0, 100)}` : ''}`));
}
