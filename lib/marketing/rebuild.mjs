/**
 * Rebuild customer_person + customer_identity_link from the stored Squarespace sync, the Booking Sheet tables and
 * Memberstack (Academy). Persons are upserted by anchor_key so person_id stays stable between runs; links not seen in a
 * run are removed (their source row went away); persons no longer produced are kept with facts.stale = true.
 */
import { canonicalIndex } from './categories.mjs';
import { allFacts } from './facts.mjs';
import { buildIdentities } from './identity.mjs';
import { normEmail, selectAll, upsertChunks } from './store.mjs';

async function fetchMembers(fetchFn = fetch) {
  const key = process.env.MEMBERSTACK_SECRET_KEY;
  if (!key) return { members: [], available: false };
  const members = [];
  let after = null;
  for (let i = 0; i < 100; i += 1) {
    const q = new URLSearchParams({ limit: '100', ...(after ? { after } : {}) });
    const r = await fetchFn(`https://admin.memberstack.com/members?${q}`, { headers: { 'X-API-KEY': key } });
    if (!r.ok) throw new Error(`memberstack_http_${r.status}`);
    const j = await r.json();
    members.push(...(j.data || []));
    if (!j.hasNextPage) break;
    after = j.endCursor;
  }
  return { members: members.map(memberRow), available: true };
}

function memberRow(m) {
  const plans = m.planConnections || [];
  return {
    id: m.id, email: normEmail(m.auth?.email), name: [m.customFields?.['first-name'], m.customFields?.['last-name']].filter(Boolean).join(' '),
    had_trial: plans.some((p) => /trial/i.test(p.planName || '')),
    active_member: plans.some((p) => p.status === 'ACTIVE' && !/trial/i.test(p.planName || ''))
  };
}

export async function loadSources(sb, { fetchFn } = {}) {
  const [profiles, orders, lines, workshops, courses, transactions, canonical, suppression, geo, engagement, clicks, overrides] = await Promise.all([
    selectAll(sb, 'sqs_profiles', '*'),
    selectAll(sb, 'sqs_orders', '*'),
    selectAll(sb, 'sqs_order_lines', 'order_id, line_index, product_name, line_type, quantity'),
    selectAll(sb, 'booking_sheet_workshop_attendees', 'id, event_start, theme_location, source, order_ref, client_name, is_multi_day'),
    selectAll(sb, 'booking_sheet_course_attendees', 'id, from_date, event_name, booking_ref, client_name, email, is_booking_row'),
    selectAll(sb, 'booking_sheet_transactions', 'source_workbook, source_row, txn_date, client_name, category_label, event_label, channel, is_redemption, amount, funding'),
    selectAll(sb, 'canonical_products', 'product_title, category'),
    selectAll(sb, 'marketing_suppression', 'email_hash, reason, resolved_at'),
    selectAll(sb, 'postcode_geo_cache', 'postcode, lat, lng, status'),
    selectAll(sb, 'marketing_engagement_v', '*'),
    selectAll(sb, 'sqs_email_events', 'email, email_id, url, event_at', (q) => q.eq('event_type', 'CLICKED').neq('url', '')),
    selectAll(sb, 'marketing_identity_overrides', 'name_anchor, action')
  ]);
  const { members, available } = await fetchMembers(fetchFn);
  return { profiles, orders, lines, workshops, courses, transactions, members, members_available: available, canonicalIndex: canonicalIndex(canonical), suppression, geo, engagement, clicks, overrides };
}

function newestOrderByEmail(orders) {
  const out = new Map();
  for (const o of orders) {
    if (!o.customer_email || !o.billing_postcode) continue;
    const prev = out.get(o.customer_email);
    if (!prev || String(o.created_on) > String(prev.created_on)) out.set(o.customer_email, o);
  }
  return out;
}

/** Each person's link clicks (first click time per campaign + link), newest first; tracking parameters dropped. */
const MAX_CLICKS = 60;
export function clicksByEmail(rows) {
  const out = new Map();
  for (const r of rows) {
    if (!r.email || !r.event_at) continue;
    if (!out.has(r.email)) out.set(r.email, []);
    out.get(r.email).push({ url: String(r.url).replace(/[?#].*$/, '').replace(/^https?:\/\/(www\.)?/, '').slice(0, 160), at: r.event_at, email_id: r.email_id });
  }
  for (const [k, v] of out) out.set(k, v.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, MAX_CLICKS));
  return out;
}

export function computeAll(src, today) {
  const st = buildIdentities(src);
  const ctx = {
    today, ordersByEmail: newestOrderByEmail(src.orders),
    geo: new Map(src.geo.filter((g) => g.status === 'ok').map((g) => [g.postcode, g])),
    suppressed: new Map(src.suppression.map((s) => [s.email_hash, s])),
    engagement: new Map((src.engagement || []).map((e) => [e.email, e])),
    clicks: clicksByEmail(src.clicks || []),
    separated: new Set((src.overrides || []).filter((o) => o.action === 'separate').map((o) => o.name_anchor))
  };
  return { st, facts: allFacts(st, ctx) };
}

async function savePersons(sb, st, facts, now) {
  const rows = [...st.persons.values()].map((p) => ({ anchor_key: p.anchor, email: p.email, display_name: p.name || null, facts: facts.get(p.anchor), facts_built_at: now, updated_at: now }));
  await upsertChunks(sb, 'customer_person', rows, 'anchor_key', 300);
  const ids = await selectAll(sb, 'customer_person', 'person_id, anchor_key, facts_built_at');
  const stale = ids.filter((r) => r.facts_built_at !== now && !st.persons.has(r.anchor_key)).map((r) => r.person_id);
  for (let i = 0; i < stale.length; i += 200) await sb.from('customer_person').update({ facts: { stale: true }, facts_built_at: now }).in('person_id', stale.slice(i, i + 200));
  return { idByAnchor: new Map(ids.map((r) => [r.anchor_key, r.person_id])), stale: stale.length };
}

async function saveLinks(sb, st, idByAnchor, now) {
  const rows = [...new Map(st.links.map((l) => [`${l.source}|${l.source_id}`, {
    source: l.source, source_id: l.source_id, person_id: idByAnchor.get(l.anchor), match_method: l.match_method,
    candidate_person_id: l.candidate_anchor ? idByAnchor.get(l.candidate_anchor) || null : null, confirmed: l.confirmed,
    raw_ref: l.raw_ref, detail: l.detail, updated_at: now
  }])).values()];
  await upsertChunks(sb, 'customer_identity_link', rows, 'source,source_id');
  const { error } = await sb.from('customer_identity_link').delete().lt('updated_at', now);
  if (error) throw new Error(`customer_identity_link: ${error.message}`);
  return rows.length;
}

function methodCounts(links) {
  const out = {};
  for (const l of links) out[`${l.source}:${l.match_method}`] = (out[`${l.source}:${l.match_method}`] || 0) + 1;
  return out;
}

/** Squarespace orders whose Booking Sheet row is a different event from the product bought (transfers / reuse of a ref). */
function bookedEventDiffers(st) {
  const words = (s) => new Set(String(s || '').toLowerCase().match(/[a-z]{5,}/g) || []);
  let merged = 0;
  let differs = 0;
  for (const p of st.persons.values()) {
    for (const b of p.bookings.values()) {
      if (!b.purchased_title || !b.event_title) continue;
      merged += 1;
      const a = words(b.purchased_title);
      if (![...words(b.event_title)].some((w) => a.has(w))) differs += 1;
    }
  }
  return { orders_with_sheet_row: merged, different_event: differs };
}

export async function rebuildCustomers(sb, opts = {}) {
  const now = new Date().toISOString();
  const src = await loadSources(sb, opts);
  const { st, facts } = computeAll(src);
  const { idByAnchor, stale } = await savePersons(sb, st, facts, now);
  const links = await saveLinks(sb, st, idByAnchor, now);
  const workshopRefs = src.workshops.filter((w) => /^#0*\d{1,7}$/.test(String(w.order_ref || '').trim())).length;
  const bsSales = [...st.persons.values()].flatMap((p) => p.payments).filter((p) => !p.redemption && p.amount > 0);
  const all = [...facts.values()];
  const types = all.reduce((m, f) => ({ ...m, [f.record_type]: (m[f.record_type] || 0) + 1 }), {});
  return { persons: st.persons.size, links, stale_persons: stale, memberstack_available: src.members_available, workshop_sqs_refs: workshopRefs, admin_orders: st.admin, methods: methodCounts(st.links),
    booking_sheet_sales: { total: bsSales.length, same_as_squarespace_order: bsSales.filter((p) => p.same_sale_as).length },
    record_types: types, attached_under_contact: all.filter((f) => f.attached_to).length, booked_event_differs: bookedEventDiffers(st),
    rows_shown: all.filter((f) => !f.attached_to && f.record_type !== 'system').length };
}
