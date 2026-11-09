/**
 * Strategy "Prospects" (QUESTION-2026-11-09 (i)): non-dated enquiries → weighted £ in the CASH month → Remedy lever 3.
 * Weighted £ = value × the stage probability (public.prospect_stage_config; Alan decides, never auto-switched).
 * Open stages = qualify / quote / scheduled. booked_paid leaves the pipeline (its money is in the Booking Sheet sales
 * once matched, never counted twice); closed_lost is hidden by default and keeps its reason.
 * Stalled = an open enquiry with no touch for 14 days. It reaches Needs Alan only when Alan owns the next step.
 * QUESTION-2026-11-09 (p): customer_market (D2C / B2B by the purpose of the opportunity), value_basis (an "unknown"
 * value is counted, never added: it is not a £0 sale), review_status (revalidate is a flag; nothing is closed by age).
 * Cash: dated = a cash month this month or later; overdue = the cash month has passed (shown, never moved into the
 * current month); undated = no cash month (shown, never in any month's forecast or Remedy).
 * QUESTION-2026-11-09 (r): revenue_type puts every row in exactly ONE line (never counted twice):
 *   new_sale (default)    → Pipeline, weighted (stage probability) — the only type in the weighted pipeline / stage tiles;
 *   committed_work        → Committed work: full value in its cash month (stage "allocated" = Allocated · delivery pending,
 *                           delivery_due / invoice_by), not weighted, never paid automatically; Remedy counts it "committed";
 *   receivable            → Cash to collect: invoiced, payment unverified; never pipeline / new sales / Remedy;
 *   partner_development   → Partner relationships: listed and counted, never in £ totals, no stalled alarm.
 * booked_paid / closed_lost rows of any type are in no forward line (paid only on Booking Sheet / provider evidence).
 * Pure functions + read-only loaders. The strategy summary (public) gets aggregates only: no names, no notes.
 */
export const OPEN = ['qualify', 'quote', 'scheduled'];
export const STAGES = ['qualify', 'quote', 'scheduled', 'allocated', 'booked_paid', 'closed_lost'];
export const CLOSED = ['booked_paid', 'closed_lost'];
export const REVENUE_TYPES = ['new_sale', 'partner_development', 'committed_work', 'receivable'];
/** Stage a new row starts in when none is sent. */
export const DEFAULT_STAGE = { new_sale: 'qualify', partner_development: 'qualify', committed_work: 'allocated', receivable: 'scheduled' };
export const PROVIDERS = ['paypal', 'stripe', 'squarespace', 'bank'];
export const TYPES = ['1-2-1', 'mentoring', 'commission', 'corporate training', 'Academy', 'voucher / gift', 'other'];
export const OWNERS = ['Alan', 'GPT', 'Claude'];
export const SOURCES = ['email', 'phone', 'web form', 'referral'];
export const MARKETS = ['D2C', 'B2B', 'unclassified'];
export const VALUE_BASES = ['agreed', 'quoted', 'estimated', 'unknown'];
export const REVIEW = ['recent', 'revalidate'];
export const STALL_DAYS = 14;
export const MIN_CLOSED_FOR_RATES = 20;
/** Booking Sheet category each enquiry type sells into (its last-year baseline): 1-2-1 7 · mentoring 6 · commission 11 · corporate training 11 · Academy 12 · vouchers 8. */
export const TYPE_CAT = { '1-2-1': 7, mentoring: 6, commission: 11, 'corporate training': 11, Academy: 12, 'voucher / gift': 8, other: null };
export const DEFAULT_PROBS = { qualify: 0.2, quote: 0.4, scheduled: 0.75, booked_paid: 1 };
const DAY = 864e5;
const PROP_NOTE = 'Weighted £ = value × stage probability, placed in the month the cash is expected.';

export const probsOf = (cfg) => ({ ...DEFAULT_PROBS, ...Object.fromEntries((cfg || []).map((c) => [c.stage, Number(c.probability)])) });
export const revenueTypeOf = (e) => (REVENUE_TYPES.includes(e.revenue_type) ? e.revenue_type : 'new_sale');
/** In the weighted pipeline: a new sale at an open stage. */
export const isOpen = (e) => OPEN.includes(e.stage) && revenueTypeOf(e) === 'new_sale';
/** Not paid / lost yet (any type). */
export const isLive = (e) => !CLOSED.includes(e.stage);
const liveOfType = (rows, t) => rows.filter((e) => isLive(e) && revenueTypeOf(e) === t);
export const isUnknownValue = (e) => e.value_basis === 'unknown';
/** The full order value; an "unknown" value counts as nothing in totals (its count is shown instead). */
export const valueOf = (e) => (isUnknownValue(e) ? 0 : Number(e.value_gbp) || 0);
export const weightedOf = (e, p) => (isOpen(e) ? valueOf(e) * (p[e.stage] ?? 0) : 0);
const touchOf = (e) => String(e.last_touch_at || e.created_at || '').slice(0, 10);
export const daysSinceTouch = (e, today) => (touchOf(e) ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${touchOf(e)}T00:00:00Z`)) / DAY) : null);
export const isStalled = (e, today) => isOpen(e) && (daysSinceTouch(e, today) ?? 0) >= STALL_DAYS;
const monthOf = (e) => (e.cash_month ? String(e.cash_month).slice(0, 7) : null);
/** 'dated' (cash month this month or later) · 'overdue' (cash month passed: revise) · 'undated' (no cash month). */
export function cashBucket(e, currentMonth) {
  const m = monthOf(e);
  if (!m) return 'undated';
  return m < currentMonth ? 'overdue' : 'dated';
}
const marketOf = (e) => (MARKETS.includes(e.customer_market) ? e.customer_market : 'unclassified');

const monthRow = (out, key) => (out[key] = out[key] || { total: 0, cats: {}, other: 0, committed: 0, committed_cats: {} });
const addCat = (cats, e, gbp) => {
  const cat = TYPE_CAT[e.type];
  if (cat) cats[cat] = (cats[cat] || 0) + gbp;
  return cat ? 0 : gbp;
};
/**
 * Per cash month, per Booking Sheet category (Remedy lever 3): total = new sales' weighted £; committed = committed
 * work's full value (labelled "committed"). Dated only: an overdue cash month is never moved into the current month and
 * an undated row is in no month. Receivables and partner relationships are never here.
 */
export function pipelineByMonth(rows, p, currentMonth) {
  const out = {};
  for (const e of rows.filter(isOpen)) {
    if (cashBucket(e, currentMonth) !== 'dated') continue;
    const m = monthRow(out, monthOf(e));
    const w = weightedOf(e, p);
    m.total += w;
    m.other += addCat(m.cats, e, w);
  }
  for (const e of liveOfType(rows, 'committed_work')) {
    if (cashBucket(e, currentMonth) !== 'dated') continue;
    const m = monthRow(out, monthOf(e));
    m.committed += valueOf(e);
    addCat(m.committed_cats, e, valueOf(e));
  }
  return out;
}
/** Full-value £ of live rows of one type, by where the cash sits (committed work / cash to collect); unknown counted, never added. */
function fullValueLine(list, currentMonth, months) {
  const out = { total_gbp: 0, count: list.length, unknown_count: 0, dated_gbp: 0, undated_gbp: 0, overdue_gbp: 0, overdue_count: 0, by_month: [] };
  const byKey = {};
  for (const e of list) {
    const b = cashBucket(e, currentMonth);
    out.total_gbp += valueOf(e);
    out[`${b}_gbp`] += valueOf(e);
    out.overdue_count += b === 'overdue' ? 1 : 0;
    out.unknown_count += isUnknownValue(e) ? 1 : 0;
    if (b === 'dated') byKey[monthOf(e)] = (byKey[monthOf(e)] || 0) + valueOf(e);
  }
  out.by_month = months.map((mm) => ({ key: mm.key, label: mm.label, gbp: byKey[mm.key] || 0 }));
  out.later_gbp = Object.entries(byKey).filter(([k]) => !months.some((mm) => mm.key === k)).reduce((a, [, v]) => a + v, 0);
  return out;
}
/** Partner relationships: listed and counted only (never in £ totals, no stalled alarm). */
function partnersLine(rows) {
  const list = liveOfType(rows, 'partner_development');
  return { count: list.length, unvalued_count: list.filter((e) => isUnknownValue(e) || !(Number(e.value_gbp) > 0)).length, noted_gbp: list.reduce((a, e) => a + valueOf(e), 0) };
}

const emptyMarkets = () => Object.fromEntries(MARKETS.map((m) => [m, { count: 0, value: 0, weighted: 0 }]));
/**
 * Open enquiries' weighted £ by where the cash sits (dated / undated / overdue) and by market. An "unknown" value is
 * counted (unknown_count), never added; estimated_gbp is the part of the weighted total that rests on estimates.
 */
export function pipelineBuckets(rows, p, currentMonth) {
  const out = { dated_gbp: 0, undated_gbp: 0, overdue_gbp: 0, dated_count: 0, undated_count: 0, overdue_count: 0, unknown_count: 0, estimated_gbp: 0, revalidate_count: 0, by_market: emptyMarkets() };
  for (const e of rows.filter(isOpen)) {
    const w = weightedOf(e, p);
    const b = cashBucket(e, currentMonth);
    out[`${b}_gbp`] += w;
    out[`${b}_count`] += 1;
    const mk = out.by_market[marketOf(e)];
    mk.count += 1;
    mk.value += valueOf(e);
    mk.weighted += w;
    out.unknown_count += isUnknownValue(e) ? 1 : 0;
    out.estimated_gbp += e.value_basis === 'estimated' ? w : 0;
    out.revalidate_count += e.review_status === 'revalidate' ? 1 : 0;
  }
  return out;
}
/** Per-row flags for the admin table / API (no names). */
const LINE = { new_sale: 'pipeline', committed_work: 'committed', receivable: 'cash_to_collect', partner_development: 'partners' };
export function rowFlags(e, today) {
  const t = revenueTypeOf(e);
  const b = isOpen(e) || (isLive(e) && t !== 'partner_development') ? cashBucket(e, today.slice(0, 7)) : null;
  return {
    overdue_cash: b === 'overdue', undated: b === 'undated', value_unknown: isUnknownValue(e), estimated: e.value_basis === 'estimated', revalidate: e.review_status === 'revalidate',
    revenue_type: t, line: isLive(e) ? LINE[t] : null, allocated: e.stage === 'allocated'
  };
}

/** Stage tiles: new sales only (committed work, receivables and partners have their own lines). */
function stageTile(rows, stage, p, currentMonth) {
  const list = rows.filter((e) => revenueTypeOf(e) === 'new_sale' && e.stage === stage && (stage !== 'booked_paid' || monthOf(e) === currentMonth));
  const value = list.reduce((a, e) => a + valueOf(e), 0);
  return { stage, probability: p[stage], count: list.length, value, unknown: list.filter(isUnknownValue).length, weighted: stage === 'booked_paid' ? null : value * (p[stage] ?? 0) };
}

/** Real conversion per stage once 20+ enquiries have closed: of the closed ones that reached a stage, the share booked. */
export function conversionOf(rows, history) {
  const closed = rows.filter((e) => revenueTypeOf(e) === 'new_sale' && CLOSED.includes(e.stage));
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
/** Booked / paid enquiries whose latest sale match was left for review (more than one possible sale, or not linked yet). */
export function saleReviewsOf(history) {
  const out = {};
  for (const h of [...(history || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)))) {
    if (h.matched_sale) delete out[h.enquiry_id];
    else if (h.changes?.match_review) out[h.enquiry_id] = h.changes.match_review;
  }
  return out;
}

/**
 * The Booking Sheet sale a booked / paid enquiry is matched to: only a sale linked (customer_identity_link
 * 'bs_transaction', confirmed) to the SAME person. A sale confirmed to another person is refused. An unlinked or
 * unconfirmed sale, or more than one possible sale, is left unmatched and flagged for review: never the first row.
 */
export function pickSale(sales, links, personId) {
  const linksOf = (s) => (links || []).filter((l) => l.source_id === `${s.source_workbook}:${s.source_row}`);
  const mine = [];
  const possible = [];
  for (const s of sales || []) {
    const ls = linksOf(s);
    if (personId && ls.some((l) => l.person_id === personId && l.confirmed !== false)) mine.push(s);
    else if (!ls.some((l) => l.confirmed !== false)) possible.push(s);
  }
  const n = mine.length + possible.length;
  if (mine.length === 1 && n === 1) return { sale: mine[0] };
  if (n) return { review: { candidates: n, same_person: mine.length, reason: n > 1 ? 'more than one possible Booking Sheet sale' : 'sale not linked to this client yet' } };
  return { refused: sales?.length ? 'that Booking Sheet sale belongs to a different client' : 'matched_sale not found in the Booking Sheet' };
}

function pipelineOut(rows, p, today, months, byMonth) {
  const open = rows.filter(isOpen);
  const stalled = open.filter((e) => isStalled(e, today));
  const b = pipelineBuckets(rows, p, today.slice(0, 7));
  return {
    total: open.reduce((a, e) => a + weightedOf(e, p), 0), open: open.length, stalled: stalled.length, stalled_alan: stalled.filter((e) => e.owner === 'Alan').length,
    by_month: months.map((mm) => ({ key: mm.key, label: mm.label, weighted: byMonth[mm.key]?.total || 0 })),
    no_cash_month: b.undated_count, undated_weighted: b.undated_gbp, ...b
  };
}

/** Aggregates for the strategy summary and the Remedy plan: no names, no notes. */
export function summarizeProspects({ rows = [], config = [], history = [], today, months = [] }) {
  const p = probsOf(config);
  const current = today.slice(0, 7);
  const byMonth = pipelineByMonth(rows, p, current);
  const matches = matchesOf(history);
  const reviews = saleReviewsOf(history);
  const booked = rows.filter((e) => e.stage === 'booked_paid');
  return {
    probabilities: p, note: PROP_NOTE,
    tiles: ['qualify', 'quote', 'scheduled', 'booked_paid'].map((s) => stageTile(rows, s, p, current)),
    pipeline: pipelineOut(rows, p, today, months, byMonth),
    committed: fullValueLine(liveOfType(rows, 'committed_work'), current, months),
    cash_to_collect: fullValueLine(liveOfType(rows, 'receivable'), current, months),
    partners: partnersLine(rows),
    revenue_types: Object.fromEntries(REVENUE_TYPES.map((t) => [t, liveOfType(rows, t).length])),
    by_month: byMonth, conversion: conversionOf(rows, history), closed_lost: rows.filter((e) => e.stage === 'closed_lost').length,
    booked_unmatched: booked.filter((e) => !matches[e.id]).length, booked_matched: booked.filter((e) => matches[e.id]).length,
    booked_review: booked.filter((e) => !matches[e.id] && reviews[e.id]).length, total: rows.length
  };
}
/**
 * The quarter tile's pipeline totals (lib/strategy-sales-gap.mjs quarterPipeline reads total / undated_weighted and
 * treats total − dated − undated as "a cash month after the quarter"): overdue is taken out of total so it never
 * reads as later or as dated; it is passed on as overdue_gbp / overdue_count for its own line.
 */
export function quarterFeedOf(pr) {
  if (pr?.error) return { error: pr.error };
  if (!pr?.pipeline) return null;
  return { ...pr.pipeline, total: pr.pipeline.total - (pr.pipeline.overdue_gbp || 0), total_with_overdue: pr.pipeline.total };
}

/** Needs Alan rows for the shared decision state: stalled enquiries whose next step Alan owns (no names: type, stage, £). */
export function stalledForAlan(rows, today) {
  return rows.filter((e) => e.owner === 'Alan' && isStalled(e, today)).map((e) => ({
    type: 'prospect_stalled', key: `prospect|${e.id}`, due: e.next_action_date || null, late: !!e.next_action_date && e.next_action_date < today,
    what: `Chase stalled enquiry: ${e.type} · ${e.stage} · £${Math.round(Number(e.value_gbp) || 0).toLocaleString('en-GB')}`, channel: 'none',
    why: `No touch in ${daysSinceTouch(e, today)} days · you own the next step`
  }));
}

/* ---------- client ID (customer_person), same rules as the identity code (lib/marketing/identity.mjs) ---------- */

const normEmailP = (e) => (e == null || String(e).trim() === '' ? null : String(e).trim().toLowerCase());
const normNameP = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z' -]/g, ' ').replace(/\s+/g, ' ').trim();
/**
 * Match order: (1) exact email; (2) an exact full name naming exactly ONE contact that has an email. Otherwise no
 * match (a new "prospect" record is created). Ambiguous names never pick a person.
 */
export function pickClient({ byEmail = [], byName = [], name }) {
  if (byEmail.length === 1) return { person_id: byEmail[0].person_id, method: 'email_exact' };
  const n = normNameP(name);
  const exact = byName.filter((p) => p.email && normNameP(p.display_name) === n);
  if (n && exact.length === 1) return { person_id: exact[0].person_id, method: 'name_exact_unique' };
  return { person_id: null, method: exact.length > 1 ? 'name_multiple' : 'none', candidates: exact.length };
}
/**
 * A new "prospect" customer_person: NO consent fields (no subscribed / suppressed), so no email audience membership.
 * An email anchor uses the identity code's own key (email:…), so a later rebuild adopts the same record when they buy.
 */
export function prospectPersonRow({ name, email, now, uid }) {
  const e = normEmailP(email);
  return {
    anchor_key: e ? `email:${e}` : `prospect:${uid}`, email: e, display_name: String(name || '').trim().slice(0, 200) || null,
    facts: { record_type: 'prospect', name: String(name || '').trim() || null, email: e, prospect: { source: 'prospect_enquiry', created_at: now } },
    created_at: now, updated_at: now
  };
}
export const shortClientId = (personId) => (personId ? `C-${String(personId).replace(/-/g, '').slice(0, 6).toUpperCase()}` : null);
export const daysOpen = (e, today) => (OPEN.includes(e.stage) && e.enquiry_date ? Math.max(0, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${String(e.enquiry_date).slice(0, 10)}T00:00:00Z`)) / DAY)) : null);

/* ---------- read-only loaders (service role) ---------- */

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data || [];
};
export async function loadProspectRows(sb) {
  const [rows, config, history] = await Promise.all([
    sb.from('prospect_enquiry').select('*').order('created_at', { ascending: true }).limit(2000),
    sb.from('prospect_stage_config').select('stage, probability, label, sort').order('sort', { ascending: true }),
    sb.from('prospect_enquiry_history').select('enquiry_id, at, by, from_stage, to_stage, matched_sale, match_review:changes->match_review').order('at', { ascending: true }).limit(10000)
  ]);
  const hist = must(history, 'prospect_enquiry_history').map(({ match_review: r, ...h }) => (r ? { ...h, changes: { match_review: r } } : h));
  return { rows: must(rows, 'prospect_enquiry'), config: must(config, 'prospect_stage_config'), history: hist };
}
