/**
 * Customer identity + booking reconciliation (pure; no I/O). Rules agreed 7 Nov 2026 (GPT spec, Alan's Step 0 answers):
 * - A Squarespace profile is a person; exact (trimmed, lower-case) email links other records to it. No alias merging.
 * - Booking Sheet refs of the form "#0xxxx" are Squarespace order numbers (strip "#" and leading zeros for that pattern
 *   only). An order match identifies the BUYER; the attendee is the buyer only when the names match.
 * - JLR# codes, invoice refs and 10-digit refs are left as they are (source unverified).
 * - Match order for every Booking Sheet row (Alan, option 1, 9 Nov 2026): (1) the row's own email, exact; (2) its
 *   Squarespace order ref → the order's email; (3) an exact full name that names exactly ONE email-holding contact
 *   (identity-names.mjs) — confirmed, the row joins that contact. Everything else stays its own (email-less) record:
 *   several candidates / a partial or fuzzy name / a buyer-only order ref go to the identity review queue.
 * - Never merged into Alan's own records (owner addresses and their name) or a permanently excluded client.
 * - The same Squarespace order seen in Squarespace and the Booking Sheet is one booking (key sqs:<order number>).
 */
import { categoriesFromName, categoriesFromProduct, categoriesFromSheet, categoriesFromWorkshop, isCancelledText } from './categories.mjs';
import { normEmail, normName } from './store.mjs';
import { recordType } from './record-type.mjs';
import { planSheetWindow } from './value.mjs';
import { SHEET_PLAN_SOURCE, mergePlanSources, sheetPlans } from './plan-sources.mjs';
import { OWNER_EXCLUSION, REVIEW_REASONS, isAdminEmail, isBanned, nameDirectory, ownerNames, resolveName, usableEmail } from './identity-names.mjs';

export const SQS_REF = /^#0*(\d{1,7})$/;
export function sqsOrderNumber(ref) {
  const m = SQS_REF.exec(String(ref || '').trim());
  return m ? Number(m[1]) : null;
}

const day = (v) => (v ? String(v).slice(0, 10) : null);

/**
 * Alan's own business addresses: Alan books clients in under them, so the profile carries a client's name and many
 * orders. Never a customer — orders go to the attendee named on the order where evidenced, else "unassigned admin
 * booking"; the profile's name is not used for name matching; it stays eligible to receive campaigns.
 */
export { isAdminEmail };

function newState(profiles) {
  const st = { persons: new Map(), byEmail: new Map(), byName: new Map(), orderNames: new Map(), planOrders: new Map(), voucherOrders: new Set(), links: [], profileById: new Map(), admin: { orders: 0, by_email: 0, by_name: 0, unassigned: 0, value: 0 },
    plan: { plans: 0, same_as_order: 0, same_as_sheet: 0, placeholder_attributed: 0 }, review: new Map(), ownerKind: new Map() };
  for (const p of profiles) {
    const anchor = `sqs:${p.profile_id}`;
    const admin = isAdminEmail(p.email);
    st.profileById.set(p.profile_id, p);
    const person = addPerson(st, anchor, { email: p.email, name: admin ? 'Alan / business admin' : [p.first_name, p.last_name].filter(Boolean).join(' '), profile: p });
    person.admin = admin;
    if (p.email && !st.byEmail.has(p.email)) st.byEmail.set(p.email, anchor);
    else if (p.email) st.persons.get(st.byEmail.get(p.email)).email_shared = true;
    const n = admin ? '' : normName(`${p.first_name || ''} ${p.last_name || ''}`);
    if (n) st.byName.set(n, st.byName.has(n) ? null : anchor);
  }
  return st;
}

function addPerson(st, anchor, seed) {
  if (!st.persons.has(anchor)) st.persons.set(anchor, { anchor, email: seed.email || null, name: seed.name || null, profile: seed.profile || null, bookings: new Map(), payments: [], plan_payments: [], plans: [], academy: null, sources: {} });
  return st.persons.get(anchor);
}

function emailPerson(st, email, name) {
  const e = normEmail(email);
  if (!e) return null;
  if (!st.byEmail.has(e)) { st.byEmail.set(e, `email:${e}`); addPerson(st, `email:${e}`, { email: e, name }); }
  return st.byEmail.get(e);
}

const namePerson = (st, name) => {
  const n = normName(name);
  return n ? addPerson(st, `name:${n}`, { name: String(name).trim() }).anchor : null;
};

/** Link method + review reason for a name that did not resolve to one contact. */
const NAME_OUTCOME = {
  multiple: ['name_multiple', REVIEW_REASONS.multiple], fuzzy: ['name_fuzzy', REVIEW_REASONS.fuzzy], partial: ['name_partial', REVIEW_REASONS.partial],
  owner: ['owner_name', null], excluded: ['owner_exclusion_name', null], separated: ['name_separated', null], system: ['name_only', null], none: ['name_only', null]
};
const OWNER_KIND = { owner: 'owner_name', excluded: 'exclusion' };

function flagRecord(st, anchor, kind, reason) {
  if (OWNER_KIND[kind]) st.ownerKind.set(anchor, OWNER_KIND[kind]);
  if (!reason) return;
  if (!st.review.has(anchor)) st.review.set(anchor, new Set());
  st.review.get(anchor).add(reason);
}

/** Rule 3: an exact full name naming exactly one email-holding contact joins that contact; else its own name record. */
function byName(st, name) {
  const r = resolveName(st.dir, name);
  if (r.kind === 'unique') return { anchor: emailPerson(st, r.email, name), method: 'name_exact_unique' };
  const anchor = namePerson(st, name);
  const [method, reason] = NAME_OUTCOME[r.kind];
  if (anchor) flagRecord(st, anchor, r.kind, reason);
  return { anchor, method, review: reason, detail: r.count ? { candidates: r.count } : null };
}

/** Rule 1: the row's own address (Alan's own / business address and permanently excluded addresses never move a row). */
function byRowEmail(st, email, name) {
  const e = usableEmail(st.dir, email);
  return e ? { anchor: emailPerson(st, e, name), method: st.profileByEmail.has(e) ? 'email_exact' : 'email_only' } : null;
}

/** A row carrying a permanently excluded client's address stays on (and marks) its own name record. */
function bannedRow(st, email, name) {
  if (!isBanned(st.dir, email)) return null;
  const anchor = namePerson(st, name);
  if (anchor) flagRecord(st, anchor, 'excluded', null);
  return anchor ? { anchor, method: 'owner_exclusion_email' } : null;
}

function link(st, source, sourceId, anchor, method, extra = {}) {
  const confirmed = extra.review ? false : !extra.candidate;
  const detail = extra.review ? { ...extra.detail, review: extra.review } : extra.detail || null;
  st.links.push({ source, source_id: String(sourceId), anchor, match_method: method, candidate_anchor: extra.candidate || null, confirmed, raw_ref: extra.raw || null, detail });
  const p = st.persons.get(anchor);
  p.sources[source] = (p.sources[source] || 0) + 1;
}

/**
 * One booking per person per key; a second source for the same key only adds detail (never a second count).
 * A Booking Sheet attendee row quoting a Squarespace order (#0xxxx) is the event the place is actually booked on —
 * often a later date after a transfer — so its event title and date are kept as the booked event, beside the
 * purchased product title (V06, 7 Nov 2026): never the new date against the old product name.
 */
function addBooking(st, anchor, key, b) {
  const p = st.persons.get(anchor);
  const prev = p.bookings.get(key);
  if (!prev) { p.bookings.set(key, { key, ...b, cats: new Set(b.cats), src: new Set([b.src]), purchased_title: b.src === 'squarespace' ? b.title : null }); return; }
  b.cats.forEach((c) => prev.cats.add(c));
  prev.src.add(b.src);
  if (b.src === 'booking_sheet' && b.event_date) {
    prev.event_date = b.event_date;
    prev.event_title = b.title || prev.event_title || null;
  } else prev.event_date = prev.event_date || b.event_date;
  prev.title = prev.title || b.title;
  prev.cancelled = prev.cancelled || b.cancelled;
  prev.channel = prev.channel || b.channel;
  prev.money = prev.money || b.money;
}

/**
 * An order stops counting only when cancelled or refunded in full. Squarespace marks partly refunded orders
 * payment_state REFUNDED too (55 orders, £10,560 kept on 7 Nov), so the refunded amount decides, not the state.
 */
export function orderCancelled(o) {
  if (o.fulfillment_status === 'CANCELED') return true;
  const total = Number(o.grand_total_gbp) || 0;
  const refunded = Number(o.refunded_total_gbp) || 0;
  if (refunded > 0) return refunded >= total - 0.005;
  return o.payment_state === 'REFUNDED' && total === 0;
}

/** An order Alan entered under his business address: the attendee on the order form gets it, never Alan's record. */
function addAdminOrder(st, o, admin, booking) {
  st.admin.orders += 1;
  link(st, 'sqs_order', o.order_id, admin, 'admin_booking', { raw: `#${o.order_number}` });
  if (o.attendee_email && !isAdminEmail(o.attendee_email)) {
    const att = emailPerson(st, o.attendee_email, [o.attendee_first_name, o.attendee_last_name].filter(Boolean).join(' '));
    link(st, 'sqs_order_attendee', o.order_id, att, 'admin_booking_form_email', { raw: `#${o.order_number}` });
    addBooking(st, att, `sqs:${o.order_number}`, { ...booking, role: 'attendee' });
    st.admin.by_email += 1;
    return;
  }
  const who = byName(st, [o.attendee_first_name, o.attendee_last_name].filter(Boolean).join(' '));
  if (!who.anchor) { st.admin.unassigned += 1; return; }
  link(st, 'sqs_order_attendee', o.order_id, who.anchor, `admin_booking_form_${who.method}`, { review: who.review, detail: who.detail, raw: `#${o.order_number}` });
  addBooking(st, who.anchor, `sqs:${o.order_number}`, { ...booking, role: 'attendee' });
  st.admin.by_name += 1;
}

/** Money on the order (buyer's purchase); places = seats/items bought, gift cards excluded. */
function orderMoney(o, lines) {
  const gross = Number(o.grand_total_gbp) || 0;
  const refunded = Number(o.refunded_total_gbp) || 0;
  const places = lines.filter((l) => l.line_type !== 'GIFT_CARD').reduce((a, l) => a + (Number(l.quantity) || 1), 0);
  return { gross, refunded, net: gross - refunded, places: places || (lines.length ? 0 : 1) };
}

function orderBase(o, lines, index) {
  const cats = new Set(lines.flatMap((l) => [...categoriesFromProduct(l.product_name, index)]));
  if (lines.some((l) => l.line_type === 'GIFT_CARD')) cats.add('voucher_bought');
  return { order_date: day(o.created_on), title: lines.map((l) => l.product_name).filter(Boolean).join(' + '), src: 'squarespace', cancelled: orderCancelled(o), order_number: o.order_number, cats: [...cats] };
}

/** Names an order can be recognised by in the Booking Sheet (buyer's profile name, attendee on the form). */
function indexOrderNames(st, o, buyerAnchor, money, giftCard) {
  const buyer = st.persons.get(buyerAnchor);
  const names = [buyer?.profile && !buyer.admin ? buyer.name : null, [o.attendee_first_name, o.attendee_last_name].filter(Boolean).join(' ')];
  for (const n of new Set(names.map(normName).filter(Boolean))) {
    if (!st.orderNames.has(n)) st.orderNames.set(n, []);
    st.orderNames.get(n).push({ date: day(o.created_on), gross: money.gross, order_number: o.order_number, gift_card: giftCard });
  }
}

const daysApart = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;
/** A Booking Sheet sale that is a Squarespace order already counted: same name, amount within £1, within 3 days. */
function sameSaleAs(st, r) {
  const amount = Number(r.amount);
  const hit = (st.orderNames.get(normName(r.client_name)) || []).find((o) => o.date && r.txn_date && daysApart(o.date, r.txn_date) <= 3 && Math.abs(o.gross - amount) <= 1);
  return hit ? hit.order_number : null;
}

function addOrders(st, orders, linesByOrder, index) {
  const byNumber = new Map();
  for (const o of orders) {
    if (o.testmode) continue;
    byNumber.set(o.order_number, o);
    const lines = linesByOrder.get(o.order_id) || [];
    const base = orderBase(o, lines, index);
    const money = orderMoney(o, lines);
    const buyer = emailPerson(st, o.customer_email, null);
    if (!buyer) continue;
    indexOrderNames(st, o, buyer, money, base.cats.includes('voucher_bought'));
    if (isAdminEmail(o.customer_email)) { st.admin.value += money.net; addAdminOrder(st, o, buyer, base); continue; }
    link(st, 'sqs_order', o.order_id, buyer, st.profileByEmail?.has(o.customer_email) ? 'email_exact' : 'order_email', { raw: `#${o.order_number}` });
    const other = o.attendee_email && o.attendee_email !== o.customer_email;
    const cats = new Set(base.cats);
    addBooking(st, buyer, `sqs:${o.order_number}`, { ...base, cats: [...cats], role: other ? 'buyer_for_other' : 'buyer', money });
    if (other) {
      const att = emailPerson(st, o.attendee_email, [o.attendee_first_name, o.attendee_last_name].filter(Boolean).join(' '));
      link(st, 'sqs_order_attendee', o.order_id, att, 'order_form_email', { raw: `#${o.order_number}` });
      addBooking(st, att, `sqs:${o.order_number}`, { ...base, cats: [...cats], role: 'attendee' });
    }
  }
  return byNumber;
}

const fullName = (a, b) => normName([a, b].filter(Boolean).join(' '));

/** Rule 2: the row's Squarespace order names this attendee (order form) or its buyer; else the buyer, for review. */
function orderAttendee(st, row, order) {
  const n = normName(row.client_name);
  if (order.attendee_email && n && n === fullName(order.attendee_first_name, order.attendee_last_name)) return { anchor: emailPerson(st, order.attendee_email), method: 'order_ref+form_name' };
  const buyerAnchor = isAdminEmail(order.customer_email) ? null : st.byEmail.get(order.customer_email);
  const buyer = buyerAnchor ? st.persons.get(buyerAnchor) : null;
  if (buyer && n && n === normName(buyer.name)) return { anchor: buyerAnchor, method: 'order_ref+buyer_name' };
  return { buyer: buyerAnchor || null };
}

/** Who a Booking Sheet attendee row is: own email, then its Squarespace order, then an exact unique name. */
function workshopAttendee(st, row, order) {
  const own = byRowEmail(st, row.email, row.client_name);
  if (own) return own;
  const viaOrder = order ? orderAttendee(st, row, order) : {};
  if (viaOrder.anchor) return viaOrder;
  const banned = bannedRow(st, row.email, row.client_name);
  if (banned) return banned;
  const who = byName(st, row.client_name);
  if (!viaOrder.buyer || who.method === 'name_exact_unique' || !who.anchor || st.ownerKind.has(who.anchor)) return who;
  flagRecord(st, who.anchor, null, REVIEW_REASONS.buyer);
  return { anchor: who.anchor, method: 'order_ref_buyer_only', candidate: viaOrder.buyer, review: REVIEW_REASONS.buyer };
}

function addWorkshopRows(st, rows, byNumber) {
  for (const r of rows) {
    const num = sqsOrderNumber(r.order_ref);
    const order = num != null ? byNumber.get(num) : null;
    const who = workshopAttendee(st, r, order);
    if (!who.anchor) continue;
    link(st, 'bs_workshop', r.id, who.anchor, who.method, { candidate: who.candidate, review: who.review, raw: r.order_ref, detail: { ...who.detail, order_matched: !!order } });
    const key = order ? `sqs:${num}` : `bs-ws:${r.id}`;
    addBooking(st, who.anchor, key, {
      event_date: day(r.event_start), title: r.theme_location, src: 'booking_sheet', role: 'attendee', channel: r.source || null,
      cats: [...categoriesFromWorkshop(r.theme_location, r.is_multi_day)], cancelled: isCancelledText(`${r.theme_location} ${r.source}`)
    });
  }
}

function addCourseRows(st, rows) {
  for (const r of rows) {
    if (r.is_booking_row === false) continue;
    const num = sqsOrderNumber(r.booking_ref);
    const who = byRowEmail(st, r.email, r.client_name) || bannedRow(st, r.email, r.client_name) || byName(st, r.client_name);
    if (!who.anchor) continue;
    const anchor = who.anchor;
    link(st, 'bs_course', r.id, anchor, who.method, { review: who.review, detail: who.detail, raw: r.booking_ref });
    addBooking(st, anchor, num != null ? `sqs:${num}` : `bs-ca:${r.id}`, {
      event_date: day(r.from_date), title: r.event_name, src: 'booking_sheet', role: 'attendee', cats: [...categoriesFromName(r.event_name), 'course'], cancelled: false
    });
  }
}

/** Booking Sheet revenue lines carry a name only: payments on the name record, probable for any matching profile. */
/** "Pick N Mix" ledger rows sometimes carry the real client in the event column: use it when it names exactly one contact. */
function clientOf(st, r) {
  if (recordType({ name: r.client_name }) !== 'system' || !r.event_label) return r.client_name;
  return resolveName(st.dir, r.event_label).kind === 'unique' ? r.event_label : r.client_name;
}

/**
 * Gift voucher rule (Alan, 8 Nov 2026): a voucher is the BUYER's spend when bought (Squarespace GIFT_CARD order or a
 * "Gift Vouchers Inc" sheet sale). A redemption is the event income funded "Gift Voucher Out" plus the matching
 * "Gift Vouchers Out" minus: new spend for nobody. When the redeemer checked out on Squarespace with the voucher, the
 * order still shows its full grand total, so that order (same name, amount within £1, within 3 days, not itself a
 * gift-card purchase) is marked voucher_funded and counts no money.
 */
const VOUCHER_FUNDING = /gift\s*vouchers?\s*out/i;
function voucherOrderOf(st, r) {
  const amount = Number(r.amount);
  if (r.is_redemption || !(amount > 0) || !VOUCHER_FUNDING.test(r.funding || '') || !r.txn_date) return null;
  const gap = (o) => daysApart(o.date, r.txn_date);
  const hits = (st.orderNames.get(normName(r.client_name)) || []).filter((o) => !o.gift_card && o.date && !st.voucherOrders.has(o.order_number) && gap(o) <= 3 && Math.abs(o.gross - amount) <= 1);
  const hit = hits.sort((a, b) => gap(a) - gap(b))[0];
  if (hit) st.voucherOrders.add(hit.order_number);
  return hit ? hit.order_number : null;
}

function markVoucherOrders(st) {
  for (const p of st.persons.values()) for (const b of p.bookings.values()) if (b.money && st.voucherOrders.has(b.order_number)) b.voucher_funded = true;
}

function addTransactions(st, rows) {
  for (const raw of rows) {
    const r = { ...raw, client_name: clientOf(st, raw) };
    const who = byName(st, r.client_name);
    if (!who.anchor) continue;
    link(st, 'bs_transaction', `${r.source_workbook}:${r.source_row}`, who.anchor, who.method, { review: who.review, detail: who.detail });
    const voucherOrder = voucherOrderOf(st, r);
    st.persons.get(who.anchor).payments.push({ date: day(r.txn_date), cats: [...categoriesFromSheet(r.category_label, r.event_label)], channel: r.channel || null, redemption: !!r.is_redemption,
      amount: Number(r.amount) || 0, funding: r.funding || null, category: r.category_label || null, title: r.event_label || r.category_label || null, same_sale_as: voucherOrder ?? (r.is_redemption ? null : sameSaleAs(st, r)) });
  }
  markVoucherOrders(st);
}

/* ---------- Pick n Mix plans (Booking Sheet PnM Plans tab first, plan statement files as history) ---------- */

const PLAN_TOLERANCE_DAYS = { order: 31 };
const near = (a, b, days) => !!a && !!b && daysApart(a, b) <= days;
const isPlanOrder = (b) => b.money && ((b.cats && [...b.cats].includes('pick_n_mix')) || /pick\s*n\s*mix/i.test(b.title || ''));

/** Inside the plan's own period (±31 days) — used when the statement row has no reliable payment date. */
const inPeriod = (d, pay) => !!d && !!pay.starts && Date.parse(d) >= Date.parse(pay.starts) - 31 * DAY_MS && (!pay.ends || Date.parse(d) <= Date.parse(pay.ends) + 31 * DAY_MS);
const DAY_MS = 86400000;

/** The same plan money already counted as a Squarespace Pick n Mix order of this person (amount within £1). */
function sqsSameMoney(person, pay, used) {
  const when = (b) => (pay.date ? near(b.order_date, pay.date, PLAN_TOLERANCE_DAYS.order) : inPeriod(b.order_date, pay));
  return [...person.bookings.values()].find((b) => isPlanOrder(b) && !b.cancelled && !used.has(b.key) && Math.abs(b.money.gross - pay.amount) <= 1 && when(b)) || null;
}

const planSheetCandidate = (x, pay) => !x.redemption && !x.same_sale_as && !x.plan_attributed && Math.abs(x.amount - pay.amount) <= 1 && planSheetWindow(x, pay);

/**
 * The nearest-dated Booking Sheet row for the same money (the client's own name or a placeholder like "Pick n Mix
 * Subs"): a "Pick n Mix Inc" row within 10 days or a Bank row inside the plan's period (planSheetWindow).
 */
function sheetSameMoney(st, pay, names) {
  let best = null;
  for (const p of st.persons.values()) {
    const placeholder = /^name:(pick ?n ?mix|mentoring)/.test(p.anchor);
    if (!placeholder && !names.has(p.anchor)) continue;
    for (const x of p.payments) {
      const gap = planSheetCandidate(x, pay) ? daysApart(x.date, pay.date) : Infinity;
      if (gap < (best?.gap ?? Infinity)) best = { row: x, placeholder, gap };
    }
  }
  return best;
}

/** The plan's client: its email, else an exact unique name (rule 3), else the plan's own name record. */
function planPerson(st, plan) {
  if (plan.email) return { anchor: emailPerson(st, plan.email, plan.client_name) };
  return byName(st, plan.client_name);
}

/** Link source + match methods per plan source: PnM Plans tab rows vs plan statement files. */
const PLAN_LINKS = {
  sheet: { source: 'bs_plan', nameSource: 'bs_plan_name', email: 'plan_sheet_email', nameOnly: 'plan_sheet_name_only', name: 'plan_sheet_name', count: 'sheet_plans' },
  statement: { source: 'pnm_plan', nameSource: 'pnm_plan_name', email: 'plan_file_email', nameOnly: 'plan_file_name_only', name: 'plan_file_name', count: 'statement_plans' }
};
const planLinks = (plan) => (plan.source === SHEET_PLAN_SOURCE ? PLAN_LINKS.sheet : PLAN_LINKS.statement);

/** Attach the plan's client-name record to the plan person (a confirmed plan email names them). */
function linkPlanName(st, plan, anchor) {
  const n = normName(plan.client_name);
  const nameAnchor = n ? `name:${n}` : null;
  if (!nameAnchor || nameAnchor === anchor || !st.persons.has(nameAnchor)) return nameAnchor;
  const L = planLinks(plan);
  link(st, L.nameSource, plan.plan_key, nameAnchor, L.name, { candidate: anchor, raw: plan.plan_type || null });
  return nameAnchor;
}

function addPlanPayments(st, person, plan, payments, names) {
  const used = new Set();
  for (const p of payments) {
    if (p.scheduled_only) continue;
    const pay = { plan_key: plan.plan_key, amount: Number(p.amount), date: p.paid_on || null, date_reliable: !!p.date_reliable, plan_type: plan.plan_type, starts: plan.starts, ends: plan.ends };
    const sqs = sqsSameMoney(person, pay, used);
    if (sqs) { used.add(sqs.key); person.plan_payments.push({ ...pay, same_as: `sqs:${sqs.order_number}` }); st.plan.same_as_order += 1; continue; }
    const sheet = pay.date ? sheetSameMoney(st, pay, names) : null;
    if (sheet) { sheet.row.plan_attributed = plan.plan_key; st.plan[sheet.placeholder ? 'placeholder_attributed' : 'same_as_sheet'] += 1; }
    person.plan_payments.push(sheet ? { ...pay, on_sheet: true } : pay);
  }
}

/** A plan with no email joins a contact only when its name is exactly one contact; otherwise it waits for identity review. */
function linkPlan(st, plan, who) {
  const L = planLinks(plan);
  const linked = who.method === 'name_exact_unique';
  link(st, L.source, plan.plan_key, who.anchor, plan.email ? L.email : (linked ? `${L.name}_exact_unique` : L.nameOnly), { review: who.review, detail: who.detail, raw: plan.plan_id || null });
  st.plan[L.count] = (st.plan[L.count] || 0) + 1;
  if (plan.email) return;
  const k = linked ? 'name_only_linked' : 'name_only_review';
  st.plan[k] = (st.plan[k] || 0) + 1;
}

function addPlans(st, plans, payments, events) {
  const payByPlan = new Map();
  for (const p of payments || []) { if (!payByPlan.has(p.plan_key)) payByPlan.set(p.plan_key, []); payByPlan.get(p.plan_key).push(p); }
  for (const plan of plans || []) {
    const who = planPerson(st, plan);
    const anchor = who.anchor;
    if (!anchor) continue;
    const person = st.persons.get(anchor);
    person.plan_payments = person.plan_payments || [];
    person.plans = person.plans || [];
    linkPlan(st, plan, who);
    const nameAnchor = linkPlanName(st, plan, anchor);
    const names = new Set([anchor, nameAnchor].filter(Boolean));
    person.plans.push({ plan_key: plan.plan_key, plan_type: plan.plan_type, starts: plan.starts, ends: plan.ends, paid_total: Number(plan.paid_total) || 0, source_file: plan.source_file, source: plan.source || 'statement', status: plan.status || null });
    addPlanPayments(st, person, plan, payByPlan.get(plan.plan_key) || [], names);
    st.plan.plans += 1;
  }
  markPlanFunded(st, plans, events);
  matchPlaceholdersToOrders(st);
}

/**
 * "Pick n Mix Subs" / "Mentoring Subs" ledger rows that are the same money as a Squarespace subscription order (product
 * named Pick n Mix / mentoring, amount within £1, within 5 days) belong to that order's buyer — already counted there.
 */
function matchPlaceholdersToOrders(st) {
  const subs = [];
  for (const p of st.persons.values()) for (const b of p.bookings.values()) if (b.money && /pick\s*n\s*mix|mentor/i.test(b.title || '') && !b.cancelled) subs.push(b);
  const used = new Set();
  for (const p of st.persons.values()) {
    if (!/^name:(pick ?n ?mix|mentoring)/.test(p.anchor)) continue;
    for (const x of p.payments) {
      if (x.redemption || x.plan_attributed || x.same_sale_as || !(x.amount > 0)) continue;
      const hit = subs.find((b) => !used.has(b.key) && Math.abs(b.money.gross - x.amount) <= 1 && near(b.order_date, x.date, 5));
      if (hit) { used.add(hit.key); x.same_sale_as = hit.order_number; st.plan.placeholder_attributed += 1; }
    }
  }
}

/** £0 Squarespace orders booked against a plan ("allocated events" with an order ref) show as paid from that plan. */
function markPlanFunded(st, plans, events) {
  const year = new Map((plans || []).map((p) => [p.plan_key, String(p.starts || '').slice(0, 4) || 'plan']));
  for (const e of events || []) if (e.order_ref) st.planOrders.set(Number(e.order_ref), year.get(e.plan_key));
  for (const p of st.persons.values()) {
    for (const b of p.bookings.values()) {
      const n = b.key?.startsWith('sqs:') ? Number(b.key.slice(4)) : null;
      if (n && st.planOrders.has(n)) b.plan_funded = st.planOrders.get(n);
    }
  }
}

function addMembers(st, members) {
  for (const m of members) {
    const anchor = emailPerson(st, m.email, m.name);
    if (!anchor) continue;
    link(st, 'memberstack', m.id, anchor, st.profileByEmail.has(normEmail(m.email)) ? 'email_exact' : 'email_only');
    const person = st.persons.get(anchor);
    person.academy = m.active_member ? 'member' : (m.had_trial ? 'trial' : 'account');
    person.academy_detail = m.academy_detail || null;
  }
}

/** Alan's own addresses, permanently excluded clients (by email hash) and name records Alan separated by hand. */
export function identityGuards(src) {
  return {
    owners: new Set((src.owners || []).map((o) => normEmail(o.email)).filter(Boolean)),
    excludedHashes: new Set((src.suppression || []).filter((s) => s.reason === OWNER_EXCLUSION && !s.resolved_at).map((s) => s.email_hash)),
    separated: new Set((src.overrides || []).filter((o) => o.action === 'separate').map((o) => o.name_anchor))
  };
}

/** Any record carrying Alan's own name (the name on an owner address) is his, never a client. */
function flagOwnerNames(st) {
  const names = ownerNames(st.dir);
  for (const p of st.persons.values()) if (!p.admin && !st.ownerKind.has(p.anchor) && names.has(normName(p.name))) st.ownerKind.set(p.anchor, 'owner_name');
}

/**
 * Build every person + link from loaded rows. `members` = [{ id, email, name, had_trial, active_member }];
 * `contacts` = booking_sheet_tab_contacts rows (name ↔ email evidence only); `owners` / `suppression` / `overrides`
 * guard the name rule (identityGuards).
 */
export function buildIdentities(src) {
  const st = newState(src.profiles || []);
  st.profileByEmail = new Set((src.profiles || []).map((p) => p.email).filter(Boolean));
  st.dir = nameDirectory(src, identityGuards(src));
  const linesByOrder = new Map();
  for (const l of src.lines || []) { if (!linesByOrder.has(l.order_id)) linesByOrder.set(l.order_id, []); linesByOrder.get(l.order_id).push(l); }
  const byNumber = addOrders(st, src.orders || [], linesByOrder, src.canonicalIndex);
  addWorkshopRows(st, src.workshops || [], byNumber);
  addCourseRows(st, src.courses || []);
  addTransactions(st, src.transactions || []);
  const plans = mergePlanSources(sheetPlans(src.sheetPlans || []), { plans: src.plans || [], payments: src.planPayments || [] });
  st.plan.statement_duplicates = plans.duplicates;
  addPlans(st, plans.plans, plans.payments, src.planEvents || []);
  addMembers(st, src.members || []);
  flagOwnerNames(st);
  return st;
}
