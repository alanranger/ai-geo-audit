/**
 * Pick n Mix plans from two sources (Alan, 8 Nov 2026). The Booking Sheet "PnM Plans" tab (booking_sheet_plans) is
 * the live record from the relaunch on and is read first; the plan statement files (pnm_plans / pnm_plan_payments) are
 * history. A tab row links to a person by Email (confirmed), else by exact Client name (probable). Pure: no I/O.
 */
export const DEFAULT_PNM_RELAUNCH = '2026-11-10';
export const SHEET_PLAN_SOURCE = 'booking_sheet';
export const STATEMENT_PLAN_SOURCE = 'statement';
export const SHEET_PLAN_FILE = 'Booking Sheet · PnM Plans tab';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ENDED_STATUS = /\b(cancel\w*|ended|expired|lapsed|refunded|closed|stopped|finished|completed?)\b/i;
const day = (v) => (v ? String(v).slice(0, 10) : null);
const lowerEmail = (e) => String(e || '').trim().toLowerCase() || null;
const nameKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const money = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** The relaunch date from the Targets panel (kpi_targets.pnm_relaunch_date), else 10 Nov 2026. */
export function relaunchDate(kpiTargets) {
  const v = String(kpiTargets?.pnm_relaunch_date || '').slice(0, 10);
  return ISO_DAY.test(v) ? v : DEFAULT_PNM_RELAUNCH;
}

/** active / starting / ended for one plan on `asOf`; a Status of cancelled / ended / expired ends it whatever the dates. */
export function planState(p, asOf) {
  if (ENDED_STATUS.test(p.status || '')) return 'ended';
  if (p.starts && p.starts > asOf) return 'starting';
  if (p.starts) return !p.ends || p.ends >= asOf ? 'active' : 'ended';
  return /^\s*active\s*$/i.test(p.status || '') ? 'active' : 'ended';
}

/** Plans active on `asOf` by the same date rule (KPI 5, Strategy tiles, Customers). */
export const activePlanCount = (plans, asOf) => (plans || []).filter((p) => planState(p, asOf) === 'active').length;

/** Plan Type text → monthly / quarterly / annual (the filter's options); other wording is kept lower-case. */
export function planTypeKey(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  if (/annual|year|12\s*-?\s*month/.test(s)) return 'annual';
  if (/quarter|3\s*-?\s*month/.test(s)) return 'quarterly';
  return /month/.test(s) ? 'monthly' : s;
}

/** One person's plan state: none / active / starting / ended. */
export function planStatusOf(plans, asOf) {
  const list = plans || [];
  if (!list.length) return 'none';
  const states = new Set(list.map((p) => planState(p, asOf)));
  if (states.has('active')) return 'active';
  return states.has('starting') ? 'starting' : 'ended';
}

function sheetKey(r, seen) {
  const base = `bsp:${String(r.plan_id || '').trim() || `row${r.source_row ?? r.id}`}`;
  const key = seen.has(base) ? `${base}:${r.source_row ?? r.id}` : base;
  seen.add(key);
  return key;
}

/**
 * Payment £ is the total the client has actually paid so far (confirmed by Alan, 8 Nov 2026, answer "B"): spend =
 * Payment £; Plan Value £ only stands in when Payment £ is blank. A Payment of 0 is real (nothing paid yet), not blank.
 */
function sheetPlan(r, seen) {
  const paid = money(r.payment) ?? money(r.plan_value) ?? 0;
  return {
    plan_key: sheetKey(r, seen), source: SHEET_PLAN_SOURCE, source_file: SHEET_PLAN_FILE, plan_id: r.plan_id || null,
    client_name: r.client_name || null, email: lowerEmail(r.email), plan_type: r.plan_type || null,
    starts: day(r.start_date), ends: day(r.end_date), status: r.status || null, plan_value: money(r.plan_value), paid_total: paid
  };
}

/**
 * booking_sheet_plans rows → the plan + payment shape identity reads. The tab has no payment date, so the payment is
 * dated the plan start (date_reliable false) and goes through the same same-money checks as statement payments.
 */
export function sheetPlans(rows) {
  const plans = [];
  const payments = [];
  const seen = new Set();
  for (const r of rows || []) {
    if (!r.client_name && !r.email) continue;
    const plan = sheetPlan(r, seen);
    plans.push(plan);
    if (plan.paid_total > 0) payments.push({ plan_key: plan.plan_key, line_no: 1, amount: plan.paid_total, paid_on: plan.starts, date_reliable: false, scheduled_only: false });
  }
  return { plans, payments };
}

const samePlan = (p) => `${lowerEmail(p.email) || nameKey(p.client_name)}|${day(p.starts) || ''}`;

/** Tab plans first; a statement plan for the same client and start date is the same plan and is dropped. */
export function mergePlanSources(sheet, history) {
  const have = new Set((sheet.plans || []).map(samePlan));
  const hist = (history.plans || []).filter((p) => !have.has(samePlan(p))).map((p) => ({ ...p, source: p.source || STATEMENT_PLAN_SOURCE }));
  const keep = new Set(hist.map((p) => p.plan_key));
  return {
    plans: [...(sheet.plans || []), ...hist],
    payments: [...(sheet.payments || []), ...(history.payments || []).filter((p) => keep.has(p.plan_key))],
    duplicates: (history.plans || []).length - hist.length
  };
}

/** Plans sold since the relaunch = PnM Plans tab rows starting on or after it (an undated row is a new plan). */
export const soldSince = (plans, relaunch) => plans.filter((p) => p.source === SHEET_PLAN_SOURCE && (!p.starts || p.starts >= relaunch)).length;

/** Strategy / overview Pick n Mix numbers: tab rows first, statement files as history. */
export function pnmPlanInfo({ sheetRows, historyPlans, relaunch, today, incomeR12 = 0 }) {
  const sheet = sheetPlans(sheetRows).plans;
  const merged = mergePlanSources({ plans: sheet }, { plans: historyPlans || [] }).plans;
  const active = (list) => activePlanCount(list, today);
  return {
    available: true, relaunch, relaunched: today >= relaunch, sheet_rows: sheet.length, history_plans: (historyPlans || []).length,
    total: merged.length, since_relaunch: soldSince(sheet, relaunch), active: active(merged), active_sheet: active(sheet),
    income_r12: Math.round(Number(incomeR12) || 0)
  };
}
