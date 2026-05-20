// Auto-Optimise Scenarios endpoint.
//
// Runs the smart-priorities picker against the same audit snapshot
// under three fixed strategic preset weight profiles ("Easy",
// "Medium", "Hard") and returns the top candidates + aggregate
// projected lift + effort hours for each. The UI surfaces these as
// "Easy/Medium/Hard path" preset cards in the Scenario Planning tab
// so the user can compare and either adopt one as a named scenario
// or just use it as a sanity check.
//
// Why preset profiles rather than a true gradient solver?
// 1. The lift estimates are heuristic (CTR-by-position, fixed AOV/click,
//    etc) - running a numerical optimiser over them risks overfitting
//    to those heuristics.
// 2. The user reasons about strategy in terms of "quick wins this
//    month" vs "compound 6-month bets", not "what tier weight
//    combination maximises projected GP". Profiles map to mental
//    models.
// 3. Three discrete options is cognitively manageable; a continuous
//    slider would be paralysis.

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

// Convert a plain {tier_id: weight} object into the Map shape that
// buildAllPriorities expects.
function mapFromObj(obj) {
  const m = new Map();
  for (const k of Object.keys(obj || {})) m.set(k, Number(obj[k]));
  return m;
}

// Three preset weight profiles. Tier weights are kept flat (1.0)
// across all presets because the Easy/Medium/Hard distinction is
// about TIME HORIZON not strategic tier emphasis - the user should
// be able to overlay these on whatever tier mix their active
// scenario has already configured.
//
// Lever weights drive the distinction:
//  - Easy: heavy CTR, light AIO, kill rank/schema/surfacing (long-tail).
//          These are sub-1-hour title/meta rewrites with 14-day payback.
//  - Medium: balanced - CTR + AIO at moderate boost, rank/schema/surfacing
//          at baseline. Spread bets across short + medium horizon.
//  - Hard: heavy rank + AIO, light CTR (assumed already done), light
//          surfacing. Compound 6-month bets.
const PRESETS = [
  {
    id: 'easy',
    name: 'Easy path (quick wins this month)',
    description: 'Title + meta rewrites and missing schema blocks. <= 1 hour per action, 14-day payback. Lock in low-hanging fruit before chasing rank.',
    horizon_days: 30,
    tier_weights:  { academy: 1.0, courses: 1.0, workshops_nonres: 1.0, workshops_residential: 1.0, services: 1.0, hire: 1.0 },
    lever_weights: { ctr: 2.0, aio: 1.0, rank: 0.15, schema: 1.2, surfacing: 0.3 }
  },
  {
    id: 'medium',
    name: 'Balanced path (90-day blend)',
    description: 'Mix of CTR sweeps and AIO citation work plus a few rank pushes. Spreads risk across 30/60/90 day payback.',
    horizon_days: 90,
    tier_weights:  { academy: 1.0, courses: 1.0, workshops_nonres: 1.0, workshops_residential: 1.0, services: 1.0, hire: 1.0 },
    lever_weights: { ctr: 1.5, aio: 1.5, rank: 1.0, schema: 1.0, surfacing: 1.0 }
  },
  {
    id: 'hard',
    name: 'Hard path (compound 6-month bets)',
    description: 'Rank lifts + AIO citation captures. 2-4 hour actions with 60-day payback. Biggest projected lifts but slowest to land.',
    horizon_days: 180,
    tier_weights:  { academy: 1.0, courses: 1.0, workshops_nonres: 1.0, workshops_residential: 1.0, services: 1.0, hire: 1.0 },
    lever_weights: { ctr: 0.7, aio: 2.0, rank: 2.0, schema: 0.8, surfacing: 0.5 }
  }
];

// Strip the rebuild marker before responding - it carries closures
// the JSON.stringify path can't serialise cleanly.
function sanitiseCandidate(c) {
  const out = { ...c };
  delete out._rebuild;
  return out;
}

// Reduce the picker's full ranked output into a single preset summary.
// We take the TOP_N by weighted score, sum the numeric GP/revenue
// lifts, sum the effort hours, and surface the slowest realise day
// count (so the user sees the worst-case time to actually see results).
const TOP_N_FOR_PRESET = 5;
function summarisePreset(presetMeta, ranked) {
  const top = ranked.slice(0, TOP_N_FOR_PRESET);
  let totalMoRev = 0;
  let totalMoGp  = 0;
  let totalHours = 0;
  let maxRealise = 0;
  for (const c of top) {
    totalMoRev += Number(c.estimated_lift_gbp_revenue) || 0;
    totalMoGp  += Number(c.estimated_lift_gbp_profit)  || 0;
    totalHours += Number(c.effort_hours) || 0;
    const td = Number(c.time_to_realise_days);
    if (Number.isFinite(td) && td > maxRealise) maxRealise = td;
  }
  return {
    preset_id: presetMeta.id,
    preset_name: presetMeta.name,
    preset_description: presetMeta.description,
    horizon_days: presetMeta.horizon_days,
    tier_weights: presetMeta.tier_weights,
    lever_weights: presetMeta.lever_weights,
    top_candidates: top.map(sanitiseCandidate),
    candidate_count: ranked.length,
    totals: {
      monthly_revenue_lift_gbp: Math.round(totalMoRev),
      monthly_gp_lift_gbp:      Math.round(totalMoGp),
      annualised_revenue_lift_gbp: Math.round(totalMoRev * 12),
      annualised_gp_lift_gbp:      Math.round(totalMoGp  * 12),
      effort_hours: Math.round(totalHours * 10) / 10,
      max_time_to_realise_days: maxRealise,
      lift_per_hour_gbp_annualised: totalHours > 0
        ? Math.round((totalMoGp * 12) / totalHours)
        : null
    }
  };
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
    // Build the snapshot ONCE and re-use it across all preset runs.
    // buildAllPriorities is pure data manipulation against the
    // snapshot, so each preset is a few-ms in-process pass rather
    // than a fresh DB hit.
    const snapshot = await SP.buildSnapshot(supabase, propertyUrl);

    const presetResults = PRESETS.map(meta => {
      const weights = {
        tier:  mapFromObj(meta.tier_weights),
        lever: mapFromObj(meta.lever_weights)
      };
      const ranked = SP.buildAllPriorities(snapshot, weights);
      return summarisePreset(meta, ranked);
    });

    return send(res, 200, {
      property_url: propertyUrl,
      generated_at: new Date().toISOString(),
      preset_count: presetResults.length,
      presets: presetResults
    });
  } catch (err) {
    return send(res, 500, {
      error: 'auto_optimise_failed',
      message: err?.message || String(err)
    });
  }
}
