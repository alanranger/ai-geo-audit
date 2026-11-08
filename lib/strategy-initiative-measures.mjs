/**
 * Quarter plan measures: KPI boxes per quarter and the evidence lines per initiative. Same sources and methods as the
 * Strategy money tiles: Booking Sheet sales by booking date (lib/strategy-insights/common.mjs), the dashboard's one GP
 * method (GP categories × per-category rates), seasonal survival targets and roadmap milestones from the Targets panel.
 * Windows are labelled: sales to a date; plans and non-JLR beginners as cumulative milestones with their start; returning
 * £ as rolling 12 months. Unknown is shown as unknown, never as £0. RAG only against a disclosed dated benchmark.
 */
import { GP_CATEGORY_ORDERS } from './targets-master.mjs';
import { gbp, gbpK, gpTx, monthEnd, ragFor, rateLookup, sumTx } from './strategy-insights/common.mjs';
import { shortName } from './strategy-board-rows.mjs';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MKEY = Object.fromEntries(MON.map((m, i) => [m.toLowerCase(), i]));
const d10 = (v) => (v ? String(v).slice(0, 10) : null);
const ukDate = (iso) => (iso ? `${Number(d10(iso).slice(8, 10))} ${MON[Number(d10(iso).slice(5, 7)) - 1]} ${d10(iso).slice(0, 4)}` : '—');
const ukDay = (iso) => (iso ? new Date(`${d10(iso)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—');
const days = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const minIso = (a, b) => (a < b ? a : b);
const cellV = (c) => (c && typeof c === 'object' ? c.v : c);
export const FY_START = '2026-10-01';

/** Squarespace schedule time + recipients: the campaign record's schedule columns, else its latest "scheduled" history entry. */
export function scheduleOf(row) {
  if (row?.scheduled_for) return { scheduled_for: row.scheduled_for, recipients: row.scheduled_recipients ?? null };
  return [...(row?.stage_history || [])].reverse().find((h) => h.stage === 'scheduled' && (h.scheduled_for || h.recipients)) || null;
}
export function insightTile(insights, key) {
  const r = insights?.rows || {};
  return [...(r.money || []), ...(r.demand || []), ...(r.mix || [])].find((t) => t.key === key) || null;
}
/** "dec26" → 2026-12-31 (same rule as the Strategy returning tile). */
export function milestoneEnd(key) {
  const m = /^([a-z]{3})(\d{2})$/.exec(String(key || ''));
  return m ? monthEnd(2000 + Number(m[2]), MKEY[m[1]] + 1) : null;
}
function milestone(ctx, key) {
  const r = (ctx.roadmap || ctx.master?.roadmap_targets || []).find((x) => x.key === key);
  return r ? { ...r, by: milestoneEnd(key) } : null;
}
function monthsOf(q) {
  const out = [];
  for (let y = Number(q.start_date.slice(0, 4)), m = Number(q.start_date.slice(5, 7)); `${y}-${String(m).padStart(2, '0')}` <= q.end_date.slice(0, 7);) {
    out.push({ y, m });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
const ym = (mm) => `${mm.y}-${String(mm.m).padStart(2, '0')}`;

/* ---------- KPI boxes ---------- */

/** Seasonal survival targets for the quarter's months still to come; the current month net of what is already booked. */
function remainingTargets(q, ctx, series, booked) {
  const cur = ctx.today.slice(0, 7);
  return monthsOf(q).filter((mm) => ym(mm) >= cur).map((mm) => {
    const t = Number(series?.[mm.m - 1]) || 0;
    return { mm, value: ym(mm) === cur ? Math.max(0, t - booked) : t, current: ym(mm) === cur };
  });
}
/** GP beside sales: the same months' survival GP (Targets panel) net of GP booked this month, dashboard GP method. */
function gpPart(q, state, ctx, rate, monthStart) {
  const txns = ctx.txns || [];
  const gp = remainingTargets(q, ctx, ctx.master?.seasonal?.survival, gpTx(txns, monthStart, ctx.today, rate, GP_CATEGORY_ORDERS));
  const total = gp.reduce((a, p) => a + p.value, 0);
  const qtd = state === 'current' ? gpTx(txns, q.start_date, ctx.today, rate, GP_CATEGORY_ORDERS) : null;
  const booked = qtd != null ? ` · booked this quarter ${gbpK(qtd)}` : '';
  return { value: gbpK(total), raw: total, qtd, line: `GP ${state === 'current' ? 'still needed' : 'target'} ${gbpK(total)}${booked}`, basis: 'same months\' survival GP (Targets panel) · GP categories × per-category rates (the dashboard\'s GP method)' };
}
function salesBox(q, state, ctx) {
  if (state === 'past') return { key: 'sales', label: 'Sales', value: 'Quarter ended', sub: `${ukDate(q.start_date)} – ${ukDate(q.end_date)}` };
  const rate = rateLookup(ctx.gpRates || []);
  const monthStart = `${ctx.today.slice(0, 7)}-01`;
  const sales = remainingTargets(q, ctx, ctx.master?.revenue_equivalent?.survival_monthly, sumTx(ctx.txns || [], monthStart, ctx.today));
  const total = sales.reduce((a, p) => a + p.value, 0);
  const parts = sales.map((p) => `${MON[p.mm.m - 1]} ${gbpK(p.value)}${p.current ? ' left' : ''}`).join(' + ');
  const span = `${MON[sales[0]?.mm.m - 1] || ''}–${MON[Number(q.end_date.slice(5, 7)) - 1]}`;
  return {
    key: 'sales', label: state === 'current' ? 'Sales still needed' : `Sales target ${span}`, value: gbpK(total), raw: total,
    sub: `to ${ukDate(q.end_date).replace(/ \d{4}$/, '')} · ${parts}`, gp: gpPart(q, state, ctx, rate, monthStart),
    window: `sales to ${ukDate(q.end_date)} · seasonal survival targets (Targets panel), current month net of sales booked so far (Booking Sheet, booking date)`
  };
}
function plansBox(ms, state, ctx) {
  const relaunch = ctx.pnm?.relaunch || null;
  const sold = ctx.pnm?.since_relaunch;
  if (state !== 'current') return { key: 'plans', label: 'Pick n Mix plans', value: `${ms.plans} by ${ms.label}`, sub: 'cumulative milestone (Targets panel roadmap)', window: 'cumulative' };
  return {
    key: 'plans', label: 'Pick n Mix plans', value: `${sold ?? '—'} / ${ms.plans}`, actual: sold ?? null, target: ms.plans,
    sub: `cumulative from relaunch ${relaunch ? ukDate(relaunch).replace(/ \d{4}$/, '') : '(date not set)'} · by ${ukDate(ms.by).replace(/ \d{4}$/, '')}`, window: `cumulative milestone from the relaunch date (Targets panel) to ${ukDate(ms.by)}`
  };
}
function beginnersBox(ms, state, ctx) {
  const now = ctx.roadmapNow?.beginners_non_jlr;
  if (state !== 'current') return { key: 'beginners', label: 'Non-JLR beginners', value: `${ms.beginners_non_jlr} by ${ms.label}`, sub: `cumulative since ${ukDate(FY_START)}`, window: 'cumulative' };
  return {
    key: 'beginners', label: 'Non-JLR beginners taught', value: `${now ?? '—'} / ${ms.beginners_non_jlr}`, actual: now ?? null, target: ms.beginners_non_jlr,
    sub: `cumulative from 1 Oct · milestone ${ms.label}`, window: `cumulative milestone: non-JLR beginners whose course started from ${ukDate(FY_START)}`
  };
}
function returningBox(ms, state, ctx) {
  const now = ctx.roadmapNow?.returning_r12;
  if (state !== 'current') return { key: 'returning', label: 'Returning £ (R12)', value: gbpK(ms.returning_r12), sub: `${ms.label} milestone · rolling 12 months`, window: 'rolling 12 months' };
  return {
    key: 'returning', label: 'Returning £ (rolling 12 m)', value: `${now == null ? '—' : gbpK(now)} / ${gbpK(ms.returning_r12)}`, actual: now ?? null, target: ms.returning_r12,
    sub: `${ms.label} milestone`, window: 'rolling 12 months: non-JLR sales from clients first seen before the window'
  };
}
export function kpiBoxes(q, state, ctx) {
  const ms = milestone(ctx, q.milestone_key);
  const boxes = [salesBox({ ...q, start_date: d10(q.start_date), end_date: d10(q.end_date) }, state, ctx)];
  if (!ms) return boxes;
  return [...boxes, plansBox(ms, state, ctx), beginnersBox(ms, state, ctx), returningBox(ms, state, ctx)];
}

/* ---------- initiative measures ---------- */

const line = (label, value, sub = null) => ({ label, value, sub });
const quarterMilestone = (ini, ctx) => {
  const q = (ctx.quarters || []).find((x) => (ini.quarter_keys || []).includes(x.quarter_key) && x.milestone_key);
  return q ? milestone(ctx, q.milestone_key) : null;
};

function giftLine(l, from, to, ctx) {
  if (l.actual === 'booking_sheet_category') {
    const rows = (ctx.txns || []).filter((t) => Number(t.category_order) === l.category && String(t.txn_date) >= from && String(t.txn_date) <= to && Number(t.amount) > 0);
    const actual = rows.reduce((a, t) => a + Number(t.amount), 0);
    return { ...l, actual, units: rows.length, gap: Math.max(0, l.amount - actual), evidence_basis: `Booking Sheet category ${l.category} by order date` };
  }
  const ev = Array.isArray(l.evidence) ? l.evidence : [];
  const tagged = ev.reduce((a, e) => a + (Number(e.amount) || 0), 0);
  return { ...l, actual: l.evidence_complete ? tagged : null, tagged: ev.length ? tagged : null, units: ev.length, gap: null, evidence_basis: ev.length ? `${ev.length} tagged sale(s); untagged sales unknown` : 'not tagged yet: unknown, not £0' };
}
function giftMeasure(ini, ctx) {
  const t = ini.target || {};
  const w = t.window || {};
  const to = minIso(ctx.today, w.end || ctx.today);
  const lines = (t.lines || []).map((l) => giftLine(l, w.start, to, ctx));
  const unknown = lines.some((l) => l.actual == null) ? 'gift 1-to-1 actuals need explicit evidence or tagging; unknown is not £0' : null;
  const all121 = sumTx((ctx.txns || []).filter((x) => !x.is_jlr), w.start, to, [7]);
  const rate = rateLookup(ctx.gpRates || [])(Number(ctx.today.slice(0, 4)), 7);
  const actual = unknown ? null : lines.reduce((a, l) => a + l.actual, 0);
  return {
    kind: 'gift', target_total: t.total ?? null, approved: t.approved || null, window: w, stretch: t.stretch || null, baselines: t.baselines || [], target_lines: lines, unknown,
    pace: unknown || !t.total ? null : { actual, target: t.total, start: w.start, end: w.end },
    lines: [line(`Context only, all non-JLR 1-to-1 ${ukDate(w.start).replace(/ \d{4}$/, '')} – ${ukDate(to)}`, gbp(all121), 'all 1-to-1 sales (Booking Sheet), not gift actuals')],
    gp: `Gift vouchers sit outside the GP method (their value counts once, when used on an event) · gift 1-to-1 GP at the 1-2-1 rate (${Math.round(rate * 100)}%)`
  };
}

function sendLine(rec) {
  if (!rec) return line('Launch email', 'campaign record not found');
  const sch = scheduleOf(rec);
  if (rec.sent_on || rec.actual_sends) return line('Launch email', `sent ${ukDay(rec.sent_on)} · ${rec.actual_sends ?? '?'} sends`, 'from the campaign record');
  const when = sch?.scheduled_for ? new Date(sch.scheduled_for).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).replace(',', '') : 'time not recorded';
  return line('Launch email', `${rec.stage} ${when} · ${rec.reserved_sends ?? sch?.recipients ?? '?'} sends reserved · not sent`, 'delivery state from the campaign record (Squarespace schedule)');
}
function plansLine(sold, ms, relaunch) {
  return line('Plans since relaunch', `${sold ?? 'not available'}${ms ? ` / ${ms.plans}` : ''}`, `cumulative from ${ukDate(relaunch)} · milestone ${ms ? ukDate(ms.by) : '—'}`);
}
function pnmMeasure(ini, ctx) {
  const pnm = ctx.pnm || {};
  const rec = (ctx.campaignRows || []).find((r) => r.campaign_key === ini.focus?.campaign_key);
  const ms = quarterMilestone(ini, ctx);
  const sold = pnm.since_relaunch ?? null;
  const next = (ctx.courseLastNights || []).find((c) => c.beginners);
  const lines = [
    sendLine(rec), plansLine(sold, ms, pnm.relaunch),
    line('Next beginners course last night', next ? ukDay(next.date) : 'none in the live diary', 'live website course dates (plan sheet on the last night)'),
    line('Plan income (12 months)', pnm.income_r12 == null ? 'not available' : gbp(pnm.income_r12), 'plan payments not already a Squarespace order or Booking Sheet row')
  ];
  const pace = sold != null && ms && pnm.relaunch ? { actual: sold, target: ms.plans, start: pnm.relaunch, end: ms.by } : null;
  return { kind: 'pnm', lines, pace, gp: 'Pick n Mix sits outside the GP method: plan value counts once, when used on an event' };
}

function focusRows(ini, ctx) {
  const f = ini.focus || {};
  const rows = (ctx.diary || []).filter((e) => !e.is_subrow && e.date >= ctx.today);
  const named = (f.events || []).map((m) => rows.find((e) => String(e.title).toLowerCase().includes(m))).filter(Boolean);
  const courses = rows.filter((e) => e.type === 'course' && e.date >= (f.courses_from || '9999') && e.date <= (f.courses_to || ''));
  return { named, courses };
}
function offerText(e, ctx) {
  const o = ctx.campaign?.overrides?.[e.eventKey];
  if (!o?.offer_note || (o.offer_ends && d10(o.offer_ends) < ctx.today)) return '';
  return ` · offer: ${o.offer_note}${o.offer_code ? ` (${o.offer_code})` : ''}${o.offer_ends ? ` to ${ukDay(o.offer_ends)}` : ''}`;
}
const gpOf = (e, k) => e[`${k}_free`] ?? e[k] ?? null;
function eventLine(e, ctx) {
  const when = e.end && e.end > e.date ? `${ukDay(e.date)}–${ukDay(e.end)}` : ukDay(e.date);
  const gpNow = gpOf(e, 'gp_now');
  const gpFull = gpOf(e, 'gp_full');
  return line(`${shortName({ title: e.title, kind: e.type === 'course' ? 'course' : 'day' })} ${when}`, `${e.booked}/${e.cap} booked`,
    `GP now ${gpNow == null ? '—' : gbp(gpNow)} · if full ${gpFull == null ? '—' : gbp(gpFull)}${offerText(e, ctx)}`);
}
function datedMeasure(ini, ctx) {
  const { named, courses } = focusRows(ini, ctx);
  const m2 = insightTile(ctx.insights, 'money-next-3')?.numbers;
  const money = m2 ? line(`Dated places to ${ukDate(m2.window_end)}`, `${gbpK(m2.potential)} potential · ${m2.forecast == null ? 'forecast unavailable' : `${gbpK(m2.forecast)} likely`}`,
    'same window and method as the money tile: full-price potential and the likely forecast are two views, never added') : line('Dated places', 'money tile not available');
  const courseLine = courses.length ? line('January courses', courses.map((e) => `${ukDay(e.date)} (${e.booked}/${e.cap})`).join(' · '), 'live diary') : null;
  const gpNow = named.reduce((a, e) => a + (gpOf(e, 'gp_now') || 0), 0);
  const gpFull = named.reduce((a, e) => a + (gpOf(e, 'gp_full') || 0), 0);
  return {
    kind: 'dated', lines: [...named.map((e) => eventLine(e, ctx)), courseLine, money].filter(Boolean), pace: null,
    gp: named.length ? `GP on these dates now ${gbp(gpNow)} · if every place sells ${gbp(gpFull)} (Strategy diary GP, free time)` : null,
    potential: m2?.potential ?? null, forecast: m2?.forecast ?? null, window_end: m2?.window_end ?? null
  };
}

function academyMeasure(ini, ctx) {
  const t = insightTile(ctx.insights, 'mix-academy');
  if (!t) return { kind: 'academy', lines: [line('Academy', 'figures not available')], pace: null, gp: null };
  const cols = t.table?.cols || [];
  const trial = (t.table?.rows || []).find((r) => /trials/i.test(String(cellV(r[0]))));
  const y = ctx.today.slice(0, 4);
  const rate = rateLookup(ctx.gpRates || []);
  const sales = sumTx(ctx.txns || [], `${y}-01-01`, ctx.today, [12]);
  return {
    kind: 'academy', pace: null,
    lines: [
      line('Paying members', t.headline?.value ?? '—', t.source),
      line('Free trials started (average per month)', trial ? `${cols[1]} ${cellV(trial[1])} → ${cols[2]} ${cellV(trial[2])}` : 'not available', 'Memberstack sign-up month; a count of trials, not a conversion rate')
    ],
    gp: `Academy sales ${gbpK(sales)} since 1 Jan ${y} · GP ${gbpK(gpTx(ctx.txns || [], `${y}-01-01`, ctx.today, rate, [12]))} (dashboard GP method)`
  };
}

function milestonesMeasure(ini, ctx) {
  const ms = quarterMilestone(ini, ctx);
  if (!ms) return { kind: 'milestones', lines: [], pace: null, gp: null };
  const now = ctx.roadmapNow || {};
  const L = {
    plans: () => line(`Pick n Mix plans by ${ms.label}`, String(ms.plans), `cumulative milestone · now ${ctx.pnm?.since_relaunch ?? '—'} since relaunch`),
    beginners: () => line(`Non-JLR beginners by ${ms.label}`, String(ms.beginners_non_jlr), `cumulative since ${ukDate(FY_START)} · now ${now.beginners_non_jlr ?? '—'}`),
    returning: () => line(`Returning £ at ${ms.label}`, gbpK(ms.returning_r12), `rolling 12 months · now ${now.returning_r12 == null ? '—' : gbpK(now.returning_r12)}`)
  };
  return { kind: 'milestones', lines: (ini.focus?.metrics || []).map((k) => L[k]?.()).filter(Boolean), pace: null, gp: null };
}

function leadTimesMeasure(ini, ctx) {
  const lt = ctx.campaign?.lead_times || {};
  const part = (k, label) => (lt[k]?.median_days != null ? `${label} ${Math.round(lt[k].median_days / 7)} wk (${lt[k].n})` : null);
  const txt = [part('residential', 'residential'), part('day', 'day'), part('course', 'course')].filter(Boolean).join(' · ');
  return { kind: 'lead_times', pace: null, gp: null, lines: [line('Half of bookings arrive by (median, weeks before the date)', txt || 'not available', lt.window?.basis || 'booking date → event start, rolling 24 months')] };
}

function purposeMeasure(ini, ctx) {
  const m = ctx.purposeMix;
  if (!m) return { kind: 'purpose', lines: [], pace: null, gp: null };
  const b = m.by_primary;
  return {
    kind: 'purpose', pace: null, gp: null,
    lines: [
      line(`Next 4 weeks: ${m.deliveries} deliveries`, `Sell ${b.sell} · Educate ${b.educate} · Inspire ${b.inspire} · Nurture ${b.nurture}`, `each delivery counted once · ${m.set_by_hand} tagged by hand, ${m.by_rule} by channel rule`),
      line(`Module mix (${m.modules.total})`, `Sell ${m.modules.by_purpose.sell} · Educate ${m.modules.by_purpose.educate} · Inspire ${m.modules.by_purpose.inspire} · Nurture ${m.modules.by_purpose.nurture}`, 'each featured date or folded-in item, counted separately from deliveries')
    ]
  };
}

export function measureFor(ini, ctx) {
  const fns = { gift: giftMeasure, pnm: pnmMeasure, dated: datedMeasure, academy: academyMeasure, milestones: milestonesMeasure, lead_times: leadTimesMeasure, purpose: purposeMeasure };
  const fn = fns[ini.measure];
  return fn ? { ...fn(ini, ctx), data_through: ctx.insights?.booking_sheet_imported_at || null } : { kind: null, lines: [], pace: null, gp: null };
}

/* ---------- status ---------- */

const grey = (label, reason) => ({ label, rag: 'grey', reason: reason || null });
function paceStatus(ini, p, today) {
  const label = ini.status_label || 'Not started';
  if (!p.start || today < p.start) return grey(label, `benchmark starts ${ukDate(p.start)}`);
  const span = Math.max(1, days(p.start, p.end));
  const expected = p.target * Math.min(1, days(p.start, today) / span);
  const rag = ragFor(p.actual, expected);
  const word = { green: 'On pace', amber: 'Slightly behind pace', red: 'Behind pace' }[rag];
  return { label: word, rag, reason: `${p.actual} vs ${Math.round(expected * 10) / 10} expected by today`, benchmark: ini.status_rule?.benchmark || 'straight-line pace' };
}
/** RAG only against a disclosed dated benchmark; otherwise grey "Needs review" / the status label / "Target not set". */
export function initiativeStatus(ini, m, today) {
  const type = ini.status_rule?.type;
  if (ini.kind === 'housekeeping' || type === 'none') return null;
  if ((type === 'target' || type === 'milestone_pace') && m?.unknown) return grey('Needs review', m.unknown);
  if ((type === 'target' || type === 'milestone_pace') && m?.pace) return paceStatus(ini, m.pace, today);
  if (type === 'target') return grey('Needs review', 'target set but no actuals to compare yet');
  return grey(ini.status_label || 'Target not set', ini.status_label ? null : 'no dated target or forecast to measure against');
}
