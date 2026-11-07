/** Customer list / detail for the Marketing tab (admin-key route only). */
import { engagementView } from './engagement.mjs';
import { milesBetween } from './facts.mjs';
import { evaluate, segmentReason } from './segments.mjs';
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
  const people = (await loadPeople(sb)).filter((p) => !p.facts?.stale);
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

export async function customerDetail(sb, personId, params = {}) {
  const { data: p, error } = await sb.from('customer_person').select('person_id, anchor_key, display_name, facts').eq('person_id', personId).maybeSingle();
  if (error || !p) throw new Error('person not found');
  const links = await selectAll(sb, 'customer_identity_link', 'source, source_id, match_method, confirmed, candidate_person_id, raw_ref, detail', (qb) => qb.eq('person_id', personId));
  const candidateOf = await selectAll(sb, 'customer_identity_link', 'source, source_id, match_method, person_id, raw_ref', (qb) => qb.eq('candidate_person_id', personId));
  const ctx = await evalCtx(sb, params);
  const segments = (await allSegments(sb)).map((s) => ({ segment_id: s.segment_id, name: s.name, reason: segmentReason(p.facts, withParams(s.definition, params), ctx) }));
  return { ...row(p, ctx), bookings: p.facts.bookings || [], links, probable_records: candidateOf, segments };
}
