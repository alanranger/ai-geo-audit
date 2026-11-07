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
  const [profiles, orders, lines, workshops, courses, transactions, canonical, suppression, geo, engagement] = await Promise.all([
    selectAll(sb, 'sqs_profiles', '*'),
    selectAll(sb, 'sqs_orders', '*'),
    selectAll(sb, 'sqs_order_lines', 'order_id, line_index, product_name, line_type'),
    selectAll(sb, 'booking_sheet_workshop_attendees', 'id, event_start, theme_location, source, order_ref, client_name, is_multi_day'),
    selectAll(sb, 'booking_sheet_course_attendees', 'id, from_date, event_name, booking_ref, client_name, email, is_booking_row'),
    selectAll(sb, 'booking_sheet_transactions', 'source_workbook, source_row, txn_date, client_name, category_label, event_label, channel, is_redemption'),
    selectAll(sb, 'canonical_products', 'product_title, category'),
    selectAll(sb, 'marketing_suppression', 'email_hash, reason, resolved_at'),
    selectAll(sb, 'postcode_geo_cache', 'postcode, lat, lng, status'),
    selectAll(sb, 'marketing_engagement_v', '*')
  ]);
  const { members, available } = await fetchMembers(fetchFn);
  return { profiles, orders, lines, workshops, courses, transactions, members, members_available: available, canonicalIndex: canonicalIndex(canonical), suppression, geo, engagement };
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

export function computeAll(src, today) {
  const st = buildIdentities(src);
  const ctx = {
    today, ordersByEmail: newestOrderByEmail(src.orders),
    geo: new Map(src.geo.filter((g) => g.status === 'ok').map((g) => [g.postcode, g])),
    suppressed: new Map(src.suppression.map((s) => [s.email_hash, s])),
    engagement: new Map((src.engagement || []).map((e) => [e.email, e]))
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

export async function rebuildCustomers(sb, opts = {}) {
  const now = new Date().toISOString();
  const src = await loadSources(sb, opts);
  const { st, facts } = computeAll(src);
  const { idByAnchor, stale } = await savePersons(sb, st, facts, now);
  const links = await saveLinks(sb, st, idByAnchor, now);
  const workshopRefs = src.workshops.filter((w) => /^#0*\d{1,7}$/.test(String(w.order_ref || '').trim())).length;
  return { persons: st.persons.size, links, stale_persons: stale, memberstack_available: src.members_available, workshop_sqs_refs: workshopRefs, methods: methodCounts(st.links) };
}
