// Revenue Funnel scenario-engine configuration
// -------------------------------------------------------------------
// Read/write the three lever-scenario tables seeded by
// Docs/migrations/2026-05-20-scenario-engine-tables.sql:
//
//   public.revenue_funnel_targets        (master + per-tier rev / GP target)
//   public.revenue_funnel_tier_weights   (per-tier strategic weight 0..5)
//   public.revenue_funnel_lever_weights  (per-lever strategic weight 0..5 + effort_cap)
//
// Method:
//   GET  /api/aigeo/revenue-funnel-config?propertyUrl=...
//        -> { targets: { master, byTier }, tier_weights, lever_weights, meta }
//   POST /api/aigeo/revenue-funnel-config
//        body: { propertyUrl, targets?, tier_weights?, lever_weights? }
//        Only the sections present in the body are upserted; others
//        are left untouched. Useful for partial saves (e.g. "save just
//        the tier sliders") and for incremental UI updates.
//
// The smart-priorities scenario engine reads these tables before it
// sorts candidates (Phase 2.2 work). This endpoint only owns config
// CRUD - the engine itself stays in revenue-funnel-smart-priorities.js.

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
// GET: load all three sections for a property
// -------------------------------------------------------------------
async function loadConfig(supabase, propertyUrl) {
  const [{ data: tgtRows, error: e1 }, { data: tierRows, error: e2 }, { data: leverRows, error: e3 }] = await Promise.all([
    supabase.from('revenue_funnel_targets').select('tier_id, monthly_revenue_target_gbp, monthly_gp_target_gbp, notes, updated_at').eq('property_url', propertyUrl),
    supabase.from('revenue_funnel_tier_weights').select('tier_id, strategic_weight, notes, updated_at').eq('property_url', propertyUrl),
    supabase.from('revenue_funnel_lever_weights').select('lever_id, strategic_weight, effort_cap, notes, updated_at').eq('property_url', propertyUrl)
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
function buildTargetRows(propertyUrl, targetsPayload) {
  const rows = [];
  if (targetsPayload && targetsPayload.master) {
    const m = targetsPayload.master;
    rows.push({
      property_url: propertyUrl,
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
      tier_id: tierId,
      monthly_revenue_target_gbp: nonNegativeInt(t.monthly_revenue_target_gbp),
      monthly_gp_target_gbp: nonNegativeInt(t.monthly_gp_target_gbp),
      notes: t.notes || null
    });
  }
  return rows;
}

async function saveTargets(supabase, propertyUrl, payload) {
  const rows = buildTargetRows(propertyUrl, payload);
  if (!rows.length) return { saved: 0 };
  // Manual upsert via delete-then-insert to avoid PostgREST quirks with
  // partial-NULL composite uniqueness (the unique index is on
  // COALESCE(tier_id, ''), which PostgREST doesn't auto-detect).
  const tierKeys = rows.map(r => r.tier_id);
  let q = supabase.from('revenue_funnel_targets').delete().eq('property_url', propertyUrl);
  if (tierKeys.includes(null) && tierKeys.filter(t => t !== null).length) {
    // Delete both NULL and the listed non-null rows in one go.
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

async function saveTierWeights(supabase, propertyUrl, payload) {
  if (!payload || typeof payload !== 'object') return { saved: 0 };
  const rows = [];
  for (const tierId of Object.keys(payload)) {
    const v = payload[tierId];
    if (!v) continue;
    rows.push({
      property_url: propertyUrl,
      tier_id: tierId,
      strategic_weight: clampWeight(v.strategic_weight),
      notes: v.notes || null
    });
  }
  if (!rows.length) return { saved: 0 };
  const { error } = await supabase
    .from('revenue_funnel_tier_weights')
    .upsert(rows, { onConflict: 'property_url,tier_id' });
  if (error) throw error;
  return { saved: rows.length };
}

async function saveLeverWeights(supabase, propertyUrl, payload) {
  if (!payload || typeof payload !== 'object') return { saved: 0 };
  const rows = [];
  for (const leverId of Object.keys(payload)) {
    if (!VALID_LEVER_IDS.has(leverId)) continue;
    const v = payload[leverId];
    if (!v) continue;
    const cap = v.effort_cap;
    rows.push({
      property_url: propertyUrl,
      lever_id: leverId,
      strategic_weight: clampWeight(v.strategic_weight),
      effort_cap: (cap && VALID_EFFORT_CAPS.has(cap)) ? cap : null,
      notes: v.notes || null
    });
  }
  if (!rows.length) return { saved: 0 };
  const { error } = await supabase
    .from('revenue_funnel_lever_weights')
    .upsert(rows, { onConflict: 'property_url,lever_id' });
  if (error) throw error;
  return { saved: rows.length };
}

// -------------------------------------------------------------------
// Handler
// -------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });

  const propertyUrl = String(
    (req.method === 'GET' ? req.query : parseBody(req)).propertyUrl ||
    (req.method === 'GET' ? req.query : parseBody(req)).property_url ||
    DEFAULT_PROPERTY
  ).trim();

  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    if (req.method === 'GET') {
      const cfg = await loadConfig(supabase, propertyUrl);
      return send(res, 200, {
        property_url: propertyUrl,
        loaded_at: new Date().toISOString(),
        ...cfg
      });
    }
    if (req.method === 'POST') {
      const body = parseBody(req);
      const tasks = [];
      if (body.targets) tasks.push(saveTargets(supabase, propertyUrl, body.targets));
      if (body.tier_weights) tasks.push(saveTierWeights(supabase, propertyUrl, body.tier_weights));
      if (body.lever_weights) tasks.push(saveLeverWeights(supabase, propertyUrl, body.lever_weights));
      const results = await Promise.all(tasks);
      const cfg = await loadConfig(supabase, propertyUrl);
      return send(res, 200, {
        property_url: propertyUrl,
        saved_at: new Date().toISOString(),
        saved_rows: results.reduce((a, r) => a + (r.saved || 0), 0),
        ...cfg
      });
    }
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    return send(res, 500, { error: 'config_error', detail: msg });
  }
}
