/**
 * Per-person purchase value (spec 7 Nov 2026, section 2), each sale counted once:
 *   - Squarespace orders: the BUYER's purchase. net = grand total − refunded; cancelled / fully refunded orders are not
 *     qualifying orders (their refunds are still shown). Admin (@alanranger.com) orders are nobody's spend.
 *   - Booking Sheet sales (2024 onward) only when they are NOT the same sale as a Squarespace order (same name, amount
 *     within £1, within 3 days) and were paid in money (Stripe / Bank / PayPal / Cash). Voucher redemptions, "Gift
 *     Voucher Out" and Pick n Mix credit uses are not new spend (the voucher / plan sale was the purchase).
 *   - Booking Sheet sales carry a name only: confirmed for that name record, "probable" for a matching profile, and
 *     never added to the profile's confirmed total.
 * Places = seats bought on Squarespace orders (gift cards excluded); Booking Sheet sales count one place each.
 */
const MONEY_FUNDING = /^(stripe|bank|paypal|cash)$/i;
/** Full order history for the customer detail; the query's "has no purchase" treats a list this long as possibly cut off. */
export const MAX_PURCHASES = 150;
const round2 = (v) => Math.round(v * 100) / 100;

function orderPurchase(b, level) {
  const off = !!b.cancelled;
  return { level, src: 'squarespace', key: b.key, date: b.order_date, net: off ? 0 : b.money.net, gross: b.money.gross, refunded: b.money.refunded, places: off ? 0 : b.money.places, cancelled: off, title: b.title || null, cats: [...b.cats], for_other: b.role === 'buyer_for_other', plan_funded: b.plan_funded || null };
}

function sheetPurchase(p, level) {
  const refund = p.amount < 0;
  return { level, src: 'booking_sheet', key: null, date: p.date, net: p.amount, gross: refund ? 0 : p.amount, refunded: refund ? -p.amount : 0, places: refund ? 0 : 1, cancelled: false, refund_line: refund, title: p.title, cats: p.cats, channel: p.channel || null };
}

const isOwnOrder = (b) => b.money && (b.role === 'buyer' || b.role === 'buyer_for_other');
const isNewMoney = (p) => !p.redemption && !p.same_sale_as && !p.plan_attributed && MONEY_FUNDING.test(p.funding || '') && !!p.amount;

/** A Pick n Mix plan payment from the plan statement (email-confirmed); one already seen as a Squarespace order isn't added. */
function planPurchase(p, level) {
  return { level, src: 'plan', key: p.plan_key, date: p.date, net: p.amount, gross: p.amount, refunded: 0, places: 0, cancelled: false, title: `Pick n Mix plan payment${p.plan_type ? ` (${p.plan_type})` : ''}`, cats: ['pick_n_mix'], date_reliable: p.date_reliable, on_sheet: !!p.on_sheet };
}

export function purchasesOf(person, level) {
  return [
    ...[...person.bookings.values()].filter(isOwnOrder).map((b) => orderPurchase(b, level)),
    ...person.payments.filter(isNewMoney).map((p) => sheetPurchase(p, level)),
    ...(person.plan_payments || []).filter((p) => !p.same_as).map((p) => planPurchase(p, level))
  ];
}

/** Confirmed spend split by source, for the customer detail: orders · Booking Sheet · plan payments. */
export function spendBySource(list) {
  const out = { squarespace: 0, booking_sheet: 0, plan: 0 };
  for (const x of list) out[x.src] = Math.round(((out[x.src] || 0) + x.net) * 100) / 100;
  return out;
}

function yearBefore(today) {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

/** Totals over a purchase list (orders = qualifying sales; AOV unavailable when there are none). */
export function summarise(list, today) {
  const since = yearBefore(today);
  const sales = list.filter((x) => !x.cancelled && !x.refund_line);
  const orders = sales.filter((x) => x.src !== 'plan');
  const dated = sales.filter((x) => x.date).sort((a, b) => a.date.localeCompare(b.date));
  const last = dated[dated.length - 1] || null;
  const net = round2(list.reduce((a, x) => a + x.net, 0));
  const orderNet = round2(list.filter((x) => x.src !== 'plan').reduce((a, x) => a + x.net, 0));
  return {
    net, gross: round2(sales.reduce((a, x) => a + x.gross, 0)), refunds: round2(list.reduce((a, x) => a + x.refunded, 0)), orders: orders.length,
    plan_payments: sales.length - orders.length,
    places: sales.reduce((a, x) => a + x.places, 0), aov: orders.length ? round2(orderNet / orders.length) : null,
    r12_net: round2(list.filter((x) => x.date && x.date > since).reduce((a, x) => a + x.net, 0)),
    first: dated[0]?.date || null, last: last?.date || null, last_title: last?.title || null, last_cats: last?.cats || [],
    cancelled_orders: list.filter((x) => x.cancelled && !x.duplicate_of).length
  };
}

const DAY_MS = 86400000;
const within = (a, b, days) => !!a && !!b && Math.abs(Date.parse(a) - Date.parse(b)) <= days * DAY_MS;
const SAME_SALE = { squarespace: 3, plan: 10 };

/** The order or plan payment this Booking Sheet sale already is: same money (±£1) within 3 / 10 days. */
function sameSaleIn(x, kept, used) {
  return kept.find((o) => !used.has(o) && SAME_SALE[o.src] && !o.cancelled && Math.abs((o.gross || o.net) - x.net) <= 1 && within(o.date, x.date, SAME_SALE[o.src])) || null;
}
const dupRef = (o) => (o.src === 'squarespace' ? `#${String(o.key).replace(/^sqs:/, '')}` : `Pick n Mix plan payment ${o.date || ''}`.trim());

/**
 * The same sale seen in two sources, checked AFTER identity resolution (8 Nov 2026): per resolved person, across all
 * their emails and attached name records. A Booking Sheet sale that matches one of that person's Squarespace orders or
 * plan payments is kept for the record as `duplicate_of`, with no money, places or order count. `base` = already
 * accepted records the list is checked against (the confirmed list, for probable records).
 */
export function dedupeSales(list, base = []) {
  const kept = [...base, ...list.filter((x) => x.src !== 'booking_sheet')];
  const used = new Set();
  return list.map((x) => {
    if (x.src !== 'booking_sheet' || x.refund_line || !(x.net > 0)) return x;
    const hit = sameSaleIn(x, kept, used);
    if (!hit) return x;
    used.add(hit);
    if (hit.src === 'plan') hit.on_sheet = true;
    return { ...x, duplicate_of: dupRef(hit), dup_net: x.net, net: 0, gross: 0, places: 0, cancelled: true };
  });
}

const purchaseRow = (x) => ({ level: x.level, src: x.src, key: x.key || undefined, date: x.date, net: x.net, refunded: x.refunded || undefined, places: x.places, cancelled: x.cancelled || undefined, duplicate_of: x.duplicate_of || undefined, dup_net: x.dup_net || undefined, on_sheet: x.on_sheet || undefined, title: x.title, cats: x.cats, for_other: x.for_other || undefined, plan_funded: x.plan_funded || undefined });

/** value.c = confirmed (own records), value.p = probable extra (name-only Booking Sheet records matching this person). */
export function valueFacts(person, probableFrom, today) {
  const c = dedupeSales([...purchasesOf(person, 'c'), ...(person.confirmedFrom || []).flatMap((o) => purchasesOf(o, 'c'))]);
  const p = dedupeSales(probableFrom.flatMap((o) => purchasesOf(o, 'p')), c.filter((x) => !x.duplicate_of));
  const purchases = [...c, ...p].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, MAX_PURCHASES).map(purchaseRow);
  const dups = [...c, ...p].filter((x) => x.duplicate_of);
  return { value: { c: { ...summarise(c, today), by_src: spendBySource(c) }, p: summarise(p, today), cp: summarise([...c, ...p], today), duplicates: { rows: dups.length, gbp: Math.round(dups.reduce((a, x) => a + x.dup_net, 0) * 100) / 100 } }, purchases, plans: person.plans || [] };
}
