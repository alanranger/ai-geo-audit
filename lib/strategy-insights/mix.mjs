/** MIX & GROWTH row: non-dated pace, clients who come back, Pick n Mix plans, Academy. */
import { NON_DATED, cell, gbp, gbpK, pct, ragDelta, ragFor, sameDayLastYear, signPct, sumTx } from './common.mjs';

const ukDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const minusDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
const SERVICE_ROWS = [['1-2-1', 7], ['Commissions', 11], ['Gift vouchers', 8], ['Academy', 12], ['Mentoring', 6], ['Pick n Mix', 4], ['Prints & royalties', 10]];

export function nonDatedPaceTile(ctx) {
  const { today, txns, money2 } = ctx;
  const from = minusDays(today, 27);
  const now = sumTx(txns, from, today, NON_DATED);
  const ly = sumTx(txns, sameDayLastYear(from), sameDayLastYear(today), NON_DATED);
  const daysLeft = Math.max(1, Math.round((Date.parse(`${money2.window_end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000));
  const need = (money2.nonDated / daysLeft) * 28;
  const d = pct(now, ly);
  const rows = SERVICE_ROWS.map(([label, c]) => {
    const a = sumTx(txns, sameDayLastYear(from), sameDayLastYear(today), [c]);
    const b = sumTx(txns, from, today, [c]);
    const dd = pct(b, a);
    return [cell(label), cell(gbp(a)), cell(gbp(b)), cell(a ? signPct(dd) : (b ? 'new' : '—'), a ? ragDelta(dd) : (b ? 'green' : 'grey'))];
  });
  const share = need ? Math.round((now / need) * 100) : null;
  return {
    key: 'mix-nondated-pace', row: 'mix', title: 'Non-dated sales · pace',
    headline: { value: gbp(now), label: 'last 28 days', delta: { text: signPct(d), rag: ragDelta(d) } },
    comparison: `vs ${gbp(ly)} same 28 days last year · need ≈${gbp(need)} per 28 days (${gbpK(money2.nonDated)} non-dated still needed ÷ ${daysLeft} days left to ${money2.window_end.split('-').reverse().slice(0, 2).join('/')})`,
    headRag: ragFor(now, need),
    table: { cols: ['Service', 'Last yr', 'Now', 'Δ'], rows },
    note: share == null ? '' : `${share}% of the pace needed — vouchers and 1-2-1 over Christmas are the lever.`,
    link: { label: 'Non-dated campaigns →', panel: 'marketing' },
    source: 'Booking Sheet transactions (booking date) · pace from Money tile 2'
  };
}

/* ---------- clients who come back (resolved people from the Marketing customer table) ---------- */

const isService = (b) => b.role !== 'buyer_for_other' && (b.cats || []).length > 0 && b.channel !== 'JLR' && b.date;

function personYears(bookings) {
  const dates = bookings.filter(isService).map((b) => b.date).sort();
  return { dates, first: dates[0] || null, n: new Set(bookings.filter(isService).map((b) => b.key)).size };
}

function yearCounts(people, from, to) {
  let fresh = 0;
  let ret = 0;
  for (const p of people) {
    const inWin = p.dates.some((d) => d >= from && d <= to);
    if (!inWin) continue;
    if (p.dates.some((d) => d < from)) ret += 1; else fresh += 1;
  }
  return { fresh, ret, share: fresh + ret ? (ret / (fresh + ret)) * 100 : null };
}

const SINCE = '2024-01-01';
const pctTxt = (v) => (v == null ? '—' : `${Math.round(v)}%`);
const countRow = (label, a, b) => [cell(label), cell(a), cell(b), cell(signPct(pct(b, a)), ragDelta(pct(b, a)))];

function shareRow(now, ly) {
  const known = now.share != null && ly.share != null;
  const d = known ? now.share - ly.share : null;
  return [cell('Returning share this year'), cell(pctTxt(ly.share)), cell(pctTxt(now.share)), cell(known ? `${d >= 0 ? '+' : ''}${d.toFixed(0)} pt` : '—', known ? (d >= 0 ? 'green' : 'red') : 'grey')];
}

function moneyRowR12(r) {
  const tgt = r?.target;
  return [cell('Returning £ (rolling 12m, Booking Sheet names)'), cell(r?.prior ? gbpK(r.prior) : '—'), cell(gbpK(r?.r12 || 0)), cell(tgt ? `target ${gbpK(tgt)}` : '—', ragFor(r?.pace, tgt))];
}

/** People with service bookings since 2024: confirmed (resolved) and probable (Booking Sheet name-only) kept apart. */
function cohorts(people) {
  const split = (pred) => people.filter(pred).map((p) => personYears(p.bookings || [])).filter((p) => p.dates.some((d) => d >= SINCE));
  const isName = (p) => p.anchor_key.startsWith('name:');
  return { resolved: people.filter((p) => !isName(p)).map((p) => personYears(p.bookings || [])), since: split((p) => !isName(p)), probable: split(isName) };
}

export function returningTile(ctx) {
  const { people, today, returning } = ctx;
  const c = cohorts(people);
  const repeat = c.since.filter((p) => p.n >= 2).length;
  const y = Number(today.slice(0, 4));
  const now = yearCounts(c.resolved, `${y}-01-01`, today);
  const ly = yearCounts(c.resolved, `${y - 1}-01-01`, sameDayLastYear(today));
  const rate = c.since.length ? (repeat / c.since.length) * 100 : null;
  return {
    key: 'mix-returning', row: 'mix', title: 'Clients who come back',
    headline: { value: pctTxt(rate), label: 'observed repeat since 2024', delta: null },
    comparison: `${repeat} of ${c.since.length} non-JLR clients since 2024 booked again (resolved people; an order seen in Squarespace and the Booking Sheet counts once)`,
    table: { cols: [`Year to ${ukDay(today).slice(4)}`, String(y - 1), String(y), 'Δ'], rows: [countRow('New clients', ly.fresh, now.fresh), countRow('Returning clients', ly.ret, now.ret), shareRow(now, ly), moneyRowR12(returning)] },
    foot: `Probable (Booking Sheet name-only, never merged): ${c.probable.filter((p) => p.n >= 2).length} of ${c.probable.length} records since 2024 booked again.`,
    note: rate != null && rate < 25 ? 'Most people book once; the repeat base isn\'t growing.' : 'A healthy share of clients come back.',
    link: { label: 'Repeat clients →', panel: 'marketing' },
    source: 'Marketing customer table (confirmed matches) · Booking Sheet + Squarespace orders · JLR excluded'
  };
}

/* ---------- Pick n Mix ---------- */

const lastNight = (e) => {
  const weeks = /5\s*-?\s*w/i.test(e.title) ? 4 : (/3\s*-?\s*w|3wk|3-week/i.test(e.title) ? 2 : 0);
  return new Date(Date.parse(`${e.date}T00:00:00Z`) + weeks * 7 * 86400000).toISOString().slice(0, 10);
};

export function pickNMixTile(ctx) {
  const { plans, roadmap, diary, today, terms } = ctx;
  const sold = plans.length;
  const dec = roadmap.find((r) => r.key === 'dec26');
  const mar = roadmap.find((r) => r.key === 'mar27');
  const next = diary.filter((e) => e.type === 'course' && e.date >= today).slice(0, 4)
    .map((e) => [cell(String(e.title).split(/[|–]/)[0].trim().slice(0, 34)), cell(ukDay(lastNight(e))), cell(e.booked, e.booked > 0 ? 'amber' : 'red')]);
  return {
    key: 'mix-pick-n-mix', row: 'mix', title: 'Pick n Mix plans',
    headline: { value: String(sold), label: 'since relaunch', delta: null, rag: ragFor(sold, dec?.plans) },
    comparison: `target ${dec?.plans ?? '—'} by Dec · ${mar?.plans ?? '—'} by Mar (Targets panel)${terms ? ` · terms: ${terms}` : ''}`,
    table: { cols: ['Next chance (course last night)', 'Date', 'Booked'], rows: next.length ? next : [[cell('No qualifying course dated yet'), cell('—'), cell('—')]] },
    note: 'Ready and waiting: plans come from courses running — fill those first. Status: waiting on next qualifying course (never overdue).',
    link: { label: 'Programme: course → plan →', anchor: 'beginners-plans' },
    source: 'Booking Sheet plans sheet · Targets panel roadmap · diary course dates'
  };
}

/* ---------- Academy ---------- */

function monthlyAvg(map, months) {
  const vals = months.map((m) => map.get(m) || 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export function academyTile(ctx) {
  const { academy, txns, today } = ctx;
  const y = Number(today.slice(0, 4));
  const now = sumTx(txns, `${y}-01-01`, today, [12]);
  const ly = sumTx(txns, `${y - 1}-01-01`, sameDayLastYear(today), [12]);
  const paid = new Map();
  for (const t of txns) if (Number(t.category_order) === 12 && Number(t.amount) > 0) paid.set(t.txn_date.slice(0, 7), (paid.get(t.txn_date.slice(0, 7)) || 0) + 1);
  const firstQ = [`${y}-01`, `${y}-02`, `${y}-03`];
  const cur = Number(today.slice(5, 7));
  const lastQ = [3, 2, 1].map((i) => new Date(Date.UTC(y, cur - 1 - i, 1)).toISOString().slice(0, 7));
  const trials = academy?.trials_by_month ? new Map(Object.entries(academy.trials_by_month)) : null;
  const row = (label, map) => { const a = map ? monthlyAvg(map, firstQ) : null; const b = map ? monthlyAvg(map, lastQ) : null; const d = pct(b, a); return [cell(label), cell(a == null ? '—' : a.toFixed(1)), cell(b == null ? '—' : b.toFixed(1)), cell(signPct(d), ragDelta(d))]; };
  const lab = (ms) => `${new Date(`${ms[0]}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}–${new Date(`${ms[2]}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
  return {
    key: 'mix-academy', row: 'mix', title: 'Academy',
    headline: { value: academy?.paying == null ? '—' : String(academy.paying), label: 'paying members', delta: null },
    comparison: `Academy sales ${gbpK(now)} YTD (${signPct(pct(now, ly))} vs ${gbpK(ly)}) · trials, paying members and new paid starts shown separately — no trial→paid ratio until a 90-day trial cohort is defined`,
    table: { cols: ['Per month (average)', lab(firstQ), lab(lastQ), 'Δ'], rows: [row('Free trials started', trials), row('New paying members (Academy sales)', paid)] },
    note: academyNote(now, ly, trials, firstQ, lastQ),
    link: { label: 'Academy funnel →', panel: 'acquisition' },
    source: `Memberstack ${academy?.available ? `(${academy.members} members, live)` : '(not available)'} · Booking Sheet Academy sales`
  };
}

function academyNote(now, ly, trials, firstQ, lastQ) {
  const t = trials ? pct(monthlyAvg(trials, lastQ), monthlyAvg(trials, firstQ)) : null;
  const sales = now >= ly ? 'Revenue grew from a small base' : 'Academy revenue is down';
  if (t == null) return `${sales}; trial starts aren't available.`;
  return t < -20 ? `${sales}, but new trials fell sharply in recent months — the cause isn't known yet.` : `${sales}; trial starts are holding.`;
}

export function mixRow(ctx) {
  return [nonDatedPaceTile(ctx), returningTile(ctx), pickNMixTile(ctx), academyTile(ctx)];
}
