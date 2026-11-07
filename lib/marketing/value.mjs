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
const round2 = (v) => Math.round(v * 100) / 100;

function orderPurchase(b, level) {
  const off = !!b.cancelled;
  return { level, src: 'squarespace', key: b.key, date: b.order_date, net: off ? 0 : b.money.net, gross: b.money.gross, refunded: b.money.refunded, places: off ? 0 : b.money.places, cancelled: off, title: b.title || null, cats: [...b.cats], for_other: b.role === 'buyer_for_other' };
}

function sheetPurchase(p, level) {
  const refund = p.amount < 0;
  return { level, src: 'booking_sheet', key: null, date: p.date, net: p.amount, gross: refund ? 0 : p.amount, refunded: refund ? -p.amount : 0, places: refund ? 0 : 1, cancelled: false, refund_line: refund, title: p.title, cats: p.cats, channel: p.channel || null };
}

const isOwnOrder = (b) => b.money && (b.role === 'buyer' || b.role === 'buyer_for_other');
const isNewMoney = (p) => !p.redemption && !p.same_sale_as && MONEY_FUNDING.test(p.funding || '') && !!p.amount;

export function purchasesOf(person, level) {
  return [
    ...[...person.bookings.values()].filter(isOwnOrder).map((b) => orderPurchase(b, level)),
    ...person.payments.filter(isNewMoney).map((p) => sheetPurchase(p, level))
  ];
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
  const dated = sales.filter((x) => x.date).sort((a, b) => a.date.localeCompare(b.date));
  const last = dated[dated.length - 1] || null;
  const net = round2(list.reduce((a, x) => a + x.net, 0));
  return {
    net, gross: round2(sales.reduce((a, x) => a + x.gross, 0)), refunds: round2(list.reduce((a, x) => a + x.refunded, 0)), orders: sales.length,
    places: sales.reduce((a, x) => a + x.places, 0), aov: sales.length ? round2(net / sales.length) : null,
    r12_net: round2(list.filter((x) => x.date && x.date > since).reduce((a, x) => a + x.net, 0)),
    first: dated[0]?.date || null, last: last?.date || null, last_title: last?.title || null, last_cats: last?.cats || [],
    cancelled_orders: list.filter((x) => x.cancelled).length
  };
}

/** value.c = confirmed (own records), value.p = probable extra (name-only Booking Sheet records matching this person). */
export function valueFacts(person, probableFrom, today) {
  const c = purchasesOf(person, 'c');
  const p = probableFrom.flatMap((o) => purchasesOf(o, 'p'));
  const purchases = [...c, ...p].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 40)
    .map((x) => ({ level: x.level, src: x.src, date: x.date, net: x.net, places: x.places, cancelled: x.cancelled || undefined, title: x.title, cats: x.cats, for_other: x.for_other || undefined }));
  return { value: { c: summarise(c, today), p: summarise(p, today), cp: summarise([...c, ...p], today) }, purchases };
}
