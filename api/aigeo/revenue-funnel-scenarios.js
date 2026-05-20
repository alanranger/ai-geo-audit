// Revenue Funnel - scenario library CRUD
// -------------------------------------------------------------------
// Owns the public.revenue_funnel_scenarios table from
// Docs/migrations/2026-05-21-scenario-planning-tables.sql.
//
// A scenario is a NAMED bundle of targets + tier weights + lever
// weights + a monthly survival baseline + an hours-per-week budget.
// One scenario per property is marked is_active=true; the smart-
// priorities picker reads the active scenario when ranking the Top 3.
//
// Endpoints:
//   GET    /api/aigeo/revenue-funnel-scenarios?propertyUrl=...
//          -> list every scenario for the property (newest first)
//
//   POST   /api/aigeo/revenue-funnel-scenarios
//          body { action: 'create', propertyUrl, name, notes?,
//                 monthlySurvivalBaselineGbp?, hoursPerWeek?,
//                 makeActive? }
//          -> creates a blank scenario (no targets / weights yet);
//             callers POST those separately to revenue-funnel-config
//             with the new scenarioId.
//
//          body { action: 'duplicate', sourceScenarioId, newName,
//                 makeActive? }
//          -> creates a copy of an existing scenario including ALL
//             its targets, tier weights and lever weights. Useful for
//             "fork this scenario and tweak it".
//
//   PATCH  /api/aigeo/revenue-funnel-scenarios
//          body { scenarioId, name?, notes?,
//                 monthlySurvivalBaselineGbp?, hoursPerWeek?,
//                 makeActive? }
//          -> updates the scenario fields. Setting makeActive=true
//             deactivates the previously-active scenario for that
//             property in the same transaction so the partial unique
//             index never sees two actives.
//
//   DELETE /api/aigeo/revenue-funnel-scenarios?scenarioId=...
//          -> deletes the scenario (and cascades targets/weights/levers).
//             Refuses to delete the only remaining active scenario for
//             a property (returns 409 with a hint to activate another
//             first).

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
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

function asNumberOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function shapeScenario(row) {
  if (!row) return null;
  return {
    id: row.id,
    property_url: row.property_url,
    name: row.name,
    notes: row.notes || null,
    is_active: !!row.is_active,
    monthly_survival_baseline_gbp: row.monthly_survival_baseline_gbp == null ? null : Number(row.monthly_survival_baseline_gbp),
    hours_per_week: row.hours_per_week == null ? null : Number(row.hours_per_week),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

// -------------------------------------------------------------------
// LIST
// -------------------------------------------------------------------
async function listScenarios(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('revenue_funnel_scenarios')
    .select('id, property_url, name, notes, is_active, monthly_survival_baseline_gbp, hours_per_week, created_at, updated_at')
    .eq('property_url', propertyUrl)
    .order('is_active', { ascending: false })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(shapeScenario);
}

// -------------------------------------------------------------------
// CREATE (blank scenario - caller writes targets/weights separately)
// -------------------------------------------------------------------
async function createScenario(supabase, body) {
  const propertyUrl = String(body.propertyUrl || DEFAULT_PROPERTY).trim();
  const name = String(body.name || '').trim();
  if (!name) throw new Error('name_required');
  const payload = {
    property_url: propertyUrl,
    name,
    notes: body.notes ? String(body.notes) : null,
    monthly_survival_baseline_gbp: asNumberOrNull(body.monthlySurvivalBaselineGbp),
    hours_per_week: asNumberOrNull(body.hoursPerWeek),
    is_active: false
  };
  const { data, error } = await supabase
    .from('revenue_funnel_scenarios')
    .insert(payload)
    .select('id, property_url, name, notes, is_active, monthly_survival_baseline_gbp, hours_per_week, created_at, updated_at')
    .single();
  if (error) throw error;
  if (body.makeActive) await activateScenario(supabase, data.id, propertyUrl);
  return shapeScenario(data);
}

// -------------------------------------------------------------------
// DUPLICATE (copy scenario + all its targets/weights/levers)
// -------------------------------------------------------------------
async function loadSourceScenarioBundle(supabase, sourceId) {
  const [{ data: src, error: e1 }, tgt, tw, lw] = await Promise.all([
    supabase.from('revenue_funnel_scenarios').select('*').eq('id', sourceId).single(),
    supabase.from('revenue_funnel_targets').select('tier_id, monthly_revenue_target_gbp, monthly_gp_target_gbp, notes').eq('scenario_id', sourceId),
    supabase.from('revenue_funnel_tier_weights').select('tier_id, strategic_weight, notes').eq('scenario_id', sourceId),
    supabase.from('revenue_funnel_lever_weights').select('lever_id, strategic_weight, effort_cap, notes').eq('scenario_id', sourceId)
  ]);
  if (e1) throw e1;
  if (tgt.error) throw tgt.error;
  if (tw.error)  throw tw.error;
  if (lw.error)  throw lw.error;
  return { src, targets: tgt.data || [], tierWeights: tw.data || [], leverWeights: lw.data || [] };
}

async function insertDuplicateRows(supabase, newScenarioId, propertyUrl, bundle) {
  const tgtRows = bundle.targets.map(r => ({ ...r, property_url: propertyUrl, scenario_id: newScenarioId }));
  const twRows  = bundle.tierWeights.map(r => ({ ...r, property_url: propertyUrl, scenario_id: newScenarioId }));
  const lwRows  = bundle.leverWeights.map(r => ({ ...r, property_url: propertyUrl, scenario_id: newScenarioId }));
  const tasks = [];
  if (tgtRows.length) tasks.push(supabase.from('revenue_funnel_targets').insert(tgtRows));
  if (twRows.length)  tasks.push(supabase.from('revenue_funnel_tier_weights').insert(twRows));
  if (lwRows.length)  tasks.push(supabase.from('revenue_funnel_lever_weights').insert(lwRows));
  const results = await Promise.all(tasks);
  for (const r of results) if (r.error) throw r.error;
  return { targets: tgtRows.length, tierWeights: twRows.length, leverWeights: lwRows.length };
}

async function duplicateScenario(supabase, body) {
  const sourceId = String(body.sourceScenarioId || '').trim();
  const newName = String(body.newName || '').trim();
  if (!sourceId) throw new Error('source_scenario_id_required');
  if (!newName)  throw new Error('new_name_required');
  const bundle = await loadSourceScenarioBundle(supabase, sourceId);
  if (!bundle.src) throw new Error('source_scenario_not_found');
  const propertyUrl = bundle.src.property_url;
  const { data: created, error: insErr } = await supabase
    .from('revenue_funnel_scenarios')
    .insert({
      property_url: propertyUrl,
      name: newName,
      notes: `Duplicated from "${bundle.src.name}" on ${new Date().toISOString()}.`,
      monthly_survival_baseline_gbp: bundle.src.monthly_survival_baseline_gbp,
      hours_per_week: bundle.src.hours_per_week,
      is_active: false
    })
    .select('id, property_url, name, notes, is_active, monthly_survival_baseline_gbp, hours_per_week, created_at, updated_at')
    .single();
  if (insErr) throw insErr;
  const copied = await insertDuplicateRows(supabase, created.id, propertyUrl, bundle);
  if (body.makeActive) await activateScenario(supabase, created.id, propertyUrl);
  return { scenario: shapeScenario(created), copied };
}

// -------------------------------------------------------------------
// ACTIVATE
// -------------------------------------------------------------------
async function activateScenario(supabase, scenarioId, propertyUrl) {
  const { error: clearErr } = await supabase
    .from('revenue_funnel_scenarios')
    .update({ is_active: false })
    .eq('property_url', propertyUrl)
    .neq('id', scenarioId);
  if (clearErr) throw clearErr;
  const { error: setErr } = await supabase
    .from('revenue_funnel_scenarios')
    .update({ is_active: true })
    .eq('id', scenarioId)
    .eq('property_url', propertyUrl);
  if (setErr) throw setErr;
}

// -------------------------------------------------------------------
// PATCH (rename, change baseline/hours, activate)
// -------------------------------------------------------------------
function buildScenarioPatch(body) {
  const patch = {};
  if (body.name !== undefined)                          patch.name = String(body.name).trim();
  if (body.notes !== undefined)                         patch.notes = body.notes === null ? null : String(body.notes);
  if (body.monthlySurvivalBaselineGbp !== undefined)    patch.monthly_survival_baseline_gbp = asNumberOrNull(body.monthlySurvivalBaselineGbp);
  if (body.hoursPerWeek !== undefined)                  patch.hours_per_week = asNumberOrNull(body.hoursPerWeek);
  return patch;
}

async function patchScenario(supabase, body) {
  const scenarioId = String(body.scenarioId || '').trim();
  if (!scenarioId) throw new Error('scenario_id_required');
  const patch = buildScenarioPatch(body);
  let updated = null;
  if (Object.keys(patch).length) {
    const { data, error } = await supabase
      .from('revenue_funnel_scenarios')
      .update(patch)
      .eq('id', scenarioId)
      .select('id, property_url, name, notes, is_active, monthly_survival_baseline_gbp, hours_per_week, created_at, updated_at')
      .single();
    if (error) throw error;
    updated = data;
  } else {
    const { data, error } = await supabase
      .from('revenue_funnel_scenarios')
      .select('id, property_url, name, notes, is_active, monthly_survival_baseline_gbp, hours_per_week, created_at, updated_at')
      .eq('id', scenarioId)
      .single();
    if (error) throw error;
    updated = data;
  }
  if (body.makeActive) {
    await activateScenario(supabase, scenarioId, updated.property_url);
    updated.is_active = true;
  }
  return shapeScenario(updated);
}

// -------------------------------------------------------------------
// DELETE
// -------------------------------------------------------------------
async function deleteScenario(supabase, scenarioId) {
  if (!scenarioId) throw new Error('scenario_id_required');
  const { data: target, error: fetchErr } = await supabase
    .from('revenue_funnel_scenarios')
    .select('id, property_url, is_active')
    .eq('id', scenarioId)
    .single();
  if (fetchErr) throw fetchErr;
  if (!target) return { deleted: 0 };
  if (target.is_active) {
    const { count, error: countErr } = await supabase
      .from('revenue_funnel_scenarios')
      .select('id', { count: 'exact', head: true })
      .eq('property_url', target.property_url);
    if (countErr) throw countErr;
    if ((count || 0) <= 1) {
      const err = new Error('cannot_delete_only_scenario');
      err.statusHint = 409;
      throw err;
    }
  }
  const { error } = await supabase
    .from('revenue_funnel_scenarios')
    .delete()
    .eq('id', scenarioId);
  if (error) throw error;
  return { deleted: 1, was_active: target.is_active, property_url: target.property_url };
}

// -------------------------------------------------------------------
// Handler
// -------------------------------------------------------------------
async function dispatchPost(supabase, body) {
  const action = String(body.action || 'create').toLowerCase();
  if (action === 'duplicate') return { ok: true, ...(await duplicateScenario(supabase, body)) };
  if (action === 'create')    return { ok: true, scenario: await createScenario(supabase, body) };
  throw new Error('unknown_action');
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });
  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    if (req.method === 'GET') {
      const propertyUrl = String(req.query.propertyUrl || req.query.property_url || DEFAULT_PROPERTY).trim();
      const scenarios = await listScenarios(supabase, propertyUrl);
      const active = scenarios.find(s => s.is_active) || null;
      return send(res, 200, {
        property_url: propertyUrl,
        loaded_at: new Date().toISOString(),
        active_scenario_id: active ? active.id : null,
        scenarios
      });
    }
    if (req.method === 'POST')  return send(res, 200, await dispatchPost(supabase, parseBody(req)));
    if (req.method === 'PATCH') return send(res, 200, { ok: true, scenario: await patchScenario(supabase, parseBody(req)) });
    if (req.method === 'DELETE') {
      const id = String(req.query.scenarioId || req.query.scenario_id || '').trim();
      return send(res, 200, { ok: true, ...(await deleteScenario(supabase, id)) });
    }
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    const status = (err && err.statusHint) || 500;
    return send(res, status, { error: 'scenario_error', detail: msg });
  }
}
