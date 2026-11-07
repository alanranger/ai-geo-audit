/**
 * Nightly Squarespace → Supabase sync for the Marketing tab. Read-only on Squarespace (GET). Never deletes history:
 * profiles that vanish get `missing_since` and a permanent suppression entry; unsubscribes are recorded as suppressions
 * that a later re-subscribe in Squarespace (e.g. an accidental import) does not clear.
 */
import { reSuppressAfterReview } from './collector-ingest.mjs';
import { fetchOrders, fetchProfiles } from './sqs-api.mjs';
import { emailHash, normEmail, normPostcode, selectAll, upsertChunks } from './store.mjs';

const money = (m) => (m?.value == null ? null : Number(m.value));
const JLR_DOMAIN = /@jaguarlandrover\.com$/i;

export function profileRow(p, now) {
  const t = p.transactionsSummary || {};
  return {
    profile_id: p.id, email: normEmail(p.email), first_name: p.firstName || null, last_name: p.lastName || null,
    has_account: !!p.hasAccount, created_on: p.createdOn || null, accepts_marketing: !!p.acceptsMarketing, is_customer: !!p.isCustomer,
    postcode: p.address?.postalCode || null, country_code: p.address?.countryCode || null, order_count: t.orderCount ?? null,
    total_order_gbp: money(t.totalOrderAmount), first_order_on: t.firstOrderSubmittedOn || null, last_order_on: t.lastOrderSubmittedOn || null,
    last_seen_at: now, missing_since: null
  };
}

const suppression = (email, reason, source, now) => ({ email_hash: emailHash(email), reason, source, first_seen_at: now, last_seen_at: now });

/**
 * Suppression changes from one profile read vs what was stored: unsubscribes (stored subscribed → now not), profiles no
 * longer listed (deleted), and on the first sync every JLR-domain contact not subscribed at that moment (200 on 7 Nov
 * 2026: 168 unsubscribed by ChatGPT's clean-up that day, 32 already unsubscribed or never subscribed).
 */
export const JLR_SEED_REASON = 'JLR address, not subscribed at first sync (7 Nov 2026)';

export function suppressionChanges(fetched, stored, now) {
  const seen = new Set(fetched.map((p) => p.profile_id));
  const before = new Map(stored.map((s) => [s.profile_id, s]));
  const out = [];
  for (const p of fetched) {
    const prev = before.get(p.profile_id);
    if (prev?.accepts_marketing && !p.accepts_marketing && p.email) out.push(suppression(p.email, 'unsubscribed', 'squarespace_profile', now));
    if (!stored.length && !p.accepts_marketing && JLR_DOMAIN.test(p.email || '')) out.push(suppression(p.email, JLR_SEED_REASON, 'first_sync_seed', now));
  }
  const gone = stored.filter((s) => !seen.has(s.profile_id) && !s.missing_since);
  for (const s of gone) if (s.email) out.push(suppression(s.email, 'deleted_in_squarespace', 'squarespace_profile', now));
  return { suppress: out, gone: gone.map((s) => s.profile_id) };
}

/** Insert new suppressions; existing ones only get last_seen_at, their first reason is kept. */
async function saveSuppressions(sb, rows) {
  if (!rows.length) return 0;
  const existing = new Set((await selectAll(sb, 'marketing_suppression', 'email_hash')).map((r) => r.email_hash));
  const fresh = [...new Map(rows.filter((r) => !existing.has(r.email_hash)).map((r) => [r.email_hash, r])).values()];
  await upsertChunks(sb, 'marketing_suppression', fresh, 'email_hash');
  await reSuppressAfterReview(sb, rows.filter((r) => existing.has(r.email_hash)).map((r) => ({ email_hash: r.email_hash, at: r.first_seen_at })));
  return fresh.length;
}

export async function syncProfiles(sb, { fetchFn } = {}) {
  const now = new Date().toISOString();
  const read = await fetchProfiles({ fetchFn });
  if (!read.complete) throw new Error(`profiles read stopped after ${read.pages} pages; nothing saved`);
  const rows = read.items.map((p) => profileRow(p, now));
  const stored = await selectAll(sb, 'sqs_profiles', 'profile_id, email, accepts_marketing, missing_since');
  const { suppress, gone } = suppressionChanges(rows, stored, now);
  await upsertChunks(sb, 'sqs_profiles', rows, 'profile_id');
  for (let i = 0; i < gone.length; i += 200) {
    const { error } = await sb.from('sqs_profiles').update({ missing_since: now }).in('profile_id', gone.slice(i, i + 200));
    if (error) throw new Error(`sqs_profiles: ${error.message}`);
  }
  const added = await saveSuppressions(sb, suppress);
  return { profiles: rows.length, subscribed: rows.filter((r) => r.accepts_marketing).length, pages: read.pages, newly_missing: gone.length, suppressions_added: added };
}

const formValue = (o, label) => (o.formSubmission || []).find((f) => f.label === label)?.value || null;

export function orderRow(o, now) {
  return {
    order_id: o.id, order_number: Number(o.orderNumber) || null, created_on: o.createdOn || null, modified_on: o.modifiedOn || null,
    customer_email: normEmail(o.customerEmail), customer_id: o.customerId || null,
    attendee_email: normEmail(formValue(o, 'Email')), attendee_first_name: formValue(o, 'First Name'), attendee_last_name: formValue(o, 'Surname'),
    billing_postcode: o.billingAddress?.postalCode || null, billing_country: o.billingAddress?.countryCode || null,
    grand_total_gbp: money(o.grandTotal), refunded_total_gbp: money(o.refundedTotal), fulfillment_status: o.fulfillmentStatus || null,
    payment_state: o.paymentState || null, channel: o.channel || null, testmode: !!o.testmode, synced_at: now
  };
}

export function lineRows(o) {
  return (o.lineItems || []).map((l, i) => ({
    order_id: o.id, line_index: i, line_id: l.id || null, product_id: l.productId || null, product_name: l.productName || null,
    variant_options: l.variantOptions || null, sku: l.sku || null, quantity: l.quantity ?? null, unit_price_gbp: money(l.unitPricePaid), line_type: l.lineItemType || null
  }));
}

/** Orders: full read the first time, then everything modified since the newest stored order (minus a day of overlap). */
export async function syncOrders(sb, { fetchFn } = {}) {
  const now = new Date().toISOString();
  const { data: last } = await sb.from('sqs_orders').select('modified_on').order('modified_on', { ascending: false }).limit(1).maybeSingle();
  const after = last?.modified_on ? new Date(Date.parse(last.modified_on) - 86400000).toISOString() : null;
  const read = await fetchOrders({ modifiedAfter: after, modifiedBefore: now, fetchFn });
  if (!read.complete) throw new Error(`orders read stopped after ${read.pages} pages; nothing saved`);
  await upsertChunks(sb, 'sqs_orders', read.items.map((o) => orderRow(o, now)), 'order_id');
  const lines = read.items.flatMap(lineRows);
  await upsertChunks(sb, 'sqs_order_lines', lines, 'order_id,line_index');
  return { mode: after ? 'incremental' : 'full', orders: read.items.length, lines: lines.length, since: after };
}

/** Postcodes not yet cached → postcodes.io bulk lookup (100 per request, free, no key). */
export async function syncPostcodes(sb, { fetchFn = fetch, limit = 1000 } = {}) {
  const profiles = await selectAll(sb, 'sqs_profiles', 'postcode', (q) => q.not('postcode', 'is', null));
  const orders = await selectAll(sb, 'sqs_orders', 'billing_postcode', (q) => q.not('billing_postcode', 'is', null));
  const cached = new Set((await selectAll(sb, 'postcode_geo_cache', 'postcode')).map((r) => r.postcode));
  const all = [...new Set([...profiles.map((r) => r.postcode), ...orders.map((r) => r.billing_postcode)].map(normPostcode).filter(Boolean))];
  const todo = all.filter((p) => !cached.has(p)).slice(0, limit);
  let done = 0;
  for (let i = 0; i < todo.length; i += 100) {
    const batch = todo.slice(i, i + 100);
    const r = await fetchFn('https://api.postcodes.io/postcodes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postcodes: batch }) });
    if (!r.ok) throw new Error(`postcodes_io_http_${r.status}`);
    const rows = ((await r.json()).result || []).map((x) => ({ postcode: normPostcode(x.query), lat: x.result?.latitude ?? null, lng: x.result?.longitude ?? null, status: x.result ? 'ok' : 'not_found', looked_up_at: new Date().toISOString() }));
    done += await upsertChunks(sb, 'postcode_geo_cache', rows.filter((x) => x.postcode), 'postcode');
  }
  return { known_postcodes: all.length, looked_up: done, remaining: Math.max(0, all.length - cached.size - done) };
}
