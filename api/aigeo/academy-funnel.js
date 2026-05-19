// Academy Funnel — live trial / paid-subscriber metrics pulled from the
// Academy-specific Supabase project (separate from the AI GEO Audit
// production DB).
//
// Source project: dqrtcsvqsfgbqmnonkpt
// Source tables:
//   academy_trial_history    — one row per trial member, with
//                              trial_start_at / trial_end_at / converted_at
//   academy_annual_history   — one row per paying member, with
//                              annual_start_at / annual_end_at
//   academy_plan_events      — Stripe event log: subscription.created,
//                              .updated, .deleted, invoice.paid,
//                              invoice.payment_failed
//
// This endpoint surfaces three things for the dashboard:
//   1. CURRENT STATE: active paying members + active trials right now.
//   2. FUNNEL (last 90d / 30d): trials started, trial conversions,
//      direct paid signups (no trial), cancellations, payment failures.
//   3. TREND (last 12 months by month): trials_started + converted so
//      the UI can render a "top-of-funnel is shrinking" sparkline.
//   4. GAP ANALYSIS: how many more members are needed to close a profit
//      gap of £X/year, given £79 annual fee × 99% GP per member, plus
//      working back to a trials/month target via the current conversion
//      rate. Caller passes ?annual_gp_gap_gbp=18000 for example.
//
// Env vars required (separate from AI GEO Audit production):
//   ACADEMY_SUPABASE_URL                = https://dqrtcsvqsfgbqmnonkpt.supabase.co
//   ACADEMY_SUPABASE_SERVICE_ROLE_KEY   = <service-role key for that project>
//
// If either is missing, the endpoint returns a 200 with
// { configured: false } so the UI can render a friendly setup prompt
// rather than a 500 error.

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const ACADEMY_ANNUAL_FEE_GBP = 79;
const ACADEMY_GP_PCT = 99;
// The Academy switched from the legacy trial-to-monthly model to the
// current trial → annual-membership model in January 2026. Anything
// before that month is a different product and would muddy the trend
// chart, so the top-of-funnel chart starts from this cutover.
const TRIAL_MODEL_CUTOVER_YEAR = 2026;
const TRIAL_MODEL_CUTOVER_MONTH = 1; // January

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
};

function buildClient() {
  const url = process.env.ACADEMY_SUPABASE_URL;
  const key = process.env.ACADEMY_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Reduce a list of trial rows into a {YYYY-MM: {started, converted}} map
// starting at the trial-to-annual model cutover (Jan 2026) and running
// forward through the current month. Months with no activity are still
// emitted with zeros so the UI sparkline has a continuous x-axis.
// Pre-cutover months are excluded because that was a different product
// (trial → monthly) and would distort the trend.
function monthlyTrialBuckets(trials) {
  const now = new Date();
  const months = [];
  const startY = TRIAL_MODEL_CUTOVER_YEAR;
  const startM = TRIAL_MODEL_CUTOVER_MONTH - 1; // 0-indexed
  const endY = now.getUTCFullYear();
  const endM = now.getUTCMonth();
  let y = startY;
  let m = startM;
  while (y < endY || (y === endY && m <= endM)) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}`;
    months.push({ month: key, trials_started: 0, converted: 0 });
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  const idx = new Map(months.map((b, i) => [b.month, i]));
  // Per month: count UNIQUE members who started a trial that month, not
  // raw row count. A member who started two trials in the same month is
  // still one trial start for funnel-volume purposes.
  const seenStartByMonth = new Map();
  for (const t of trials) {
    const startStr = t.trial_start_at;
    if (!startStr) continue;
    const key = String(startStr).slice(0, 7);
    if (!idx.has(key)) continue;
    const memberId = t.member_id || `_${t.trial_start_at}`;
    const dedupeKey = `${key}|${memberId}`;
    if (seenStartByMonth.has(dedupeKey)) continue;
    seenStartByMonth.set(dedupeKey, true);
    const bucket = months[idx.get(key)];
    bucket.trials_started += 1;
    if (t.converted_at) bucket.converted += 1;
  }
  return months;
}

// Per-month NEW PAID MEMBERS (first-ever annual_start per member). This
// is what people actually mean by "Academy signups" — distinct from
// "trials started", which is the top of the funnel. Surfaced on the
// chart so the trial→paid bleed is unambiguous at a glance.
function monthlyPaidBuckets(annuals, months) {
  const idx = new Map(months.map((b, i) => [b.month, i]));
  const firstStartByMember = new Map();
  for (const a of annuals) {
    if (!a.member_id || !a.annual_start_at) continue;
    const t = new Date(a.annual_start_at).getTime();
    const prev = firstStartByMember.get(a.member_id);
    if (prev == null || t < prev) firstStartByMember.set(a.member_id, t);
  }
  const result = months.map(m => ({ month: m.month, new_paid: 0 }));
  firstStartByMember.forEach(t => {
    const key = new Date(t).toISOString().slice(0, 7);
    if (idx.has(key)) result[idx.get(key)].new_paid += 1;
  });
  return result;
}

// Compute current/recent counts from the raw rowsets. Done in one place
// so the handler stays simple.
//
// IMPORTANT: `academy_annual_history` has multiple rows per member
// (renewals create extra rows), so anything that should be a "member
// count" has to dedupe by `member_id`. Total rows in May 2026 are 27
// for only 15 unique members. Naive `.length` over the table gives the
// wrong (inflated) figure for active members + new paying.
function summariseNow(trials, annuals, events) {
  const now = Date.now();
  const ms30 = 30 * 86400 * 1000;
  const ms90 = 90 * 86400 * 1000;
  const inLast = (iso, ms) => iso && (now - new Date(iso).getTime()) <= ms;
  const isFuture = iso => iso && new Date(iso).getTime() > now;

  // Count unique member_ids in a rowset matching a predicate.
  const uniqMembers = (rows, predicate) => {
    const seen = new Set();
    for (const r of rows) {
      if (!predicate(r)) continue;
      const id = r.member_id;
      if (!id) continue;
      seen.add(id);
    }
    return seen.size;
  };

  // First-ever annual_start_at per member, so "new paying" only counts
  // truly new customers — renewals (member's 2nd / 3rd annual_start) are
  // retention events, not new paying.
  const firstAnnualStart = new Map();
  for (const a of annuals) {
    if (!a.member_id || !a.annual_start_at) continue;
    const t = new Date(a.annual_start_at).getTime();
    const prev = firstAnnualStart.get(a.member_id);
    if (prev == null || t < prev) firstAnnualStart.set(a.member_id, t);
  }
  let newMembers30 = 0;
  let newMembers90 = 0;
  firstAnnualStart.forEach(t => {
    if ((now - t) <= ms30) newMembers30 += 1;
    if ((now - t) <= ms90) newMembers90 += 1;
  });

  const trial = {
    active_now: uniqMembers(trials, t => isFuture(t.trial_end_at) && !t.converted_at),
    started_30d: trials.filter(t => inLast(t.trial_start_at, ms30)).length,
    started_90d: trials.filter(t => inLast(t.trial_start_at, ms90)).length,
    converted_30d: trials.filter(t => inLast(t.converted_at, ms30)).length,
    converted_90d: trials.filter(t => inLast(t.converted_at, ms90)).length,
    total: new Set(trials.map(t => t.member_id).filter(Boolean)).size,
    converted_total: uniqMembers(trials, t => !!t.converted_at)
  };
  const annual = {
    active_now: uniqMembers(annuals, a => !a.annual_end_at || new Date(a.annual_end_at).getTime() > now),
    new_30d: newMembers30,
    new_90d: newMembers90,
    total: firstAnnualStart.size
  };
  const ev = (type, ms) => events.filter(e => e.event_type === type && inLast(e.created_at, ms)).length;
  const eventCounts = {
    subscriptions_created_30d: ev('customer.subscription.created', ms30),
    subscriptions_created_90d: ev('customer.subscription.created', ms90),
    subscriptions_cancelled_30d: ev('customer.subscription.deleted', ms30),
    subscriptions_cancelled_90d: ev('customer.subscription.deleted', ms90),
    invoice_failures_30d: ev('invoice.payment_failed', ms30),
    invoice_failures_90d: ev('invoice.payment_failed', ms90)
  };
  return { trial, annual, eventCounts };
}

// Gap analysis: convert a "£X/yr profit shortfall" into the number of
// extra Academy members needed, then back into trials/month required
// at the observed trial-to-paid conversion rate.
function computeGapAnalysis(summary, annualGpGapGbp) {
  const gpPerMember = ACADEMY_ANNUAL_FEE_GBP * (ACADEMY_GP_PCT / 100);
  const membersNeeded = annualGpGapGbp > 0
    ? Math.ceil(annualGpGapGbp / gpPerMember)
    : 0;
  const trials90d = summary.trial.started_90d || 0;
  const conv90d = summary.trial.converted_90d || 0;
  const trialConversionPct = trials90d > 0
    ? Number(((conv90d / trials90d) * 100).toFixed(1))
    : null;
  const trialsPerMonthNeeded = trialConversionPct && trialConversionPct > 0
    ? Math.ceil((membersNeeded / (trialConversionPct / 100)) / 12)
    : null;
  const directPerMonthNeeded = membersNeeded > 0
    ? Math.ceil(membersNeeded / 12)
    : 0;
  const currentTrialsPerMonth = Math.round(trials90d / 3);
  return {
    annual_gp_gap_gbp: annualGpGapGbp,
    gp_per_member_gbp: Number(gpPerMember.toFixed(2)),
    members_needed: membersNeeded,
    trial_conversion_pct_90d: trialConversionPct,
    current_trials_per_month: currentTrialsPerMonth,
    trials_per_month_needed: trialsPerMonthNeeded,
    direct_signups_per_month_needed: directPerMonthNeeded,
    trial_volume_multiplier_needed: trialsPerMonthNeeded && currentTrialsPerMonth > 0
      ? Number((trialsPerMonthNeeded / currentTrialsPerMonth).toFixed(1))
      : null
  };
}

async function fetchData(supabase) {
  // We always select `member_id` because both trial + annual history
  // tables can hold multiple rows per member (renewals, re-trials).
  // Every "member count" later dedupes on this column.
  const [trialsRes, annualsRes, eventsRes] = await Promise.all([
    supabase
      .from('academy_trial_history')
      .select('member_id, trial_start_at, trial_end_at, converted_at, source')
      .order('trial_start_at', { ascending: false })
      .limit(1000),
    supabase
      .from('academy_annual_history')
      .select('member_id, annual_start_at, annual_end_at, source')
      .order('annual_start_at', { ascending: false })
      .limit(500),
    supabase
      .from('academy_plan_events')
      .select('event_type, created_at')
      .gte('created_at', new Date(Date.now() - 120 * 86400 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(2000)
  ]);
  if (trialsRes.error) throw new Error(`trials: ${trialsRes.error.message}`);
  if (annualsRes.error) throw new Error(`annuals: ${annualsRes.error.message}`);
  if (eventsRes.error) throw new Error(`events: ${eventsRes.error.message}`);
  return {
    trials: trialsRes.data || [],
    annuals: annualsRes.data || [],
    events: eventsRes.data || []
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });

  const supabase = buildClient();
  if (!supabase) {
    return send(res, 200, {
      configured: false,
      message: 'Set ACADEMY_SUPABASE_URL + ACADEMY_SUPABASE_SERVICE_ROLE_KEY in your env to enable the Academy funnel panel. The Academy data lives in Supabase project dqrtcsvqsfgbqmnonkpt.'
    });
  }

  const gapGbp = Number(req.query?.annual_gp_gap_gbp || 0);

  try {
    const data = await fetchData(supabase);
    const summary = summariseNow(data.trials, data.annuals, data.events);
        const monthly = monthlyTrialBuckets(data.trials);
        const monthlyPaid = monthlyPaidBuckets(data.annuals, monthly);
        // Merge the paid-signup count onto each month so the dashboard
        // chart can render trials + paid side by side without making a
        // second API call. (Chart consumers can rely on m.new_paid being
        // present even if zero.)
        for (let i = 0; i < monthly.length; i += 1) {
          monthly[i].new_paid = monthlyPaid[i]?.new_paid || 0;
        }
    const gap = computeGapAnalysis(summary, gapGbp);
    return send(res, 200, {
      configured: true,
      generated_at: new Date().toISOString(),
      academy_annual_fee_gbp: ACADEMY_ANNUAL_FEE_GBP,
      academy_gp_pct: ACADEMY_GP_PCT,
      current: {
        paying_members: summary.annual.active_now,
        active_trials: summary.trial.active_now,
        arr_gbp: Number((summary.annual.active_now * ACADEMY_ANNUAL_FEE_GBP).toFixed(2)),
        annual_gp_gbp: Number((summary.annual.active_now * ACADEMY_ANNUAL_FEE_GBP * (ACADEMY_GP_PCT / 100)).toFixed(2))
      },
      funnel: {
        trials_started_30d: summary.trial.started_30d,
        trials_started_90d: summary.trial.started_90d,
        trial_conversions_30d: summary.trial.converted_30d,
        trial_conversions_90d: summary.trial.converted_90d,
        new_paying_30d: summary.annual.new_30d,
        new_paying_90d: summary.annual.new_90d,
        direct_signups_30d: Math.max(0, summary.eventCounts.subscriptions_created_30d - summary.trial.converted_30d),
        direct_signups_90d: Math.max(0, summary.eventCounts.subscriptions_created_90d - summary.trial.converted_90d),
        cancellations_30d: summary.eventCounts.subscriptions_cancelled_30d,
        cancellations_90d: summary.eventCounts.subscriptions_cancelled_90d,
        invoice_failures_30d: summary.eventCounts.invoice_failures_30d,
        invoice_failures_90d: summary.eventCounts.invoice_failures_90d
      },
      monthly_trials: monthly,
      gap_analysis: gap
    });
  } catch (err) {
    return send(res, 500, { configured: true, error: 'academy_funnel_failed', message: err?.message || String(err) });
  }
}
