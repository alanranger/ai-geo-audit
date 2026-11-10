/**
 * Rebuild customer_person + customer_identity_link from the stored Squarespace sync, the Booking Sheet tables and
 * Memberstack (Academy). Persons are upserted by anchor_key so person_id stays stable between runs; links not seen in a
 * run are removed (their source row went away); persons no longer produced are kept with facts.stale = true.
 */
import { canonicalIndex } from './categories.mjs';
import { allFacts } from './facts.mjs';
import { buildIdentities } from './identity.mjs';
import { normEmail, selectAll, upsertChunks } from './store.mjs';
import { recordType } from './record-type.mjs';
import { shortId } from './query/topics.mjs';
import { creditMarker } from '../strategy-run-rate.mjs';

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
  const isTrial = (p) => /trial/i.test(`${p.planName || ''} ${p.type || ''}`) || p.status === 'TRIALING';
  return {
    id: m.id, email: normEmail(m.auth?.email), name: [m.customFields?.['first-name'], m.customFields?.['last-name']].filter(Boolean).join(' '),
    had_trial: plans.some(isTrial),
    active_member: plans.some((p) => p.status === 'ACTIVE' && !isTrial(p)),
    trialing: plans.some((p) => isTrial(p) && ['ACTIVE', 'TRIALING'].includes(p.status)),
    cancelled_paid: plans.some((p) => !isTrial(p) && /CANCEL/.test(p.status || '')),
    joined: m.createdAt ? String(m.createdAt).slice(0, 10) : null
  };
}

/** Academy trial dates (Academy Supabase academy_trial_history), keyed by Memberstack id; empty when not configured. */
async function trialHistory() {
  const url = process.env.ACADEMY_SUPABASE_URL;
  const key = process.env.ACADEMY_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new Map();
  const r = await fetch(`${url}/rest/v1/academy_trial_history?select=member_id,trial_start_at,trial_end_at,converted_at&limit=10000`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) return new Map();
  const rows = await r.json();
  return new Map(rows.map((t) => [t.member_id, { start: String(t.trial_start_at || '').slice(0, 10) || null, end: String(t.trial_end_at || '').slice(0, 10) || null, converted: String(t.converted_at || '').slice(0, 10) || null }]));
}

/** One Academy status per member: paid_active / trial_active / trial_expired / cancelled / account_only. */
export function academyStatus(m, trial, today) {
  if (m.active_member) return 'paid_active';
  if (m.trialing || (trial?.end && trial.end >= today && !trial.converted)) return 'trial_active';
  if (m.cancelled_paid) return 'cancelled';
  if (m.had_trial || trial?.start) return 'trial_expired';
  return 'account_only';
}

async function membersWithStatus(fetchFn) {
  const { members, available } = await fetchMembers(fetchFn);
  const trials = available ? await trialHistory().catch(() => new Map()) : new Map();
  const today = new Date().toISOString().slice(0, 10);
  for (const m of members) {
    const t = trials.get(m.id) || null;
    m.academy_detail = { status: academyStatus(m, t, today), joined: m.joined, trial_start: t?.start || null, trial_end: t?.end || null, converted: t?.converted || null };
  }
  return { members, available, trial_history: trials.size };
}

const WORKSHOP_COLS = 'id, event_start, theme_location, source, order_ref, client_name, is_multi_day';
/** Workshops with their Email Address column (migration booking_sheet_contact_emails_20261109); without it before then. */
export const loadWorkshops = (sb) => selectAll(sb, 'booking_sheet_workshop_attendees', `${WORKSHOP_COLS}, email`).catch(() => selectAll(sb, 'booking_sheet_workshop_attendees', WORKSHOP_COLS));
/** Name ↔ email rows from the other email-bearing sheet tabs; none until the table exists. */
export const loadContacts = (sb) => selectAll(sb, 'booking_sheet_tab_contacts', 'id, tab, client_name, email, date_booked, event_date').catch(() => []);

/**
 * Alan's active identity decisions (marketing_identity_decisions, 10 Nov 2026), stored by person_id and resolved to
 * anchors here (person_ids are stable per anchor, also for records that went stale). None until the table exists.
 */
export async function loadIdentityDecisions(sb) {
  const rows = await selectAll(sb, 'marketing_identity_decisions', 'kind, subject_person_id, target_person_id', (q) => q.is('cleared_at', null)).catch(() => []);
  const ids = [...new Set(rows.flatMap((r) => [r.subject_person_id, r.target_person_id]).filter(Boolean))];
  if (!ids.length) return [];
  const people = await selectAll(sb, 'customer_person', 'person_id, anchor_key', (q) => q.in('person_id', ids));
  const anchor = new Map(people.map((p) => [p.person_id, p.anchor_key]));
  return rows.map((r) => ({ kind: r.kind, subject_anchor: anchor.get(r.subject_person_id) || null, target_anchor: r.target_person_id ? anchor.get(r.target_person_id) || null : null }));
}

export async function loadSources(sb, { fetchFn } = {}) {
  const [profiles, orders, lines, workshops, courses, transactions, canonical, suppression, geo, engagement, clicks, overrides, contacts] = await Promise.all([
    selectAll(sb, 'sqs_profiles', '*'),
    selectAll(sb, 'sqs_orders', '*'),
    selectAll(sb, 'sqs_order_lines', 'order_id, line_index, product_name, line_type, quantity'),
    loadWorkshops(sb),
    selectAll(sb, 'booking_sheet_course_attendees', 'id, from_date, event_name, booking_ref, client_name, email, is_booking_row'),
    selectAll(sb, 'booking_sheet_transactions', 'source_workbook, source_row, txn_date, client_name, category_label, event_label, channel, is_redemption, amount, funding'),
    selectAll(sb, 'canonical_products', 'product_title, category'),
    selectAll(sb, 'marketing_suppression', 'email_hash, reason, resolved_at'),
    selectAll(sb, 'postcode_geo_cache', 'postcode, lat, lng, status'),
    selectAll(sb, 'marketing_engagement_v', '*'),
    selectAll(sb, 'sqs_email_events', 'email, email_id, url, event_at', (q) => q.eq('event_type', 'CLICKED').neq('url', '')),
    selectAll(sb, 'marketing_identity_overrides', 'name_anchor, action'),
    loadContacts(sb)
  ]);
  const [sheetPlans, plans, planPayments, planEvents] = await Promise.all([
    selectAll(sb, 'booking_sheet_plans', 'id, plan_id, client_name, email, start_date, end_date, plan_type, plan_value, payment, status, source_row'),
    selectAll(sb, 'pnm_plans', 'plan_key, source_file, client_name, email, plan_type, starts, ends, paid_total'),
    selectAll(sb, 'pnm_plan_payments', 'plan_key, line_no, amount, paid_on, date_reliable, scheduled_only'),
    selectAll(sb, 'pnm_plan_events', 'plan_key, line_no, item, price_after, event_date, order_ref')
  ]);
  const exposure = await selectAll(sb, 'marketing_campaign_exposure_v', 'email, d, o, k');
  const holds = await selectAll(sb, 'marketing_relationship_holds', 'hold_id, anchor_key, reason, set_by, set_at', (q) => q.is('cleared_at', null));
  const owners = await selectAll(sb, 'marketing_owner_addresses', 'email', (q) => q.is('cleared_at', null));
  const credits = await heldCredits(sb).catch(() => []);
  const identityDecisions = await loadIdentityDecisions(sb);
  const { members, available, trial_history: trialRows } = await membersWithStatus(fetchFn);
  return { profiles, orders, lines, workshops, courses, transactions, contacts, members, members_available: available, trial_history: trialRows, canonicalIndex: canonicalIndex(canonical), suppression, geo, engagement, clicks, overrides, sheetPlans, plans, planPayments, planEvents, exposure, holds, owners, credits, identityDecisions };
}

/** Credits still held from cancelled events (strategy_event_outcomes, linked to a person), with that person's anchor. */
async function heldCredits(sb) {
  const rows = await selectAll(sb, 'strategy_event_outcomes', 'run_key, event_date, event_title, cancelled, credit_held_count, credit_held_person_id, credit_used_on, set_at', (q) => q.not('credit_held_person_id', 'is', null).is('credit_used_on', null));
  const ids = [...new Set(rows.map((r) => r.credit_held_person_id))];
  if (!ids.length) return [];
  const { data } = await sb.from('customer_person').select('person_id, anchor_key').in('person_id', ids);
  const anchor = new Map((data || []).map((p) => [p.person_id, p.anchor_key]));
  return rows.map((r) => ({ ...r, anchor_key: anchor.get(r.credit_held_person_id) || null }));
}

/** Credit markers by person anchor → facts.credit_held (same marker the outcomes API writes on save). */
export function creditsByAnchor(rows) {
  const out = new Map();
  for (const r of rows || []) {
    const m = r.anchor_key && creditMarker(r);
    if (m) out.set(r.anchor_key, [...(out.get(r.anchor_key) || []), m]);
  }
  return out;
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

/** Active relationship holds (Alan's manual flag) by person anchor → facts.relationship_hold. */
export const holdsByAnchor = (rows) => new Map(rows.map((h) => [h.anchor_key, { hold_id: h.hold_id, reason: h.reason, set_by: h.set_by, set_at: h.set_at }]));

export function computeAll(src, today) {
  const st = buildIdentities(src);
  const ctx = {
    today, ordersByEmail: newestOrderByEmail(src.orders),
    geo: new Map(src.geo.filter((g) => g.status === 'ok').map((g) => [g.postcode, g])),
    suppressed: new Map(src.suppression.map((s) => [s.email_hash, s])),
    engagement: new Map((src.engagement || []).map((e) => [e.email, e])),
    clicks: clicksByEmail(src.clicks || []),
    exposure: new Map((src.exposure || []).map((x) => [x.email, { d: (x.d || []).map(shortId), o: (x.o || []).map(shortId), k: (x.k || []).map(shortId) }])),
    separated: new Set((src.overrides || []).filter((o) => o.action === 'separate').map((o) => o.name_anchor)),
    holds: holdsByAnchor(src.holds || []),
    credits: creditsByAnchor(src.credits || []),
    owners: new Set((src.owners || []).map((o) => normEmail(o.email)).filter(Boolean))
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

/** Plan payments counted, matched to existing money, and ledger-label income still not attributable to a person. */
function planSummary(st) {
  const pays = [...st.persons.values()].flatMap((p) => p.plan_payments || []);
  const placeholders = [...st.persons.values()].filter((p) => recordType({ name: p.name }) === 'system').flatMap((p) => p.payments);
  const open = placeholders.filter((x) => !x.redemption && x.amount > 0 && !x.plan_attributed && !x.same_sale_as);
  return {
    ...st.plan, payments: pays.length, counted: pays.filter((p) => !p.same_as).length,
    counted_gbp: Math.round(pays.filter((p) => !p.same_as).reduce((a, p) => a + p.amount, 0)),
    unassigned_plan_subscription_income: { rows: open.length, gbp: Math.round(open.reduce((a, x) => a + x.amount, 0)) }
  };
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

/** 10 Nov rules / decisions applied in a build (counts only: never addresses in the run summary). */
export function identityRulesSummary(st) {
  const ip = st.identityPlan;
  if (!ip) return null;
  const byRule = [...ip.resolved.values()].reduce((m, r) => ({ ...m, [r]: (m[r] || 0) + 1 }), {});
  const r3 = st.links.filter((l) => /^name_r3_|_r3_/.test(l.match_method)).map((l) => l.anchor);
  return { first_pass_queue: ip.first_review.length, resolved_by_rule: byRule, rule3_records: new Set(r3).size, aliases: ip.plan.alias.size, decisions: ip.decisions };
}

/** Identity outcome of a build: records waiting for review (by reason), owner / test records by kind, B2B without email. */
export function identitySummary(facts) {
  const live = [...facts.values()].filter((f) => !f.attached_to && f.record_type !== 'system');
  const tally = (list, key) => list.reduce((m, f) => ({ ...m, [f[key]]: (m[f[key]] || 0) + 1 }), {});
  const pending = live.filter((f) => f.identity_pending);
  return {
    review_queue: pending.length, review_by_reason: tally(pending, 'identity_pending'),
    owner_records: tally(live.filter((f) => f.owner), 'owner_kind'),
    organisations_without_email: live.filter((f) => f.record_type === 'organisation' && !f.email && !f.owner).length
  };
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
  return { persons: st.persons.size, links, stale_persons: stale, memberstack_available: src.members_available, academy_trial_rows: src.trial_history || 0, campaign_exposure_rows: (src.exposure || []).length, workshop_sqs_refs: workshopRefs, admin_orders: st.admin, methods: methodCounts(st.links),
    booking_sheet_sales: { total: bsSales.length, same_as_squarespace_order: bsSales.filter((p) => p.same_sale_as).length },
    record_types: types, attached_under_contact: all.filter((f) => f.attached_to).length, booked_event_differs: bookedEventDiffers(st), plans: planSummary(st), identity: identitySummary(facts), identity_rules: identityRulesSummary(st),
    rows_shown: all.filter((f) => !f.attached_to && f.record_type !== 'system').length };
}
