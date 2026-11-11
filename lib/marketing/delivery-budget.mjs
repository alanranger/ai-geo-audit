/**
 * Alan's standing email budgets per billing cycle (QUESTION-2026-11-11 billing-cycle-tile-reserves-and-free-to-spend):
 * the monthly Light & Logic full-list email and an ad-hoc reserve, both stored in business_targets.campaign_targets.email
 * (light_and_logic_budget_sends, adhoc_reserve_sends; a Targets / Marketing-settings save keeps them, each dated row is
 * history). Per future cycle: Free for new campaigns = allowance − provider-scheduled − Light & Logic − ad-hoc. Drafts
 * are not reserved and not deducted. A Light & Logic email not yet scheduled in Squarespace is PLANNED (its frozen list
 * never makes it look scheduled) and costs the budget once; once scheduled it is a scheduled email and the budget line
 * shows it counted above (never twice). Pure functions, no database.
 */
import { londonDay } from './delivery-reserve.mjs';

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

/** { light_and_logic, adhoc, note } from the stored campaign targets (null when a figure is not set). */
export function emailBudgetOf(campaignTargets, setAt = null) {
  const e = campaignTargets?.email || {};
  return { light_and_logic: num(e.light_and_logic_budget_sends), adhoc: num(e.adhoc_reserve_sends), note: e.email_budget_note || null, set_at: setAt };
}

export const isLightLogicEmail = (d) => /light-and-logic-email/.test(String(d.campaign_key || d.key || ''));
const providerScheduled = (d) => d.provider?.state === 'scheduled' || !!d.operator;
/** A Light & Logic email still to be scheduled in Squarespace (whatever its frozen list says). */
export const llPlanned = (d) => isLightLogicEmail(d) && !d.sent && !d.cancelled && !providerScheduled(d);

const addMonth = (iso) => { const t = new Date(iso); t.setUTCMonth(t.getUTCMonth() + 1); return t.toISOString(); };
/** The three cycles after this one, split at the provider's reset instant. */
export function futureCycles(cycle) {
  if (!cycle) return [];
  const a = cycle.reset;
  const b = cycle.next_reset;
  const c = addMonth(b);
  return [{ start: a, end: b }, { start: b, end: c }, { start: c, end: addMonth(c) }];
}
/** In the cycle by send instant, else by UK day (a day equal to a reset day is not placed: no midnight assumed). */
function inCycle(d, c) {
  if (d.send_at) return Date.parse(d.send_at) >= Date.parse(c.start) && Date.parse(d.send_at) < Date.parse(c.end);
  if (!d.send_day) return false;
  return d.send_day > londonDay(c.start) && d.send_day < londonDay(c.end);
}
const live = (d) => d.bucket !== 'released' && !d.scheduled_as && !(d.cancelled && d.release === 'released');

function cycleLines(list, quota, budget) {
  const sched = list.filter((d) => providerScheduled(d) && !d.sent);
  const frozen = list.filter((d) => !providerScheduled(d) && !d.sent && d.bucket === 'committed' && !llPlanned(d));
  const ll = list.filter(isLightLogicEmail);
  const llPlannedRows = ll.filter(llPlanned);
  const llAmount = ll.length && !llPlannedRows.length ? 0 : budget.light_and_logic;
  const sum = (xs) => xs.reduce((t, d) => t + (Number(d.amount) || 0), 0);
  const parts = [sum(sched), sum(frozen), llAmount, budget.adhoc];
  return {
    scheduled: parts[0], scheduled_n: sched.length, scheduled_uncosted: sched.filter((d) => d.amount == null).length,
    frozen: parts[1], frozen_n: frozen.length,
    light_and_logic: { amount: llAmount, planned_n: llPlannedRows.length, scheduled_n: ll.length - llPlannedRows.length, budget: budget.light_and_logic },
    adhoc: budget.adhoc, budgets_set: budget.light_and_logic != null && budget.adhoc != null,
    free: quota - parts.reduce((t, v) => t + (v || 0), 0)
  };
}

/** Per future cycle: the four footer lines (and any frozen-but-unscheduled send), from the same deliveries as the tiles. */
export function budgetView(deliveries, cycle, quota, budget) {
  const b = budget || emailBudgetOf(null);
  return {
    settings: b,
    cycles: futureCycles(cycle).map((c) => ({ ...c, ...cycleLines((deliveries || []).filter((d) => live(d) && inCycle(d, c)), quota, b) }))
  };
}
