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

// --- Per-lever persistence (decay) ----------------------------------
// How many months a monthly lift is assumed to keep paying out before
// competitive pressure or model churn erodes it. The asymmetry here is
// what makes Easy vs Hard generate genuinely different annualised
// numbers: a CTR win decays as soon as the competitor on rank #2
// rewrites their title; a top-3 rank win persists until they catch up
// on content depth, which is a much harder ask.
const PERSISTENCE_BY_LEVER = {
  ctr:        6,   // SERP CTR decay: competitor title rewrites in ~6mo
  schema:     12,  // Technical schema: durable until you remove it
  aio:        9,   // AI Overviews: model snapshot churns over ~9mo
  rank:       12,  // Organic rank: depth-content wins persist 12mo+
  surfacing:  12,  // Hub/orphan structural: durable
  conversion: 12   // Funnel CRO: durable until pricing/positioning changes
};

function persistenceMonthsFor(candidate) {
  const m = PERSISTENCE_BY_LEVER[candidate?.lever_id];
  return Number.isFinite(m) ? m : 9;
}

// --- Strategic preset profiles --------------------------------------
//
// Three genuinely different strategies (not just three weight knobs):
//   Easy     = "just do the quick wins"           - filter to <=1h actions, sort by L/hr, 6h budget
//   Balanced = "best monthly cash at medium commit" - all candidates, sort by monthly GP, 12h budget
//   Hard     = "max absolute return at full commit" - all candidates, sort by monthly GP, 24h budget
//
// Hard does NOT filter out CTR - in reality if you have 24h to spend
// you do the quick wins FIRST and then add the compound bets on top.
// The differentiation between Balanced and Hard comes from the budget
// alone: Hard fits more low-yield candidates that Balanced runs out of
// hours for, AND the longer-persistence rank/AIO candidates compound
// 12mo while Balanced still has shorter-decay CTR at 6mo.
//
// Annualised lift uses PER-LEVER persistence (see PERSISTENCE_BY_LEVER)
// so the strategy mix - not a flat assumption - drives the year-1 number.
const PRESETS = [
  {
    id: 'easy',
    name: 'Easy path (quick wins this month)',
    description: 'Sub-1-hour title + meta rewrites and schema drops only. Highest \u00A3-per-hour. CTR wins assumed to decay in ~6 months as competitors rewrite their titles.',
    horizon_days: 30,
    budget_hours: 6,
    tier_weights:  flatTierWeights(),
    lever_weights: { ctr: 2.0, schema: 1.5, aio: 0.5, rank: 0.2, surfacing: 0.5, conversion: 1.0 },
    filter: c => Number(c.effort_hours) <= 1 && Number(c.time_to_realise_days) <= 21,
    score:  c => Number(c.lift_per_hour_gbp) || 0
  },
  {
    id: 'balanced',
    name: 'Balanced path (most \u00A3 this month)',
    description: 'All levers eligible, picked by absolute monthly GP. Moderate 12-hour commit. Annualised numbers reflect per-lever persistence (CTR 6mo, AIO 9mo, rank/schema 12mo).',
    horizon_days: 90,
    budget_hours: 12,
    tier_weights:  flatTierWeights(),
    lever_weights: { ctr: 1.2, schema: 1.0, aio: 1.5, rank: 1.0, surfacing: 1.0, conversion: 1.2 },
    filter: ()=> true,
    score:  c => Number(c.estimated_lift_gbp_profit) || 0
  },
  {
    id: 'hard',
    name: 'Hard path (full-commit compound)',
    description: 'Do everything that fits a 24-hour commit: every quick CTR win PLUS every rank + AIO + schema pushup. Maximum absolute lift, with the long-persistence levers compounding for 12 months.',
    horizon_days: 180,
    budget_hours: 24,
    tier_weights:  flatTierWeights(),
    lever_weights: { ctr: 1.0, schema: 1.0, aio: 1.5, rank: 1.5, surfacing: 1.2, conversion: 1.0 },
    filter: ()=> true,
    score:  c => Number(c.estimated_lift_gbp_profit) || 0
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

// Aggregate the picked candidates: monthly + annualised revenue + GP.
// Annualisation uses PER-LEVER persistence so a CTR win counts for
// 6mo, schema for 12mo, etc. This is what makes Easy / Balanced / Hard
// show genuinely different annual numbers - it's the candidate MIX
// (not a flat preset multiplier) that drives the year-1 outcome.
function aggregateTotals(picked, hoursUsed) {
  let moRev = 0, moGp = 0, yrRev = 0, yrGp = 0, maxRealise = 0;
  let weightedMonths = 0;
  for (const c of picked) {
    const r = Number(c.estimated_lift_gbp_revenue) || 0;
    const g = Number(c.estimated_lift_gbp_profit)  || 0;
    const pm = persistenceMonthsFor(c);
    moRev += r;
    moGp  += g;
    yrRev += r * pm;
    yrGp  += g * pm;
    weightedMonths += g * pm;
    const td = Number(c.time_to_realise_days);
    if (Number.isFinite(td) && td > maxRealise) maxRealise = td;
  }
  const blendedPersistence = moGp > 0 ? weightedMonths / moGp : null;
  return {
    monthly_revenue_lift_gbp: Math.round(moRev),
    monthly_gp_lift_gbp:      Math.round(moGp),
    annualised_revenue_lift_gbp: Math.round(yrRev),
    annualised_gp_lift_gbp:      Math.round(yrGp),
    effort_hours: hoursUsed,
    max_time_to_realise_days: maxRealise,
    blended_persistence_months: blendedPersistence == null
      ? null
      : Math.round(blendedPersistence * 10) / 10,
    lift_per_hour_gbp_annualised: hoursUsed > 0
      ? Math.round(yrGp / hoursUsed)
      : null
  };
}

// Sum the picked candidates by tier so the UI can show "Academy drives
// £A rev / £B GP, Courses drives ..." ranked by monthly GP. Now exposes
// monthly + annualised REVENUE alongside GP so the user can compare
// segment contribution on both axes.
function aggregateByTier(picked) {
  const byTier = new Map();
  for (const c of picked) {
    const t = c.tier_id || 'unknown';
    if (!byTier.has(t)) {
      byTier.set(t, {
        tier_id: t, tier_label: c.tier_label || t, count: 0,
        monthly_revenue_gbp: 0, monthly_gp_gbp: 0,
        annualised_revenue_gbp: 0, annualised_gp_gbp: 0
      });
    }
    const row = byTier.get(t);
    const r = Number(c.estimated_lift_gbp_revenue) || 0;
    const g = Number(c.estimated_lift_gbp_profit)  || 0;
    const pm = persistenceMonthsFor(c);
    row.count += 1;
    row.monthly_revenue_gbp += r;
    row.monthly_gp_gbp      += g;
    row.annualised_revenue_gbp += r * pm;
    row.annualised_gp_gbp      += g * pm;
  }
  const arr = Array.from(byTier.values()).map(r => ({
    ...r,
    monthly_revenue_gbp:    Math.round(r.monthly_revenue_gbp),
    monthly_gp_gbp:         Math.round(r.monthly_gp_gbp),
    annualised_revenue_gbp: Math.round(r.annualised_revenue_gbp),
    annualised_gp_gbp:      Math.round(r.annualised_gp_gbp)
  }));
  arr.sort((a, b) => b.annualised_gp_gbp - a.annualised_gp_gbp);
  return arr;
}

function summarisePreset(meta, picked, hoursUsed, totalCandidates) {
  const totals = aggregateTotals(picked, hoursUsed);
  return {
    preset_id: meta.id,
    preset_name: meta.name,
    preset_description: meta.description,
    horizon_days: meta.horizon_days,
    budget_hours: meta.budget_hours,
    persistence_months_by_lever: PERSISTENCE_BY_LEVER,
    tier_weights:  meta.tier_weights,
    lever_weights: meta.lever_weights,
    // Carry _rebuild through here so liveEnrichTopCandidates can build
    // page-aware recommended_actions[]. Sanitised AFTER enrichment by
    // sanitisePresetCandidates() before the response is sent.
    top_candidates: picked.slice(),
    candidate_count: totalCandidates,
    by_tier: aggregateByTier(picked),
    totals
  };
}

function sanitisePresetCandidates(presetResults) {
  for (const p of presetResults) {
    if (Array.isArray(p.top_candidates)) {
      p.top_candidates = p.top_candidates.map(sanitiseCandidate);
    }
  }
  return presetResults;
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
function runAllPresets(snapshot, suppressionMap) {
  return PRESETS.map(meta => {
    const weights = {
      tier:  mapFromObj(meta.tier_weights),
      lever: mapFromObj(meta.lever_weights)
    };
    const allRanked = SP.buildAllPriorities(snapshot, weights, suppressionMap);
    const reranked  = rerankForPreset(allRanked, meta);
    const { picked, hours_used } = pickWithinBudget(reranked, meta.budget_hours);
    return summarisePreset(meta, picked, hours_used, allRanked.length);
  });
}

// Phase H (2026-05-20): the smart-priorities endpoint live-enriches the
// top-N candidates so each card surfaces a PAGE-SPECIFIC action plan.
// The auto-optimise endpoint was bypassing that pass, which meant the
// Easy / Balanced / Hard cards were rendering the legacy "Rewrite title
// + meta description" hardcoded label on every candidate. Run the same
// enrichment here on the picked candidates of every preset so the
// numbered "do this in order" plan lands on the Auto-Optimise cards too.
async function enrichPresetCandidates(presetResults, ctx) {
  await Promise.all(presetResults.map(async (p) => {
    if (Array.isArray(p.top_candidates) && p.top_candidates.length) {
      await SP.liveEnrichTopCandidates(p.top_candidates, ctx);
    }
  }));
  return presetResults;
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
    const optimCycles = await SP.fetchActiveOptimisationCycles(supabase);
    const suppressionMap = SP.buildSuppressionMap(optimCycles);
    const monthIdx = SP.currentMonthIndex();
    const presetResults = runAllPresets(snapshot, suppressionMap);
    await enrichPresetCandidates(presetResults, { suppressionMap, monthIdx });
    sanitisePresetCandidates(presetResults);
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
