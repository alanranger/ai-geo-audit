// Auto-Optimise Scenarios endpoint.
//
// Runs the smart-priorities picker against the current audit snapshot
// under three strategic preset profiles ("Easy", "Balanced", "Hard")
// and returns, for each, a different mix of recommended actions plus a
// do-nothing baseline for comparison.
//
// The three presets differ along THREE axes (not just lever weights):
//   1. Eligibility filter      - which candidates qualify
//   2. Re-sort objective       - what we optimise for
//   3. Effort budget (hours)   - how much commit we cap at
//
// Plus an assumed PERSISTENCE_MONTHS (decay): CTR-style quick wins are
// assumed to decay faster (competitors rewrite their titles too), rank
// and AIO compound bets persist longer. This is what actually makes
// Easy vs Hard look different in annualised terms - without it the
// numbers collapse together because the same handful of high-volume
// candidates dominate raw monthly lift no matter how you weight.
//
// Why preset profiles rather than a real gradient solver:
//  1. Lift estimates are heuristic (CTR-by-position + AOV * close_rate);
//     a numerical optimiser over heuristics overfits to those heuristics.
//  2. The user reasons about strategy as "quick wins this month" vs
//     "compound bets" - profiles map to mental models.
//  3. Three discrete options is cognitively manageable.
//
// All helpers kept under 15 cognitive complexity (AGENTS.md rule).

import { createClient } from '@supabase/supabase-js';
import { __INTERNAL as SP } from './revenue-funnel-smart-priorities.js';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function send(res, status, body) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.status(status).end(JSON.stringify(body));
}

// Convert {id: number} into the Map shape buildAllPriorities expects.
function mapFromObj(obj) {
  const m = new Map();
  for (const k of Object.keys(obj || {})) m.set(k, Number(obj[k]));
  return m;
}

// --- Strategic preset profiles --------------------------------------
//
// Easy    = quick wins, max £/hr, decay fastest (6mo persistence)
// Balanced= most £ this month, mixed effort, 9mo persistence
// Hard    = compound bets, longest payback, 12mo persistence
//
// The lever_weights here are still applied during buildAllPriorities to
// keep the picker's weighted_score honest, but the real strategic
// differentiation lives in `filter`, `score`, `budget_hours`, and
// `persistence_months` below.
const PRESETS = [
  {
    id: 'easy',
    name: 'Easy path (quick wins this month)',
    description: 'Sub-1-hour title + meta rewrites and schema drops. Highest £-per-hour. Assumed 6-month persistence before competitors rewrite too.',
    horizon_days: 30,
    budget_hours: 6,
    persistence_months: 6,
    tier_weights:  flatTierWeights(),
    lever_weights: { ctr: 2.0, schema: 1.5, aio: 0.5, rank: 0.2, surfacing: 0.5, conversion: 1.0 },
    filter: c => Number(c.effort_hours) <= 1 && Number(c.time_to_realise_days) <= 21,
    score:  c => Number(c.lift_per_hour_gbp) || 0
  },
  {
    id: 'balanced',
    name: 'Balanced path (most £ this month)',
    description: 'Mix of CTR + AIO + a few rank pushes. Sorted by absolute monthly GP lift. Assumed 9-month persistence (mixed-strategy decay).',
    horizon_days: 90,
    budget_hours: 12,
    persistence_months: 9,
    tier_weights:  flatTierWeights(),
    lever_weights: { ctr: 1.2, schema: 1.0, aio: 1.5, rank: 1.0, surfacing: 1.0, conversion: 1.2 },
    filter: ()=> true,
    score:  c => Number(c.estimated_lift_gbp_profit) || 0
  },
  {
    id: 'hard',
    name: 'Hard path (compound 6-month bets)',
    description: 'Rank lifts + AIO citation captures. 2-4 hour actions with 30-60 day payback that compound to 12-month persistence. Biggest annualised lifts.',
    horizon_days: 180,
    budget_hours: 24,
    persistence_months: 12,
    tier_weights:  flatTierWeights(),
    lever_weights: { ctr: 0.5, schema: 0.6, aio: 2.0, rank: 2.0, surfacing: 1.2, conversion: 1.0 },
    filter: c => Number(c.effort_hours) >= 1 && Number(c.time_to_realise_days) >= 30,
    // Hard's sort favours bigger monthly lift AND longer payback so rank
    // candidates with 60-day realise dominate even when their monthly
    // number is smaller than a quick CTR win.
    score:  c => (Number(c.estimated_lift_gbp_profit) || 0) * Math.max(1, (Number(c.time_to_realise_days) || 30) / 30)
  }
];

function flatTierWeights() {
  return { academy: 1, courses: 1, workshops_nonres: 1, workshops_residential: 1, services: 1, hire: 1 };
}

// Strip closures before JSON-stringify.
function sanitiseCandidate(c) {
  const out = { ...c };
  delete out._rebuild;
  return out;
}

// Greedy effort-budget pick: walk the re-sorted list, take candidates
// in order, stop when cumulative effort_hours would exceed budget.
function pickWithinBudget(ranked, budgetHours) {
  const picked = [];
  let used = 0;
  for (const c of ranked) {
    const eh = Number(c.effort_hours) || 0;
    if (eh + used > budgetHours) continue;
    picked.push(c);
    used += eh;
  }
  return { picked, hours_used: Math.round(used * 10) / 10 };
}

// Re-sort the picker's output by the preset's strategic objective.
// We DON'T trust the picker's `weighted_score` directly because the
// presets express strategy via filter+sort, not just weights.
function rerankForPreset(allRanked, preset) {
  const eligible = allRanked.filter(preset.filter);
  eligible.sort((a, b) => preset.score(b) - preset.score(a));
  return eligible;
}

// Aggregate the picked candidates: monthly + annualised revenue + GP,
// using the preset's persistence_months as the annualisation multiplier
// (this is what makes Easy vs Hard show genuinely different annual
// numbers - quick wins decay faster).
function aggregateTotals(picked, hoursUsed, persistenceMonths) {
  let moRev = 0, moGp = 0, maxRealise = 0;
  for (const c of picked) {
    moRev += Number(c.estimated_lift_gbp_revenue) || 0;
    moGp  += Number(c.estimated_lift_gbp_profit)  || 0;
    const td = Number(c.time_to_realise_days);
    if (Number.isFinite(td) && td > maxRealise) maxRealise = td;
  }
  const yrRev = moRev * persistenceMonths;
  const yrGp  = moGp  * persistenceMonths;
  return {
    monthly_revenue_lift_gbp: Math.round(moRev),
    monthly_gp_lift_gbp:      Math.round(moGp),
    annualised_revenue_lift_gbp: Math.round(yrRev),
    annualised_gp_lift_gbp:      Math.round(yrGp),
    effort_hours: hoursUsed,
    max_time_to_realise_days: maxRealise,
    persistence_months: persistenceMonths,
    lift_per_hour_gbp_annualised: hoursUsed > 0
      ? Math.round(yrGp / hoursUsed)
      : null
  };
}

// Sum the picked candidates by tier so the UI can show "Academy drives
// £X, Courses drives £Y..." ranked. Surfaces the dominant tier as the
// first row.
function aggregateByTier(picked, persistenceMonths) {
  const byTier = new Map();
  for (const c of picked) {
    const t = c.tier_id || 'unknown';
    if (!byTier.has(t)) {
      byTier.set(t, { tier_id: t, tier_label: c.tier_label || t, count: 0, monthly_revenue_gbp: 0, monthly_gp_gbp: 0 });
    }
    const row = byTier.get(t);
    row.count += 1;
    row.monthly_revenue_gbp += Number(c.estimated_lift_gbp_revenue) || 0;
    row.monthly_gp_gbp      += Number(c.estimated_lift_gbp_profit)  || 0;
  }
  const arr = Array.from(byTier.values()).map(r => ({
    ...r,
    monthly_revenue_gbp: Math.round(r.monthly_revenue_gbp),
    monthly_gp_gbp:      Math.round(r.monthly_gp_gbp),
    annualised_gp_gbp:   Math.round(r.monthly_gp_gbp * persistenceMonths)
  }));
  arr.sort((a, b) => b.monthly_gp_gbp - a.monthly_gp_gbp);
  return arr;
}

function summarisePreset(meta, picked, hoursUsed, totalCandidates) {
  const totals = aggregateTotals(picked, hoursUsed, meta.persistence_months);
  return {
    preset_id: meta.id,
    preset_name: meta.name,
    preset_description: meta.description,
    horizon_days: meta.horizon_days,
    budget_hours: meta.budget_hours,
    persistence_months: meta.persistence_months,
    tier_weights:  meta.tier_weights,
    lever_weights: meta.lever_weights,
    top_candidates: picked.map(sanitiseCandidate),
    candidate_count: totalCandidates,
    by_tier: aggregateByTier(picked, meta.persistence_months),
    totals
  };
}

// --- Do-nothing baseline --------------------------------------------
// Pulls the same numbers the Revenue Funnel profit-pyramid shows by
// calling the summary endpoint internally. We don't recompute it here
// because the summary builder is non-trivial (tier history -> profit
// pyramid -> targets) and the canonical truth lives in that file.
async function fetchDoNothingBaseline(propertyUrl, req) {
  const base = inferBaseUrl(req);
  const url  = `${base}/api/aigeo/revenue-funnel-summary?propertyUrl=${encodeURIComponent(propertyUrl)}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    return extractBaseline(j);
  } catch {
    return null;
  }
}

function extractBaseline(summary) {
  const pp = summary?.profit_pyramid;
  if (!pp) return null;
  const yrRev = Number(pp.annualised_revenue_total_gbp) || 0;
  const yrGp  = Number(pp.annualised_gp_total_gbp) || 0;
  return {
    annualised_revenue_gbp: Math.round(yrRev),
    annualised_gp_gbp:      Math.round(yrGp),
    monthly_revenue_gbp:    Math.round(yrRev / 12),
    monthly_gp_gbp:         Math.round(yrGp  / 12),
    ytd_revenue_gbp:        Math.round(Number(pp.ytd_revenue_total_gbp) || 0),
    ytd_gp_gbp:             Math.round(Number(pp.ytd_gp_total_gbp) || 0),
    monthly_gp_target_low_gbp:  Number(pp.monthly_gp_target_low_gbp) || null,
    monthly_gp_target_high_gbp: Number(pp.monthly_gp_target_high_gbp) || null,
    annual_gp_target_low_gbp:   Number(pp.annual_gp_target_low_gbp)   || null,
    annual_gp_target_high_gbp:  Number(pp.annual_gp_target_high_gbp)  || null
  };
}

function inferBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host']  || req.headers.host || 'ai-geo-audit.vercel.app';
  return `${proto}://${host}`;
}

// Decorate each preset with delta-vs-baseline so the UI can show
// "do-nothing £X/mo -> with scenario £X+Δ/mo".
function applyBaselineDeltas(presets, baseline) {
  if (!baseline) return presets;
  return presets.map(p => {
    const t = p.totals;
    return {
      ...p,
      vs_do_nothing: {
        monthly_revenue_total_gbp: baseline.monthly_revenue_gbp + t.monthly_revenue_lift_gbp,
        monthly_gp_total_gbp:      baseline.monthly_gp_gbp      + t.monthly_gp_lift_gbp,
        annualised_revenue_total_gbp: baseline.annualised_revenue_gbp + t.annualised_revenue_lift_gbp,
        annualised_gp_total_gbp:      baseline.annualised_gp_gbp      + t.annualised_gp_lift_gbp,
        monthly_revenue_delta_pct: pctDelta(t.monthly_revenue_lift_gbp, baseline.monthly_revenue_gbp),
        monthly_gp_delta_pct:      pctDelta(t.monthly_gp_lift_gbp,      baseline.monthly_gp_gbp),
        annualised_gp_delta_pct:   pctDelta(t.annualised_gp_lift_gbp,   baseline.annualised_gp_gbp)
      }
    };
  });
}

function pctDelta(lift, baseline) {
  if (!baseline || baseline <= 0) return null;
  return Math.round((lift / baseline) * 1000) / 10;
}

// Resolve all preset summaries against the same snapshot in one pass.
function runAllPresets(snapshot) {
  return PRESETS.map(meta => {
    const weights = {
      tier:  mapFromObj(meta.tier_weights),
      lever: mapFromObj(meta.lever_weights)
    };
    const allRanked = SP.buildAllPriorities(snapshot, weights);
    const reranked  = rerankForPreset(allRanked, meta);
    const { picked, hours_used } = pickWithinBudget(reranked, meta.budget_hours);
    return summarisePreset(meta, picked, hours_used, allRanked.length);
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return send(res, 405, { error: 'method_not_allowed' });
  }

  const propertyUrl = String(req.query?.propertyUrl || DEFAULT_PROPERTY).trim();

  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const [snapshot, baseline] = await Promise.all([
      SP.buildSnapshot(supabase, propertyUrl),
      fetchDoNothingBaseline(propertyUrl, req)
    ]);
    const presetResults = runAllPresets(snapshot);
    const withDelta = applyBaselineDeltas(presetResults, baseline);
    return send(res, 200, {
      property_url: propertyUrl,
      generated_at: new Date().toISOString(),
      do_nothing_baseline: baseline,
      preset_count: withDelta.length,
      presets: withDelta
    });
  } catch (err) {
    return send(res, 500, {
      error: 'auto_optimise_failed',
      message: err?.message || String(err)
    });
  }
}
