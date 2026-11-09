/**
 * Strategy "Sales gap by month" (QUESTION-2026-11-09 (h), Alan 14:32 / 14:34). ONE server model both tabs read.
 *
 * GOVERNING RULE: every £ is counted in the month the booking / cash is MADE, never the month the event takes place.
 *  - Sold (a month / quarter) = Booking Sheet sales dated in that period (all categories, booking date; a future
 *    period only has cash already dated in it).
 *  - Likely (a month) = bookings expected to be MADE in that month across every event still on sale:
 *      each event's likely extra places = max(0, fill_rate[type] × capacity − booked), capped at places left,
 *      × damping = the share of that type's bookings that normally arrive in the days left before the event,
 *      spread across the months from today to the event by the same lead-time curve.
 *  - Dated places sellable in a period = stock on sale (places left × price) for events that start after the
 *    period begins and whose booking window (event date − 2 × the type's 75th-percentile lead time) has opened by
 *    the period's end. Stock, not revenue for the event's month; shown once per period.
 *  - Lead-time curve (per type: day / residential / course; walks use day): cumulative share of bookings made within
 *    d days before the event, piecewise linear through (0, 0%), (q25, 25%), (median, 50%), (q75, 75%), (2 × q75, 100%)
 *    from the last 24 months' Booking Sheet bookings (booking date → event start, non-JLR).
 *  - Fill rate per type: the KPI scorecard's F4 "last 12 months + next 6" (day / residential / course / all).
 * Pure functions + one assembler; no reads, no writes.
 */
import { NON_DATED, addMonths, gbpK, monthEnd, sumTx } from './strategy-insights/common.mjs';
import { shareStillToCome } from './strategy-insights/money.mjs';

const DAY = 864e5;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const days = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const plusDays = (iso, k) => new Date(Date.parse(`${iso}T12:00:00Z`) + k * DAY).toISOString().slice(0, 10);
const ukDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const r1 = (n) => Math.round(n * 10) / 10;
export const rateKey = (type) => (type === 'course' ? 'course' : (type === 'residential' ? 'residential' : 'day'));
export const MAX_NEW_EVENTS = 2;
export const RULES = [
  'Every £ is counted in the month the booking or cash is made, never the month the event takes place (Alan, 9 Nov 14:34).',
  'Sold = Booking Sheet sales dated in the period (booking date). A future period only has cash already dated in it.',
  'Likely = for each event on sale: max(0, fill rate × capacity − booked), capped at places left, × the share of that type\'s bookings that normally arrive in the days left (damping), spread over the months from today to the event by the lead-time curve.',
  'Lead-time curve (day / residential / course; walks use day): share of bookings made within d days of the event, straight lines through 0% at 0 days, 25% at the 25th percentile, 50% at the median, 75% at the 75th percentile and 100% at twice the 75th percentile (last 24 months of bookings, non-JLR).',
  'Fill rate = KPI scorecard F4, last 12 months + next 6 (day / residential / course / all events).',
  'Dated places sellable in a period = places left × price for events starting after the period begins whose booking window (twice the type\'s 75th-percentile lead time) has opened by the period end. It is stock, not revenue.',
  'Non-dated needed (likely) = still to sell − likely. Best case = still to sell − every sellable dated place.',
  'Remedy plan (rolling 3 months): still to find = non-dated needed (likely) − normal non-dated (same month last year, Booking Sheet categories 1-2-1, commissions, gift vouchers in, Academy, mentoring, Pick n Mix in, prints & royalties; voucher / Pick n Mix "Out" redemptions excluded) − the Prospects pipeline weighted £ in that cash month. To avoid counting a regular client twice, each category\'s baseline is first reduced by the pipeline of the enquiry types that sell into it, floored at 0. Lever 1 sells places beyond the likely fill on events bookable that month (soonest first); lever 2 adds up to 2 new day workshops when the month still has a median lead time left (latest on-sale date = month end − median lead); lever 3 is the rest as non-dated sales. The three levers add up to the still-to-find gap.',
  'Monthly sales targets: Targets panel seasonal survival sales (the same month figure is used for next year until next year\'s targets are set).'
];

/* ---------- inputs ---------- */

/** "55.9% / 56.3% / 58.3% / 56.3%" (scorecard F4 l12) → { day, residential, course, all } as fractions. */
export function fillRates(scorecard) {
  const row = (scorecard || []).find((r) => r.key === 'F4');
  const p = String(row?.l12 || '').split('/').map((x) => Math.round(parseFloat(x) * 10) / 1000);
  if (p.length < 4 || p.some((x) => !Number.isFinite(x))) return null;
  return { day: p[0], residential: p[1], course: p[2], all: p[3], basis: 'KPI scorecard F4 · last 12 months + next 6' };
}
export function monthsFrom(today, n) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return Array.from({ length: n }, (_, i) => {
    const a = addMonths(y, m, i);
    const key = `${a.y}-${String(a.m).padStart(2, '0')}`;
    return { key, y: a.y, m: a.m, label: MON[a.m - 1], start: `${key}-01`, end: monthEnd(a.y, a.m) };
  });
}
const onSale = (e, today) => !!e.date && e.date > today && Number(e.left) > 0 && Number(e.cap) > 0 && Number(e.price) > 0;
const horizonOf = (lt) => (lt?.q75_days ? lt.q75_days * 2 : 180);

/* ---------- per-event likely, spread by booking month ---------- */

/** Share of an event's still-to-come bookings made in [from, to] (inclusive dates), by the lead-time curve. */
function monthShare(lt, eventDate, today, from, to) {
  const F = (d) => shareStillToCome(lt, Math.max(0, d)) ?? 0;
  const total = F(days(today, eventDate));
  if (total <= 0) return 0;
  const a = from > today ? from : today;
  const b = plusDays(to, 1) < eventDate ? plusDays(to, 1) : eventDate;
  if (a >= b) return 0;
  return (F(days(a, eventDate)) - F(days(b, eventDate))) / total;
}
export function eventLikely(e, ctx, months) {
  const k = rateKey(e.type);
  const lt = ctx.lead?.[k];
  const fill = ctx.fill?.[k] ?? ctx.fill?.all ?? 0;
  const extra = Math.max(0, Math.min(Number(e.left), fill * Number(e.cap) - Number(e.booked || 0)));
  const damping = shareStillToCome(lt, days(ctx.today, e.date)) ?? 1;
  const likely = extra * damping;
  const byMonth = {};
  for (const mm of months) {
    const share = mm.start <= e.date ? monthShare(lt, e.date, ctx.today, mm.start, mm.end) : 0;
    if (share > 0) byMonth[mm.key] = likely * share;
  }
  return {
    key: e.eventKey || `${e.date}|${e.title}`, title: e.title, date: e.date, type: k, url: e.url || null, price: Number(e.price), cap: Number(e.cap),
    booked: Number(e.booked || 0), left: Number(e.left), fill, extra, damping, likely, by_month: byMonth,
    window_opens: plusDays(e.date, -horizonOf(lt)), booked_gbp: Number(e.booked_gbp || 0)
  };
}

/** Stock that can still be sold in [from, to]: events starting after the period begins, booking window open by its end. */
export function stockIn(evs, from, to, today) {
  const after = from > today ? from : today;
  const list = evs.filter((e) => e.date > after && e.window_opens <= to);
  return { gbp: list.reduce((a, e) => a + e.left * e.price, 0), places: list.reduce((a, e) => a + e.left, 0), events: list.length, list };
}
const likelyIn = (evs, keys) => evs.reduce((a, e) => a + keys.reduce((s, k) => s + (e.by_month[k] || 0), 0) * e.price, 0);

/* ---------- months ---------- */

function lastYear(mm) {
  return { start: `${mm.y - 1}${mm.start.slice(4)}`, end: monthEnd(mm.y - 1, mm.m) };
}
function swingOf(evs, mm) {
  const best = evs.filter((e) => e.date >= mm.start && e.date <= plusDays(mm.end, 62) && e.window_opens <= mm.end).sort((a, b) => b.left * b.price - a.left * a.price)[0];
  return best && best.left * best.price >= 500 ? `${shortTitle(best.title)} ${ukDay(best.date)} (${best.left} places = ${gbpK(best.left * best.price)})` : null;
}
export function shortTitle(t) {
  const s = String(t || '').split(/[|–]/)[0].replace(/photography|photo editing|workshops?|classes|classic|-\s*\d.*$/gi, '').replace(/\s+-\s*$/, '').replace(/\s+/g, ' ').trim();
  return (s.length <= 30 ? s : s.slice(0, 30).replace(/\s+\S*$/, '')).replace(/[\s-]+$/, '');
}

export function verdictOf(m) {
  if (m.still_to_sell <= 0) return 'Target already met by bookings made this month.';
  if (m.likely >= m.still_to_sell) return 'Likely dated bookings cover it.';
  if (m.non_dated_needed <= m.normal_non_dated) return 'Normal non-dated sales close it.';
  if (m.likely < m.still_to_sell * 0.15) return m.swing ? `Little dated booking expected: ${m.swing} is the swing; gifts and non-dated sales carry the rest.` : 'Almost no dated bookings expected: add events or gifts and non-dated sales carry it.';
  return 'A gap remains after likely bookings and normal non-dated sales: see the Remedy plan.';
}

function eventWorking(evs, mm) {
  return evs.filter((e) => (e.by_month[mm.key] || 0) > 0.005).sort((a, b) => b.by_month[mm.key] * b.price - a.by_month[mm.key] * a.price).map((e) => ({
    title: shortTitle(e.title), date: e.date, type: e.type, price: e.price, likely_total: r1(e.likely), damping: Math.round(e.damping * 100),
    this_month: Math.round(e.by_month[mm.key] * 100) / 100, this_month_gbp: Math.round(e.by_month[mm.key] * e.price),
    split: Object.entries(e.by_month).map(([k, v]) => `${MON[Number(k.slice(5, 7)) - 1]} ${r1(v)}`).join(' · ')
  }));
}

/**
 * Normal non-dated (same month last year, per category) and the Prospects pipeline for the month (lib/strategy-prospects.mjs).
 * No double counting: each category's baseline is reduced by the pipeline weighted £ of the enquiry types that sell into
 * it, floored at 0; the pipeline is then added once.
 */
export function nonDatedCover(txns, ly, pipe) {
  const byCat = Object.fromEntries(NON_DATED.map((c) => [c, sumTx(txns, ly.start, ly.end, [c])]));
  const normal = NON_DATED.reduce((a, c) => a + byCat[c], 0);
  const adjusted = NON_DATED.reduce((a, c) => a + Math.max(0, byCat[c] - (pipe?.cats?.[c] || 0)), 0);
  return { normal, normal_by_cat: byCat, normal_adjusted: adjusted, pipeline: pipe?.total || 0 };
}
export function monthFigure(mm, ctx, evs) {
  const target = Number(ctx.targets?.[mm.m - 1]) || 0;
  const sold = sumTx(ctx.txns, mm.start, mm.end);
  const still = Math.max(0, target - sold);
  const likely = likelyIn(evs, [mm.key]);
  const stock = stockIn(evs, mm.start, mm.end, ctx.today);
  const ly = lastYear(mm);
  const m = {
    key: mm.key, label: mm.label, start: mm.start, end: mm.end, current: mm.start <= ctx.today && ctx.today <= mm.end,
    days_left: mm.start <= ctx.today ? days(ctx.today, mm.end) : null, target, sold, still_to_sell: still, raw_gap: target - sold, likely,
    non_dated_needed: Math.max(0, still - likely), best_case: Math.max(0, still - stock.gbp),
    stock: { gbp: stock.gbp, places: stock.places, events: stock.events, list: stock.list.map((e) => ({ title: shortTitle(e.title), date: e.date, left: e.left, price: e.price })) },
    booked_ahead: (ctx.events || []).filter((e) => e.date >= mm.start && e.date <= mm.end).reduce((a, e) => a + (Number(e.booked_gbp) || 0), 0),
    working: eventWorking(evs, mm), swing: swingOf(evs, mm)
  };
  const cover = nonDatedCover(ctx.txns, ly, ctx.pipeline?.[mm.key]);
  const toFind = Math.max(0, m.non_dated_needed - cover.normal_adjusted - cover.pipeline);
  return { ...m, normal_non_dated: cover.normal, normal_by_cat: cover.normal_by_cat, normal_adjusted: cover.normal_adjusted, pipeline_weighted: cover.pipeline, still_to_find: toFind, verdict: verdictOf({ ...m, normal_non_dated: cover.normal }) };
}

/* ---------- Remedy plan (rolling 3 months): lever 1 + lever 2 + lever 3 = gap after likely ---------- */

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
/** Typical price per non-dated unit (last 12 months, positive lines): vouchers (8), 1-2-1 (7), Pick n Mix plans (4). */
export function unitPrices(txns, today) {
  const from = plusDays(today, -365);
  const avg = (cat, dflt) => {
    const xs = txns.filter((t) => Number(t.category_order) === cat && t.txn_date >= from && t.txn_date <= today && Number(t.amount) > 0).map((t) => Number(t.amount));
    return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : dflt;
  };
  return { voucher: avg(8, 150), one_to_one: avg(7, 150), pick_n_mix: avg(4, 300) };
}
/** A new day workshop: typical capacity × fill × price, the share of its bookings made in the month (event at month end). */
export function newEventOption(mm, ctx, evs) {
  const lt = ctx.lead?.day;
  const day = evs.filter((e) => e.type === 'day');
  const cap = median(day.map((e) => e.cap)) || 4;
  const price = median(day.map((e) => e.price)) || 150;
  const latest = plusDays(mm.end, -(lt?.median_days || 45));
  const share = shareStillToCome(lt, days(mm.start > ctx.today ? mm.start : ctx.today, mm.end)) ?? 0;
  const per = cap * (ctx.fill?.day ?? 0.5) * price * share;
  return { type: 'day workshop', cap, price, latest_on_sale: latest, too_late: latest < ctx.today || per <= 0, per_event: per };
}
function lever1For(mm, pool, need, today) {
  const rows = [];
  let left = need;
  for (const e of pool.filter((x) => x.date > (mm.start > today ? mm.start : today) && x.window_opens <= mm.end && x.spare > 0)) {
    if (left <= 0) break;
    const places = Math.min(e.spare, Math.ceil(left / e.price));
    const gbp = Math.min(left, places * e.price);
    e.spare -= places;
    left -= gbp;
    rows.push({ title: shortTitle(e.title), date: e.date, places, gbp, url: e.url, campaign: { panel: 'marketing', event_date: e.date, url: e.url } });
  }
  return { rows, gbp: need - left, places: rows.reduce((a, r) => a + r.places, 0) };
}
function lever2For(opt, need) {
  if (need <= 0 || opt.too_late) return { events: 0, gbp: 0, too_late: need > 0 && opt.too_late, brief: opt };
  const n = Math.min(MAX_NEW_EVENTS, Math.ceil(need / opt.per_event));
  return { events: n, gbp: Math.min(need, n * opt.per_event), too_late: false, brief: opt };
}
function lever3For(need, units) {
  return { gbp: need, units: { vouchers: Math.ceil(need / units.voucher), one_to_ones: Math.ceil(need / units.one_to_one), pick_n_mix: Math.ceil(need / units.pick_n_mix) }, unit_prices: units };
}
function closesOf(gap, l1, l3) {
  if (gap <= 0) return { yes: true, text: 'Yes: likely bookings + normal non-dated cover it' };
  if (l3.gbp <= 0) return { yes: true, text: `Yes, if ${l1.rows.map((r) => r.title).slice(0, 2).join(' and ') || 'the new events'} sell` };
  return { yes: false, text: `Only with ${gbpK(l3.gbp)} extra non-dated sales` };
}
export function remedyPlan(months, ctx, evs) {
  const pool = evs.map((e) => ({ ...e, spare: Math.max(0, Math.round(e.left - e.likely)) })).sort((a, b) => a.date.localeCompare(b.date));
  const units = unitPrices(ctx.txns, ctx.today);
  const rows = months.map((m) => {
    const gap = m.still_to_find;
    const l1 = lever1For(m, pool, gap, ctx.today);
    const l2 = lever2For(newEventOption(m, ctx, evs), gap - l1.gbp);
    const l3 = lever3For(Math.max(0, gap - l1.gbp - l2.gbp), units);
    return {
      key: m.key, label: m.label, days_left: m.days_left, non_dated_needed: m.non_dated_needed, normal_non_dated: m.normal_non_dated, normal_adjusted: m.normal_adjusted,
      pipeline_weighted: m.pipeline_weighted, still_to_find: gap, gap, lever1: l1, lever2: l2, lever3: l3, closes: closesOf(gap, l1, l3)
    };
  });
  const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
  return {
    rows,
    total: { gap: sum((r) => r.gap), lever1: sum((r) => r.lever1.gbp), lever1_places: sum((r) => r.lever1.places), lever2: sum((r) => r.lever2.gbp), lever2_events: sum((r) => r.lever2.events), lever3: sum((r) => r.lever3.gbp) },
    links: { lever1: 'the event\'s Marketing campaign', lever2: 'add-event brief (type, price, capacity, latest on-sale date)', lever3: { panel: 'marketing', campaigns: ['gift vouchers', 'Pick n Mix', '1-2-1'] } }
  };
}

/* ---------- quarter planning cards ---------- */

const quarterMonths = (q) => monthsFrom(q.start_date, 3);
/** Plan-by: the quarter's first day − the bookings-weighted median lead time across types. */
export function planLead(lead) {
  const ts = ['day', 'residential', 'course'].map((k) => lead?.[k]).filter((x) => x?.median_days && x?.n);
  const n = ts.reduce((a, x) => a + x.n, 0);
  return n ? Math.round(ts.reduce((a, x) => a + x.median_days * x.n, 0) / n) : 45;
}
function avgEventLikely(evs, ctx) {
  const xs = evs.map((e) => (ctx.fill?.all ?? 0.5) * e.cap * e.price);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function quarterState(q, today) {
  if (q.end_date < today) return 'past';
  return q.start_date <= today ? 'current' : 'future';
}
export function quarterCard(q, ctx, evs, monthFigs) {
  const mms = quarterMonths(q);
  const target = mms.reduce((a, mm) => a + (Number(ctx.targets?.[mm.m - 1]) || 0), 0);
  const sold = sumTx(ctx.txns, q.start_date, q.end_date);
  const still = Math.max(0, target - sold);
  const stock = stockIn(evs, q.start_date, q.end_date, ctx.today);
  const likely = likelyIn(evs, mms.map((mm) => mm.key));
  const normal = sumTx(ctx.txns, `${Number(q.start_date.slice(0, 4)) - 1}${q.start_date.slice(4)}`, `${Number(q.end_date.slice(0, 4)) - 1}${q.end_date.slice(4)}`, NON_DATED);
  const toPlan = Math.max(0, still - likely - normal);
  const avg = avgEventLikely(evs, ctx);
  const planBy = plusDays(q.start_date, -planLead(ctx.lead));
  const state = quarterState(q, ctx.today);
  return {
    key: q.key || q.quarter_key, label: q.label, start: q.start_date, end: q.end_date, state, target, sold, still_to_sell: still,
    stock: { gbp: stock.gbp, events: stock.events, places: stock.places }, no_events_on_sale: stock.events === 0, likely,
    non_dated_needed: Math.max(0, still - likely), normal_non_dated: normal, to_plan: toPlan, extra_events: avg && toPlan > 0 ? Math.ceil(toPlan / avg) : 0,
    avg_event_likely: avg, plan_by: planBy, plan_by_passed: planBy < ctx.today, reconcile: state === 'current' ? reconcileOf(mms, ctx, monthFigs, sold, target) : null,
    still_to_find: state === 'current' ? stillToFindIn(mms, monthFigs) : null
  };
}
/** Current quarter: Σ "still to find" (lever 3, after the pipeline) over its months that are in the rolling tiles. */
function stillToFindIn(mms, monthFigs) {
  const figs = monthFigs.filter((f) => mms.some((mm) => mm.key === f.key));
  return { gbp: figs.reduce((a, f) => a + f.still_to_find, 0), pipeline: figs.reduce((a, f) => a + f.pipeline_weighted, 0), months: figs.map((f) => f.label) };
}
/** Current quarter: target − sold = Σ months (target − sold); months already in the tiles use the tiles' figures. */
function reconcileOf(mms, ctx, monthFigs, sold, target) {
  const parts = mms.map((mm) => {
    const f = monthFigs.find((x) => x.key === mm.key);
    const t = Number(ctx.targets?.[mm.m - 1]) || 0;
    const s = f ? f.sold : sumTx(ctx.txns, mm.start, mm.end);
    return { key: mm.key, label: mm.label, target: t, sold: s, raw_gap: t - s, in_tiles: !!f };
  });
  const sum = parts.reduce((a, p) => a + p.raw_gap, 0);
  return { parts, raw_gap: target - sold, sum_of_months: sum, ok: Math.abs(sum - (target - sold)) < 0.5 };
}

/* ---------- assembler ---------- */

const FALLBACK_QUARTERS = (today) => {
  const y = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 10 ? 1 : 0);
  return [[`${y}-10-01`, `${y}-12-31`, 'Q1'], [`${y + 1}-01-01`, `${y + 1}-03-31`, 'Q2'], [`${y + 1}-04-01`, `${y + 1}-06-30`, 'Q3'], [`${y + 1}-07-01`, `${y + 1}-09-30`, 'Q4']]
    .map(([s, e, l]) => ({ key: l.toLowerCase(), label: l, start_date: s, end_date: e }));
};
/**
 * x = { today (London), txns, targets (12 monthly sales £), events (diary `all`), fill, lead, quarters }.
 * Returns the rolling quarter, 3 month tiles, the Remedy plan and 4 quarter cards.
 */
export function buildSalesGap(x) {
  const quarters = (x.quarters?.length ? x.quarters : FALLBACK_QUARTERS(x.today)).slice(0, 4);
  const lastEnd = quarters[quarters.length - 1].end_date;
  const months = monthsFrom(x.today, Math.max(3, Math.ceil(days(x.today, lastEnd) / 30) + 2));
  const ctx = { ...x, fill: x.fill || { day: 0.5, residential: 0.5, course: 0.5, all: 0.5 } };
  const evs = (x.events || []).filter((e) => onSale(e, x.today)).map((e) => eventLikely(e, ctx, months));
  const tiles = months.slice(0, 3).map((mm) => monthFigure(mm, ctx, evs));
  const sum = (f) => tiles.reduce((a, t) => a + f(t), 0);
  const qStock = stockIn(evs, tiles[0].start, tiles[2].end, x.today);
  const rolling = {
    from: x.today, to: tiles[2].end, still_to_sell: sum((t) => t.still_to_sell), likely: sum((t) => t.likely), non_dated_needed: sum((t) => t.non_dated_needed),
    best_case: Math.max(0, sum((t) => t.still_to_sell) - qStock.gbp), stock: { gbp: qStock.gbp, places: qStock.places, events: qStock.events }
  };
  rolling.likely_share = rolling.still_to_sell ? Math.round((rolling.likely / rolling.still_to_sell) * 100) : null;
  return {
    as_of: x.today, months: tiles, rolling, remedy: remedyPlan(tiles, ctx, evs), quarters: quarters.map((q) => quarterCard(q, ctx, evs, tiles)),
    fill: ctx.fill, lead: x.lead || null, events_on_sale: evs.length, rules: RULES, basis: 'booking month (Alan, 9 Nov 14:34)'
  };
}
