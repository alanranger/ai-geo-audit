/** MIX & GROWTH row: non-dated pace, clients who come back, Pick n Mix plans, Academy. */
import { NON_DATED, cell, gbp, gbpK, pct, ragDelta, ragFor, sameDayLastYear, signPct, sumTx } from './common.mjs';
import { normName } from '../marketing/store.mjs';
import { recordType } from '../marketing/record-type.mjs';
import { DEFAULT_PNM_RELAUNCH } from '../marketing/plan-sources.mjs';

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

/* ---------- clients who come back (every client once: Booking Sheet sales, grouped by person) ---------- */

const SINCE = '2024-01-01';
const pctTxt = (v) => (v == null ? '—' : `${Math.round(v)}%`);
const countRow = (label, a, b) => [cell(label), cell(a), cell(b), cell(signPct(pct(b, a)), ragDelta(pct(b, a)))];

/**
 * Client = one person (Claude C1/C9/C10, 7 Nov 2026): every non-JLR, positive Booking Sheet sale since 2024, whether
 * the client has an email or not. A name record shown under a Squarespace contact is that contact; ledger labels
 * ("Pick n Mix Subs", "Mentoring Subs", …) are not clients. Repeat = sales on 2+ different dates.
 */
function nameGroups(people) {
  const group = new Map();
  for (const p of people || []) {
    if (!p.anchor_key?.startsWith('name:')) continue;
    group.set(p.anchor_key.slice(5), { key: p.attached || p.anchor_key, system: p.rtype === 'system', linked: !!p.attached });
  }
  return group;
}
const isClientSale = (t) => !t.is_jlr && t.channel !== 'JLR' && Number(t.amount) > 0 && !!t.txn_date && t.txn_date >= SINCE;

export function clientSales(txns, people) {
  const group = nameGroups(people);
  const out = new Map();
  for (const t of txns || []) {
    const name = normName(t.client_name);
    if (!name || !isClientSale(t)) continue;
    const g = group.get(name) || { key: `name:${name}`, system: recordType({ name: t.client_name }) === 'system', linked: false };
    if (g.system) continue;
    if (!out.has(g.key)) out.set(g.key, { dates: new Set(), linked: g.linked });
    out.get(g.key).dates.add(t.txn_date);
  }
  return [...out.values()].map((c) => ({ dates: [...c.dates].sort(), linked: c.linked }));
}

function yearCounts(clients, from, to) {
  let fresh = 0;
  let ret = 0;
  for (const c of clients) {
    if (!c.dates.some((d) => d >= from && d <= to)) continue;
    if (c.dates.some((d) => d < from)) ret += 1; else fresh += 1;
  }
  return { fresh, ret, share: fresh + ret ? (ret / (fresh + ret)) * 100 : null };
}

function shareRow(now, ly) {
  const known = now.share != null && ly.share != null;
  const d = known ? now.share - ly.share : null;
  return [cell('Returning share this year'), cell(pctTxt(ly.share)), cell(pctTxt(now.share)), cell(known ? `${d >= 0 ? '+' : ''}${d.toFixed(0)} pt` : '—', known ? (d >= 0 ? 'green' : 'amber') : 'grey')];
}

const MONTH_KEY = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/** The next dated Roadmap milestone for returning £ (e.g. "dec26" → £16k by 31 Dec 2026), not the annual figure. */
export function nextMilestone(roadmap, today) {
  const dated = (roadmap || []).filter((r) => r.returning_r12 && /^[a-z]{3}\d{2}$/.test(r.key)).map((r) => {
    const m = MONTH_KEY[r.key.slice(0, 3)];
    const y = 2000 + Number(r.key.slice(3));
    return { ...r, by: new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10) };
  }).filter((r) => r.by >= today).sort((x, y) => x.by.localeCompare(y.by));
  return dated[0] || null;
}

function moneyRowR12(r, ms) {
  const tgt = ms?.returning_r12 || null;
  const label = ms ? `${ms.label} milestone ${gbpK(tgt)}${r?.target ? ` (year ${gbpK(r.target)})` : ''}` : (r?.target ? `year target ${gbpK(r.target)}` : '—');
  return [cell('Returning £ (rolling 12m)'), cell(r?.prior ? gbpK(r.prior) : '—'), cell(gbpK(r?.r12 || 0)), cell(label, ragFor(r?.r12, tgt || r?.target))];
}

export function returningTile(ctx) {
  const { people, today, returning, roadmap, txns } = ctx;
  const clients = clientSales(txns, people);
  const repeat = clients.filter((c) => c.dates.length >= 2);
  const y = Number(today.slice(0, 4));
  const now = yearCounts(clients, `${y}-01-01`, today);
  const ly = yearCounts(clients, `${y - 1}-01-01`, sameDayLastYear(today));
  const rate = clients.length ? (repeat.length / clients.length) * 100 : null;
  const ms = nextMilestone(roadmap, today);
  return {
    key: 'mix-returning', row: 'mix', title: 'Clients who come back',
    headline: { value: pctTxt(rate), label: 'observed repeat since 2024', delta: null },
    comparison: `${repeat.length} of ${clients.length} non-JLR clients since 2024 bought again on another date (every client counted once, with or without an email; ledger labels like "Pick n Mix Subs" excluded)`,
    table: { cols: [`Year to ${ukDay(today).slice(4)}`, String(y - 1), String(y), 'Δ'], rows: [countRow('New clients', ly.fresh, now.fresh), countRow('Returning clients', ly.ret, now.ret), shareRow(now, ly), moneyRowR12(returning, ms), ...(ctx.planInfo?.income_r12 ? [[cell('+ plan payments not on the Booking Sheet (12m)'), cell('—'), cell(gbpK(ctx.planInfo.income_r12)), cell('PnM Plans tab + statements', 'grey')]] : [])] },
    foot: `${clients.filter((c) => c.linked).length} of these clients are Booking Sheet names shown under their Squarespace contact (probable link, reversible); repeat evidence is the Booking Sheet sale dates either way.`,
    note: rate != null && rate < 25 ? 'Most people book once; the repeat base isn\'t growing fast.' : 'A healthy share of clients come back.',
    link: { label: 'Repeat clients →', panel: 'marketing' },
    source: 'Booking Sheet sales since 2024 (positive, non-JLR) · grouped by person via the Marketing customer table · Roadmap milestone'
  };
}

/* ---------- Pick n Mix ---------- */

const lastNight = (e) => {
  const weeks = /5\s*-?\s*w/i.test(e.title) ? 4 : (/3\s*-?\s*w|3wk|3-week/i.test(e.title) ? 2 : 0);
  return new Date(Date.parse(`${e.date}T00:00:00Z`) + weeks * 7 * 86400000).toISOString().slice(0, 10);
};

/**
 * Plans sold since the relaunch (PnM Plans tab rows from the Targets panel date). Until a row exists the tile reads
 * "Relaunch Tue 10 Nov · 0 plans yet" in grey: not behind, not overdue.
 */
export function pnmHeadline(pi, decTarget) {
  const when = ukDay(pi?.relaunch || DEFAULT_PNM_RELAUNCH);
  const sold = Number(pi?.since_relaunch) || 0;
  if (!sold) return { sold: 0, when, rag: 'grey', lead: `Relaunch ${when} · 0 plans yet` };
  return { sold, when, rag: ragFor(sold, decTarget), lead: `${sold} plan${sold === 1 ? '' : 's'} sold since the relaunch ${when} (PnM Plans tab)` };
}

function pnmComparison(h, pi, dec, mar, terms) {
  const live = pi ? ` · ${pi.active} plans active now · plan income last 12 months ${gbpK(pi.income_r12)} (not already a Squarespace order or Booking Sheet row)` : '';
  return `${h.lead} · target ${dec?.plans ?? '—'} by Dec · ${mar?.plans ?? '—'} by Mar (Targets panel)${live}${terms ? ` · terms: ${terms}` : ''}`;
}

/**
 * One lifecycle state per dated course: sold_out / cancelled / withdrawn / not_promoted (strategy_event_overrides
 * promote_mode, keyed date|url or the diary key) / running. Withdrawn and cancelled dates normally leave the live diary.
 */
export function courseState(e, dontPromote) {
  if (e.full) return 'sold_out';
  if (e.cancelled) return 'cancelled';
  if (e.withdrawn) return 'withdrawn';
  if (dontPromote?.has(e.eventKey) || dontPromote?.has(`${e.date}|${e.url}`)) return 'not_promoted';
  return 'running';
}
const STATE_TEXT = { running: 'running', not_promoted: 'not promoted', sold_out: 'sold out', cancelled: 'cancelled', withdrawn: 'withdrawn' };
/** A confirmed Pick n Mix opportunity = a running beginners course with bookings (its last night is where plans are offered). */
export const isConfirmedCourse = (c) => c.state === 'running' && c.booked > 0;

/** Upcoming beginners courses with their state, by last night. */
export function beginnersCourses(diary, today, dontPromote) {
  return (diary || []).filter((e) => e.type === 'course' && !e.is_subrow && /beginner/i.test(e.title) && e.date >= today)
    .map((e) => ({ start: e.date, last_night: lastNight(e), booked: Number(e.booked) || 0, state: courseState(e, dontPromote) }))
    .sort((a, b) => a.last_night.localeCompare(b.last_night));
}
function courseRow(c) {
  const booked = c.booked ? `${c.booked} booked` : '0 booked';
  const conf = isConfirmedCourse(c);
  const note = conf ? booked : `${booked} — ${c.state === 'running' ? 'listed, not confirmed' : STATE_TEXT[c.state]}`;
  return [cell(`Beginners · starts ${ukDay(c.start)}`), cell(ukDay(c.last_night)), cell(note, conf ? 'green' : 'grey'), cell(STATE_TEXT[c.state])];
}

export function pickNMixTile(ctx) {
  const { roadmap, diary, today, terms, dontPromote, planInfo: pi } = ctx;
  const dec = roadmap.find((r) => r.key === 'dec26');
  const mar = roadmap.find((r) => r.key === 'mar27');
  const courses = beginnersCourses(diary, today, dontPromote);
  const nextConfirmed = courses.find(isConfirmedCourse) || null;
  const next = courses.slice(0, 6).map(courseRow);
  const h = pnmHeadline(pi, dec?.plans);
  return {
    key: 'mix-pick-n-mix', row: 'mix', title: 'Pick n Mix plans',
    headline: { value: String(h.sold), label: 'since relaunch', delta: null, rag: h.rag },
    comparison: pnmComparison(h, pi, dec, mar, terms),
    numbers: { since_relaunch: h.sold, relaunch: pi?.relaunch || DEFAULT_PNM_RELAUNCH, relaunch_label: h.when, status_line: h.lead, active: pi?.active ?? null, income_r12: pi?.income_r12 ?? null, sheet_rows: pi?.sheet_rows ?? null, next_confirmed: nextConfirmed, courses },
    table: { cols: ['Beginners course', 'Last night', 'Booked', 'State'], rows: next.length ? next : [[cell('No beginners course dated yet'), cell('—'), cell('—'), cell('—')]] },
    note: 'New plans are offered on a beginners course last night. A confirmed opportunity is a running course with bookings; a 0-booked, not-promoted, withdrawn, cancelled or sold-out course is listed with its state, never as a confirmed opportunity (waiting, never overdue). Existing learners can be nurtured towards a plan now.',
    link: { label: 'Programme: course → plan →', anchor: 'beginners-plans' },
    source: 'Booking Sheet PnM Plans tab (plans from the relaunch) · old plan statements (history, read-only) · Targets panel roadmap + relaunch date · diary course dates'
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
