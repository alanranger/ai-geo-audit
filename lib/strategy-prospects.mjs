/**
 * Strategy "Prospects" (QUESTION-2026-11-09 (i)): non-dated enquiries → weighted £ in the CASH month → Remedy lever 3.
 * Weighted £ = value × the stage probability (public.prospect_stage_config; Alan decides, never auto-switched).
 * Open stages = qualify / quote / scheduled. booked_paid leaves the pipeline (its money is in the Booking Sheet sales
 * once matched, never counted twice); closed_lost is hidden by default and keeps its reason.
 * Stalled = an open enquiry with no touch for 14 days. It reaches Needs Alan only when Alan owns the next step.
 * Pure functions + read-only loaders. The strategy summary (public) gets aggregates only: no names, no notes.
 */
export const OPEN = ['qualify', 'quote', 'scheduled'];
export const STAGES = ['qualify', 'quote', 'scheduled', 'booked_paid', 'closed_lost'];
export const TYPES = ['1-2-1', 'mentoring', 'commission', 'corporate training', 'Academy', 'voucher / gift', 'other'];
export const OWNERS = ['Alan', 'GPT', 'Claude'];
export const SOURCES = ['email', 'phone', 'web form', 'referral'];
export const STALL_DAYS = 14;
export const MIN_CLOSED_FOR_RATES = 20;
/** Booking Sheet category each enquiry type sells into (its last-year baseline): 1-2-1 7 · mentoring 6 · commission 11 · corporate training 11 · Academy 12 · vouchers 8. */
export const TYPE_CAT = { '1-2-1': 7, mentoring: 6, commission: 11, 'corporate training': 11, Academy: 12, 'voucher / gift': 8, other: null };
export const DEFAULT_PROBS = { qualify: 0.2, quote: 0.4, scheduled: 0.75, booked_paid: 1 };
const DAY = 864e5;
const PROP_NOTE = 'Weighted £ = value × stage probability, placed in the month the cash is expected.';

export const probsOf = (cfg) => ({ ...DEFAULT_PROBS, ...Object.fromEntries((cfg || []).map((c) => [c.stage, Number(c.probability)])) });
export const isOpen = (e) => OPEN.includes(e.stage);
export const weightedOf = (e, p) => (isOpen(e) ? (Number(e.value_gbp) || 0) * (p[e.stage] ?? 0) : 0);
const touchOf = (e) => String(e.last_touch_at || e.created_at || '').slice(0, 10);
export const daysSinceTouch = (e, today) => (touchOf(e) ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${touchOf(e)}T00:00:00Z`)) / DAY) : null);
export const isStalled = (e, today) => isOpen(e) && (daysSinceTouch(e, today) ?? 0) >= STALL_DAYS;
const monthOf = (e) => (e.cash_month ? String(e.cash_month).slice(0, 7) : null);

/** Open enquiries' weighted £ per cash month, per Booking Sheet category (lever 3). A past cash month counts in the current month. */
export function pipelineByMonth(rows, p, currentMonth) {
  const out = {};
  for (const e of rows.filter(isOpen)) {
    const raw = monthOf(e);
    if (!raw) continue;
    const key = raw < currentMonth ? currentMonth : raw;
    const w = weightedOf(e, p);
    const m = (out[key] = out[key] || { total: 0, cats: {}, other: 0 });
    m.total += w;
    const cat = TYPE_CAT[e.type];
    if (cat) m.cats[cat] = (m.cats[cat] || 0) + w;
    else m.other += w;
  }
  return out;
}

function stageTile(rows, stage, p, currentMonth) {
  const list = rows.filter((e) => e.stage === stage && (stage !== 'booked_paid' || monthOf(e) === currentMonth));
  const value = list.reduce((a, e) => a + (Number(e.value_gbp) || 0), 0);
  return { stage, probability: p[stage], count: list.length, value, weighted: stage === 'booked_paid' ? null : value * (p[stage] ?? 0) };
}

/** Real conversion per stage once 20+ enquiries have closed: of the closed ones that reached a stage, the share booked. */
export function conversionOf(rows, history) {
  const closed = rows.filter((e) => e.stage === 'booked_paid' || e.stage === 'closed_lost');
  if (closed.length < MIN_CLOSED_FOR_RATES) return { closed: closed.length, needed: MIN_CLOSED_FOR_RATES, rates: null };
  const reached = (e, s) => e.stage === s || (history || []).some((h) => h.enquiry_id === e.id && (h.to_stage === s || h.from_stage === s));
  const rates = Object.fromEntries(OPEN.map((s) => {
    const at = closed.filter((e) => reached(e, s));
    return [s, at.length ? Math.round((at.filter((e) => e.stage === 'booked_paid').length / at.length) * 1000) / 10 : null];
  }));
  return { closed: closed.length, needed: MIN_CLOSED_FOR_RATES, rates };
}

/** The latest Booking Sheet match recorded for each booked_paid enquiry (history.matched_sale). */
export function matchesOf(history) {
  const out = {};
  for (const h of [...(history || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)))) if (h.matched_sale) out[h.enquiry_id] = h.matched_sale;
  return out;
}

/** Aggregates for the strategy summary and the Remedy plan: no names, no notes. */
export function summarizeProspects({ rows = [], config = [], history = [], today, months = [] }) {
  const p = probsOf(config);
  const current = today.slice(0, 7);
  const byMonth = pipelineByMonth(rows, p, current);
  const open = rows.filter(isOpen);
  const stalled = open.filter((e) => isStalled(e, today));
  const matches = matchesOf(history);
  const booked = rows.filter((e) => e.stage === 'booked_paid');
  return {
    probabilities: p, note: PROP_NOTE,
    tiles: ['qualify', 'quote', 'scheduled', 'booked_paid'].map((s) => stageTile(rows, s, p, current)),
    pipeline: {
      total: open.reduce((a, e) => a + weightedOf(e, p), 0), open: open.length, stalled: stalled.length, stalled_alan: stalled.filter((e) => e.owner === 'Alan').length,
      by_month: months.map((mm) => ({ key: mm.key, label: mm.label, weighted: byMonth[mm.key]?.total || 0 })),
      no_cash_month: open.filter((e) => !monthOf(e)).length
    },
    by_month: byMonth, conversion: conversionOf(rows, history), closed_lost: rows.filter((e) => e.stage === 'closed_lost').length,
    booked_unmatched: booked.filter((e) => !matches[e.id]).length, booked_matched: booked.filter((e) => matches[e.id]).length, total: rows.length
  };
}

/** Needs Alan rows for the shared decision state: stalled enquiries whose next step Alan owns (no names: type, stage, £). */
export function stalledForAlan(rows, today) {
  return rows.filter((e) => e.owner === 'Alan' && isStalled(e, today)).map((e) => ({
    type: 'prospect_stalled', key: `prospect|${e.id}`, due: e.next_action_date || null, late: !!e.next_action_date && e.next_action_date < today,
    what: `Chase stalled enquiry: ${e.type} · ${e.stage} · £${Math.round(Number(e.value_gbp) || 0).toLocaleString('en-GB')}`, channel: 'none',
    why: `No touch in ${daysSinceTouch(e, today)} days · you own the next step`
  }));
}

/* ---------- read-only loaders (service role) ---------- */

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data || [];
};
export async function loadProspectRows(sb) {
  const [rows, config, history] = await Promise.all([
    sb.from('prospect_enquiry').select('*').order('created_at', { ascending: true }).limit(2000),
    sb.from('prospect_stage_config').select('stage, probability, label, sort').order('sort', { ascending: true }),
    sb.from('prospect_enquiry_history').select('enquiry_id, at, by, from_stage, to_stage, matched_sale').order('at', { ascending: true }).limit(10000)
  ]);
  return { rows: must(rows, 'prospect_enquiry'), config: must(config, 'prospect_stage_config'), history: must(history, 'prospect_enquiry_history') };
}
