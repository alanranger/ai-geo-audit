/**
 * MONEY row. Sales £ by booking/order date (Booking Sheet basis, redemptions netted as the sheet does); GP with the
 * dashboard's one GP method (GP categories × per-category rates); targets from the Targets panel.
 */
import { GP_CATEGORY_ORDERS } from '../targets-master.mjs';
import {
  NON_DATED, SERVICES, addMonths, cell, gbp, gbpK, gpTx, monthEnd, pct, ragDelta, ragFor, round, sameDayLastYear, signPct, sumTx
} from './common.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map((m) => m.slice(0, 3));
const ukDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function monthWindow(today) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return { y, m, start: `${today.slice(0, 7)}-01`, end: monthEnd(y, m), daysLeft: Math.round((Date.parse(`${monthEnd(y, m)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) };
}

export function thisMonthTile(ctx) {
  const { today, txns, rate, master, diary } = ctx;
  const w = monthWindow(today);
  const sales = sumTx(txns, w.start, today);
  const gp = gpTx(txns, w.start, today, rate, GP_CATEGORY_ORDERS);
  const salesT = master.revenue_equivalent.survival_monthly[w.m - 1];
  const gpT = master.seasonal.survival[w.m - 1];
  const pace = gpT * master.this_month.day_fraction;
  const nx = addMonths(w.y, w.m, 1);
  const fills = diary.filter((e) => e.date >= today && e.date <= monthEnd(nx.y, nx.m) && e.left > 0).slice(0, 4);
  const ofTarget = salesT ? Math.round((sales / salesT) * 100) : null;
  return {
    key: 'money-this-month', row: 'money', title: `This month · ${MONTHS[w.m - 1]}`,
    headline: { value: gbp(sales), label: `sales · ${ofTarget ?? '—'}% of the ${gbp(salesT)} sales target`, delta: null },
    comparison: `GP booked ${gbp(gp)} (GP target ${gbp(gpT)}, pace to date ${gbp(pace)}) · ${w.daysLeft} days left`,
    numbers: { sales, sales_target: salesT, of_target_pct: ofTarget, gp, gp_target: gpT },
    note: fills.length ? `Near-term fills: ${fills.map((e) => shortTitle(e.title)).join(', ')}.` : 'No unsold dated places in the next few weeks.',
    link: { label: 'This week\'s actions →', anchor: 'st-action-list' },
    source: 'Booking Sheet sales by booking date · GP = GP categories × per-category rates (the dashboard\'s GP method) · Targets panel (seasonal survival)'
  };
}

export const shortTitle = (t) => String(t || '').split(/[|–-]/)[0].replace(/photography|workshops?|course(s)? for/gi, '').replace(/\s+/g, ' ').trim().slice(0, 28);

/** Share of a type's bookings still to come at `d` days before the date, from the lead-time quartiles. */
export function shareStillToCome(lt, d) {
  if (!lt || lt.q25_days == null || lt.median_days == null || lt.q75_days == null) return null;
  const pts = [[0, 0], [lt.q25_days, 0.25], [lt.median_days, 0.5], [lt.q75_days, 0.75], [lt.q75_days * 2, 1]];
  if (d >= pts[4][0]) return 1;
  for (let i = 1; i < pts.length; i += 1) {
    const [x1, y1] = pts[i];
    const [x0, y0] = pts[i - 1];
    if (d <= x1) return x1 === x0 ? y1 : y0 + ((d - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 1;
}

/** Approved discount on an event's offer note: "£150 off" or "30% off" (applied to the forecast, not the potential). */
export function discountOf(note) {
  const s = String(note || '');
  const p = s.match(/(\d{1,2})\s*%/);
  if (p) return { kind: 'pct', v: Number(p[1]) };
  const g = s.match(/£\s?(\d{1,4})/);
  return g ? { kind: 'gbp', v: Number(g[1]) } : null;
}

const typeKey = (t) => (t === 'course' ? 'course' : (t === 'residential' ? 'residential' : 'day'));

/** Likely extra places per dated event: typical final size × share of bookings still to come, capped at places left. */
function forecastDated(events, ctx) {
  const lt = ctx.leadTimes || {};
  const typical = { course: ctx.typical?.f3, day: ctx.typical?.f1, residential: ctx.typical?.f2 };
  let total = 0;
  let used = 0;
  for (const e of events) {
    const k = typeKey(e.type);
    const share = shareStillToCome(lt[k], (Date.parse(`${e.date}T00:00:00Z`) - Date.parse(`${ctx.today}T00:00:00Z`)) / 86400000);
    if (share == null || !typical[k]) continue;
    used += 1;
    const extra = Math.max(0, Math.min(e.left, typical[k] * share));
    const d = discountOf(ctx.offers.get(e.eventKey));
    const unit = d?.kind === 'pct' ? e.price * (1 - d.v / 100) : (d?.kind === 'gbp' ? Math.max(0, e.price - d.v) : e.price);
    total += extra * unit;
  }
  return used ? { gbp: total, events: used, of: events.length } : null;
}

/** Each month's still-needed sales and the running total to its month end (current month net of sales so far). */
export function monthSplit(months, parts) {
  let run = 0;
  return months.map((mm, i) => {
    run += parts[i];
    return { month: `${mm.y}-${String(mm.m).padStart(2, '0')}`, label: MON[mm.m - 1], needed: parts[i], to_end: run, end: monthEnd(mm.y, mm.m), current: i === 0 };
  });
}

export function nextThreeTile(ctx) {
  const { today, txns, master, diary } = ctx;
  const w = monthWindow(today);
  const months = [0, 1, 2].map((i) => addMonths(w.y, w.m, i));
  const end = monthEnd(months[2].y, months[2].m);
  const salesT = (mm) => master.revenue_equivalent.survival_monthly[mm.m - 1];
  const mtd = sumTx(txns, w.start, today);
  const parts = [Math.max(0, salesT(months[0]) - mtd), salesT(months[1]), salesT(months[2])];
  const required = parts.reduce((a, b) => a + b, 0);
  const dated = diary.filter((e) => e.date >= today && e.date <= end);
  const potential = dated.reduce((a, e) => a + (e.unsold_gbp || 0), 0);
  const inHand = dated.reduce((a, e) => a + (e.booked_gbp || 0), 0);
  const nonDated = Math.max(0, required - potential);
  const ly = months.map((mm) => ({ y: mm.y - 1, m: mm.m }));
  const lyNonDated = sumTx(txns, `${ly[0].y}-${String(ly[0].m).padStart(2, '0')}-01`, monthEnd(ly[2].y, ly[2].m), NON_DATED);
  const fc = forecastDated(dated, { ...ctx, today });
  return {
    key: 'money-next-3', row: 'money', title: `Next 3 months · to ${ukDay(end)} ${end.slice(0, 4)}`,
    headline: { value: gbpK(required), label: 'sales still to make', delta: null },
    comparison: months.map((mm, i) => `${MON[mm.m - 1]} ${gbpK(parts[i])}${i === 0 ? ' left' : ''}`).join(' · ') + ' (seasonal targets)',
    boxes: [
      { label: 'Dated courses & workshops (potential)', value: gbpK(potential), sub: `every unsold place at full price on ${dated.length} dated events to ${ukDay(end)} · ${gbpK(inHand)} already booked (counted in the month it was paid)`, rag: 'grey' },
      { label: 'Likely dated sales (forecast)', value: fc ? gbpK(fc.gbp) : 'forecast unavailable', sub: fc ? `estimate: typical final size × share of bookings still to come (lead times from the last 24 months' bookings), approved discounts applied · ${fc.events} of ${fc.of} events` : 'not enough booking history for these event types', rag: 'grey', estimated: true },
      { label: 'Non-dated sales needed', value: gbpK(nonDated), sub: `1-2-1, gift vouchers, Pick n Mix, mentoring, Academy, commissions, prints · same 3 months last year ${gbpK(lyNonDated)}`, rag: ragFor(lyNonDated, nonDated) }
    ],
    note: nonDated > lyNonDated ? `Fill every dated place AND sell ${lyNonDated ? `${(nonDated / lyNonDated).toFixed(1)}×` : 'well above'} last year's non-dated sales for these months.` : 'Filling the dated places plus last year\'s non-dated sales would cover the target.',
    scenario: fc ? `If only the forecast sells: ${gbpK(Math.max(0, required - fc.gbp))} must come from non-dated sales (instead of ${gbpK(nonDated)} if every dated place sells — two alternatives, not added together).` : null,
    link: { label: 'Campaigns for Nov–Jan →', panel: 'marketing' },
    source: 'Targets panel seasonal sales (survival) · diary inventory & listed prices · Booking Sheet', numbers: { required, potential, inHand, nonDated, lyNonDated, forecast: fc?.gbp ?? null, nonDatedIfForecast: fc ? Math.max(0, required - fc.gbp) : null, window_end: end, months: monthSplit(months, parts) }
  };
}

function ytdRows(ctx, cats) {
  const { today, txns } = ctx;
  const ly = sameDayLastYear(today);
  const from = `${today.slice(0, 4)}-01-01`;
  const lyFrom = `${ly.slice(0, 4)}-01-01`;
  return { now: sumTx(txns, from, today, cats), ly: sumTx(txns, lyFrom, ly, cats) };
}

export function ytdTile(ctx) {
  const total = ytdRows(ctx, null);
  const p = pct(total.now, total.ly);
  const rows = SERVICES.map(([label, cat]) => {
    const r = ytdRows(ctx, [cat]);
    const d = pct(r.now, r.ly);
    return [cell(label), cell(gbpK(r.ly)), cell(gbpK(r.now)), cell(r.ly ? signPct(d) : (r.now ? 'new' : '—'), r.ly ? ragDelta(d) : 'grey')];
  });
  const red = ytdRows(ctx, [5, 9]);
  return {
    key: 'money-ytd', row: 'money', title: 'Sales this year vs last',
    headline: { value: signPct(p), label: `${gbpK(total.now)} vs ${gbpK(total.ly)}`, delta: null, rag: ragDelta(p) },
    comparison: `1 Jan – ${ukDay(ctx.today)} vs same days last year · by service · voucher & Pick n Mix redemptions netted (${gbpK(red.now)} this year, ${gbpK(red.ly)} last)`,
    table: { cols: ['Service', String(Number(ctx.today.slice(0, 4)) - 1), ctx.today.slice(0, 4), 'Δ'], rows },
    note: p >= 0 ? 'Turnover is up — what matters is what it\'s made of.' : 'Turnover is down on last year.',
    link: { label: 'Revenue tab →', panel: 'revenue-truth' },
    source: 'Booking Sheet transactions (booking date)'
  };
}

/**
 * The dashboard's one GP method (Targets panel, Revenue GP chart, Strategy GP): GP categories only, each year's own
 * Booking Sheet GP rates. Gift vouchers and Pick n Mix (sold and redeemed) are outside it — their value is counted
 * once, when it is used on an event — so margin = GP ÷ sales of the same GP categories, both years.
 */
const GP_SERVICES = SERVICES.filter(([, cat]) => GP_CATEGORY_ORDERS.includes(cat));

function yearBasis(ctx, y, to) {
  const from = `${y}-01-01`;
  const sales = sumTx(ctx.txns, from, to, GP_CATEGORY_ORDERS);
  const gp = gpTx(ctx.txns, from, to, ctx.rate, GP_CATEGORY_ORDERS);
  const byCat = new Map(GP_SERVICES.map(([, cat]) => [cat, { sales: sumTx(ctx.txns, from, to, [cat]), gp: gpTx(ctx.txns, from, to, ctx.rate, [cat]), rate: ctx.rate(y, cat) }]));
  return { sales, gp, margin: sales ? gp / sales : null, byCat };
}

/** Margin change on this year's sales, split into GP-rate changes and the change of mix. */
export function gpEffect(now, ly) {
  if (now.margin == null || ly.margin == null) return null;
  const total = now.sales * (now.margin - ly.margin);
  let rateEffect = 0;
  for (const [cat, c] of now.byCat) rateEffect += c.sales * (c.rate - (ly.byCat.get(cat)?.rate ?? c.rate));
  return { total, rate: rateEffect, mix: total - rateEffect };
}

function shareRows(now, ly) {
  return GP_SERVICES.map(([label, cat]) => {
    const n = now.byCat.get(cat);
    const l = ly.byCat.get(cat);
    const sNow = now.gp ? (n.gp / now.gp) * 100 : 0;
    const sLy = ly.gp ? (l.gp / ly.gp) * 100 : 0;
    const d = sNow - sLy;
    return { label, rate: n.rate, rateLy: l.rate, sLy, sNow, d, rag: mixRag(n.rate, d) };
  });
}

/** Green = more profit share from ≥70% GP services, red = less; amber = low-margin service or under 1 point. */
export function mixRag(rate, d) {
  if (Math.abs(d) < 1 || rate < 0.7) return 'amber';
  return d > 0 ? 'green' : 'red';
}

const rateTxt = (a, b) => (Math.round(a * 100) === Math.round(b * 100) ? `${Math.round(b * 100)}%` : `${Math.round(a * 100)}→${Math.round(b * 100)}%`);
const pctTxt = (m) => (m == null ? '—' : `${(m * 100).toFixed(1)}%`);

function rateChanges(rows) {
  return rows.filter((r) => Math.round(r.rate * 100) !== Math.round(r.rateLy * 100)).map((r) => `${r.label.toLowerCase()} ${rateTxt(r.rateLy, r.rate)}`).join(', ');
}

export function gpMixTile(ctx) {
  const { today } = ctx;
  const y = Number(today.slice(0, 4));
  const now = yearBasis(ctx, y, today);
  const ly = yearBasis(ctx, y - 1, sameDayLastYear(today));
  const eff = gpEffect(now, ly);
  const shares = shareRows(now, ly);
  const rows = shares.map((r) => [cell(r.label), cell(rateTxt(r.rateLy, r.rate), r.rate < 0.7 ? 'amber' : null), cell(`${r.sLy.toFixed(0)}%`), cell(`${r.sNow.toFixed(0)}%`), cell(`${r.d >= 0 ? '+' : ''}${r.d.toFixed(1)}`, r.rag)]);
  const sumLy = shares.reduce((acc, r) => acc + r.sLy, 0);
  const sumNow = shares.reduce((acc, r) => acc + r.sNow, 0);
  rows.push([cell('Total', null, { bold: true }), cell(''), cell(`${Math.round(sumLy)}%`, null, { bold: true }), cell(`${Math.round(sumNow)}%`, null, { bold: true }), cell('')]);
  const working = eff ? `GP effect = ${gbpK(now.sales)} × (${pctTxt(now.margin)} − ${pctTxt(ly.margin)}) = ${gbpK(eff.total)}: GP-rate changes ${gbpK(eff.rate)}${rateChanges(shares) ? ` (${rateChanges(shares)})` : ''} + change of mix ${gbpK(eff.mix)}.` : '';
  return {
    key: 'money-gp-mix', row: 'money', title: 'GP mix this year vs last',
    headline: { value: pctTxt(now.margin), label: 'GP margin YTD', delta: eff == null ? null : { text: `${eff.total >= 0 ? '+' : '−'}${gbpK(Math.abs(eff.total))} GP`, rag: eff.total >= 0 ? 'green' : 'red' } },
    comparison: `last year ${pctTxt(ly.margin)} · basis: GP ÷ sales of the GP categories (${gbpK(now.sales)} vs ${gbpK(ly.sales)}), each year's own GP rates · 1 Jan – ${ukDay(today)}`,
    table: { cols: ['Service', 'GP rate', `Share ${y - 1}`, `Share ${y}`, 'Δ pts'], rows, footnote: 'Share = each service\'s GP ÷ that year\'s total GP · green = more profit from ≥70% GP services · red = less · amber = low-margin service (<70%) or under 1 pt' },
    note: mixNote(shares),
    foot: `${working} Gift vouchers and Pick n Mix are outside the GP method: their value counts once, when used on an event (so this sales base differs from tile 3's turnover).`,
    link: { label: 'Fill high-margin dates →', anchor: 'st-next4' },
    source: 'Booking Sheet transactions × per-category GP rates (the dashboard\'s GP method)', numbers: { now, ly, effect: eff }
  };
}

function mixNote(rows) {
  const down = rows.filter((r) => r.rate >= 0.7 && r.d <= -1).sort((x, z) => x.d - z.d).slice(0, 2).map((r) => r.label.toLowerCase());
  const up = rows.filter((r) => r.rate < 0.7 && r.d >= 1).sort((x, z) => z.d - x.d).slice(0, 1);
  if (down.length && up.length) return `Profit shifted from ${down.join(' and ')} to ${up[0].label.toLowerCase()} (${Math.round(up[0].rate * 100)}% GP).`;
  return down.length ? `Less profit is coming from ${down.join(' and ')}.` : 'The profit mix is holding up.';
}

export const moneyRow = (ctx) => [thisMonthTile(ctx), nextThreeTile(ctx), ytdTile(ctx), gpMixTile(ctx)].map((t) => ({ ...t, freshness: ctx.sheetImported }));
export { round };
