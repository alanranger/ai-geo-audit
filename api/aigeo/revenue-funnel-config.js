// Revenue Funnel scenario-engine configuration (scenario-scoped)
// -------------------------------------------------------------------
// Read/write the three lever-scenario tables seeded by
// Docs/migrations/2026-05-20-scenario-engine-tables.sql and re-scoped
// to scenario_id by Docs/migrations/2026-05-21-scenario-planning-tables.sql:
//
//   public.revenue_funnel_targets        (master + per-tier rev / GP target)
//   public.revenue_funnel_tier_weights   (per-tier strategic weight 0..5)
//   public.revenue_funnel_lever_weights  (per-lever strategic weight 0..5 + effort_cap)
//
// Each row now belongs to a specific scenario (revenue_funnel_scenarios.id).
// When the caller doesn't pass a scenarioId we fall back to the ACTIVE
// scenario for the property so legacy callers (and the Top 3 Actions
// picker which reads "the config" for a property) keep working without
// any change.
//
// Method:
//   GET  /api/aigeo/revenue-funnel-config?propertyUrl=...[&scenarioId=...]
//        -> { scenario_id, property_url, targets: { master, byTier },
//             tier_weights, lever_weights }
//
//   POST /api/aigeo/revenue-funnel-config
//        body: { propertyUrl, scenarioId?, targets?, tier_weights?, lever_weights? }
//        Only the sections present in the body are upserted; others
//        are left untouched. scenarioId defaults to the property's
//        active scenario.

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';
const VALID_LEVER_IDS = new Set(['rank', 'aio', 'ctr', 'schema', 'conversion', 'surfacing']);
const VALID_EFFORT_CAPS = new Set(['low', 'medium', 'high']);

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
};

const need = (key) => {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
};

function parseBody(req) {
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  if (req.body && typeof req.body === 'object') return req.body;
  return {};
}

function clampWeight(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1.0;
  if (n < 0) return 0;
  if (n > 5) return 5;
  return Math.round(n * 100) / 100;
}

function nonNegativeInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

// -------------------------------------------------------------------
// Resolve which scenario_id to read/write. Either explicit (from query
// or body) or fall back to the active scenario for the property.
// Throws scenario_not_found if neither resolves so the caller can
// surface a clear error rather than silently writing to nothing.
// -------------------------------------------------------------------
async function resolveScenarioId(supabase, propertyUrl, explicitScenarioId) {
  if (explicitScenarioId) {
    const { data, error } = await supabase
      .from('revenue_funnel_scenarios')
      .select('id, property_url')
      .eq('id', explicitScenarioId)
      .single();
    if (error || !data) throw new Error('scenario_not_found');
    if (data.property_url !== propertyUrl) throw new Error('scenario_property_mismatch');
    return data.id;
  }
  const { data, error } = await supabase
    .from('revenue_funnel_scenarios')
    .select('id')
    .eq('property_url', propertyUrl)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('no_active_scenario');
  return data.id;
}

// -------------------------------------------------------------------
// GET: load all three sections for a scenario
// -------------------------------------------------------------------
async function loadConfig(supabase, scenarioId) {
  const [{ data: tgtRows, error: e1 }, { data: tierRows, error: e2 }, { data: leverRows, error: e3 }] = await Promise.all([
    supabase.from('revenue_funnel_targets').select('tier_id, monthly_revenue_target_gbp, monthly_gp_target_gbp, notes, updated_at').eq('scenario_id', scenarioId),
    supabase.from('revenue_funnel_tier_weights').select('tier_id, strategic_weight, notes, updated_at').eq('scenario_id', scenarioId),
    supabase.from('revenue_funnel_lever_weights').select('lever_id, strategic_weight, effort_cap, notes, updated_at').eq('scenario_id', scenarioId)
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;
  const targets = { master: null, byTier: {} };
  for (const row of (tgtRows || [])) {
    const tier = row.tier_id || null;
    const shaped = {
      monthly_revenue_target_gbp: Number(row.monthly_revenue_target_gbp) || 0,
      monthly_gp_target_gbp: Number(row.monthly_gp_target_gbp) || 0,
      notes: row.notes || null,
      updated_at: row.updated_at || null
    };
    if (tier === null) targets.master = shaped;
    else targets.byTier[tier] = shaped;
  }
  const tier_weights = {};
  for (const row of (tierRows || [])) {
    tier_weights[row.tier_id] = {
      strategic_weight: Number(row.strategic_weight) || 1.0,
      notes: row.notes || null,
      updated_at: row.updated_at || null
    };
  }
  const lever_weights = {};
  for (const row of (leverRows || [])) {
    lever_weights[row.lever_id] = {
      strategic_weight: Number(row.strategic_weight) || 1.0,
      effort_cap: row.effort_cap || null,
      notes: row.notes || null,
      updated_at: row.updated_at || null
    };
  }
  return { targets, tier_weights, lever_weights };
}

// -------------------------------------------------------------------
// POST: upsert any of the three sections supplied in the body
// -------------------------------------------------------------------
function buildTargetRows(propertyUrl, scenarioId, targetsPayload) {
  const rows = [];
  if (targetsPayload && targetsPayload.master) {
    const m = targetsPayload.master;
    rows.push({
      property_url: propertyUrl,
      scenario_id: scenarioId,
      tier_id: null,
      monthly_revenue_target_gbp: nonNegativeInt(m.monthly_revenue_target_gbp),
      monthly_gp_target_gbp: nonNegativeInt(m.monthly_gp_target_gbp),
      notes: m.notes || null
    });
  }
  const byTier = (targetsPayload && targetsPayload.byTier) || {};
  for (const tierId of Object.keys(byTier)) {
    const t = byTier[tierId];
    if (!t) continue;
    rows.push({
      property_url: propertyUrl,
      scenario_id: scenarioId,
      tier_id: tierId,
      monthly_revenue_target_gbp: nonNegativeInt(t.monthly_revenue_target_gbp),
      monthly_gp_target_gbp: nonNegativeInt(t.monthly_gp_target_gbp),
      notes: t.notes || null
    });
  }
  return rows;
}

async function saveTargets(supabase, propertyUrl, scenarioId, payload) {
  const rows = buildTargetRows(propertyUrl, scenarioId, payload);
  if (!rows.length) return { saved: 0 };
  // Manual upsert via delete-then-insert. The new functional unique index
  // (scenario_id, COALESCE(tier_id, '')) WOULD let us use upsert with
  // ignoreDuplicates: false, but PostgREST can't easily reference that
  // expression-based index, so we keep the delete-then-insert pattern
  // scoped to scenario_id (not property_url) so multiple scenarios on
  // the same property don't trample each other.
  const tierKeys = rows.map(r => r.tier_id);
  let q = supabase.from('revenue_funnel_targets').delete().eq('scenario_id', scenarioId);
  if (tierKeys.includes(null) && tierKeys.filter(t => t !== null).length) {
    q = q.or(`tier_id.is.null,tier_id.in.(${tierKeys.filter(t => t !== null).map(t => `"${t}"`).join(',')})`);
  } else if (tierKeys.includes(null)) {
    q = q.is('tier_id', null);
  } else {
    q = q.in('tier_id', tierKeys);
  }
  const { error: delErr } = await q;
  if (delErr) throw delErr;
  const { error: insErr } = await supabase.from('revenue_funnel_targets').insert(rows);
  if (insErr) throw insErr;
  return { saved: rows.length };
}

async function saveTierWeights(supabase, propertyUrl, scenarioId, payload) {
  if (!payload || typeof payload !== 'object') return { saved: 0 };
  const rows = [];
  for (const tierId of Object.keys(payload)) {
    const v = payload[tierId];
    if (!v) continue;
    rows.push({
      property_url: propertyUrl,
      scenario_id: scenarioId,
      tier_id: tierId,
      strategic_weight: clampWeight(v.strategic_weight),
      notes: v.notes || null
    });
  }
  if (!rows.length) return { saved: 0 };
  const { error } = await supabase
    .from('revenue_funnel_tier_weights')
    .upsert(rows, { onConflict: 'scenario_id,tier_id' });
  if (error) throw error;
  return { saved: rows.length };
}

async function saveLeverWeights(supabase, propertyUrl, scenarioId, payload) {
  if (!payload || typeof payload !== 'object') return { saved: 0 };
  const rows = [];
  for (const leverId of Object.keys(payload)) {
    if (!VALID_LEVER_IDS.has(leverId)) continue;
    const v = payload[leverId];
    if (!v) continue;
    const cap = v.effort_cap;
    rows.push({
      property_url: propertyUrl,
      scenario_id: scenarioId,
      lever_id: leverId,
      strategic_weight: clampWeight(v.strategic_weight),
      effort_cap: (cap && VALID_EFFORT_CAPS.has(cap)) ? cap : null,
      notes: v.notes || null
    });
  }
  if (!rows.length) return { saved: 0 };
  const { error } = await supabase
    .from('revenue_funnel_lever_weights')
    .upsert(rows, { onConflict: 'scenario_id,lever_id' });
  if (error) throw error;
  return { saved: rows.length };
}

// -------------------------------------------------------------------
// Handler
// -------------------------------------------------------------------
function readQueryOrBody(req) {
  if (req.method === 'GET') return req.query || {};
  return parseBody(req);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  const src = readQueryOrBody(req);
  const propertyUrl = String(src.propertyUrl || src.property_url || DEFAULT_PROPERTY).trim();
  const explicitScenarioId = src.scenarioId || src.scenario_id || null;
  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const scenarioId = await resolveScenarioId(supabase, propertyUrl, explicitScenarioId);
    if (req.method === 'GET') {
      const cfg = await loadConfig(supabase, scenarioId);
      return send(res, 200, {
        scenario_id: scenarioId,
        property_url: propertyUrl,
        loaded_at: new Date().toISOString(),
        ...cfg
      });
    }
    if (req.method === 'POST') {
      const body = parseBody(req);
      const tasks = [];
      if (body.targets)       tasks.push(saveTargets(supabase, propertyUrl, scenarioId, body.targets));
      if (body.tier_weights)  tasks.push(saveTierWeights(supabase, propertyUrl, scenarioId, body.tier_weights));
      if (body.lever_weights) tasks.push(saveLeverWeights(supabase, propertyUrl, scenarioId, body.lever_weights));
      const results = await Promise.all(tasks);
      const cfg = await loadConfig(supabase, scenarioId);
      return send(res, 200, {
        scenario_id: scenarioId,
        property_url: propertyUrl,
        saved_at: new Date().toISOString(),
        saved_rows: results.reduce((a, r) => a + (r.saved || 0), 0),
        ...cfg
      });
    }
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    const status = msg === 'scenario_not_found' || msg === 'no_active_scenario' || msg === 'scenario_property_mismatch' ? 400 : 500;
    return send(res, status, { error: 'config_error', detail: msg });
  }
}
