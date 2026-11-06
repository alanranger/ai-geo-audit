/**
 * GET  /api/aigeo/targets-master?propertyUrl=  — the one target set + GP method (Targets panel; every tab reads it)
 * POST /api/aigeo/targets-master               — Targets panel save (x-arp-admin-key). Writes one business_targets
 *      row dated today (a new row keeps earlier targets as history; a second save the same day updates it).
 */
import { createClient } from '@supabase/supabase-js';
import { loadTargetsMaster } from '../../lib/targets-master.mjs';
import { requireAdminKeyOnly } from '../../lib/api/requireAdminKeyOnly.js';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';
const MONEY_KEYS = ['survival', 'stretch1', 'stretch2'];

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
};

function client() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

/** Only the panel's own fields, validated: GP a month must be a positive £ figure, stretch above survival. */
export function targetsPatch(body) {
  const patch = {};
  for (const k of MONEY_KEYS) {
    const v = body?.[`${k}_gp_monthly`];
    if (v == null) continue;
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${k}_gp_monthly must be a positive £ figure`);
    patch[`${k}_gp_monthly`] = n;
    patch[`${k}_gp_annual`] = n * 12;
  }
  if (body?.funnel_targets && typeof body.funnel_targets === 'object') patch.funnel_targets = body.funnel_targets;
  if (Array.isArray(body?.roadmap_targets)) patch.roadmap_targets = body.roadmap_targets;
  return patch;
}

async function saveTargets(supabase, propertyUrl, patch) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: latest, error } = await supabase.from('business_targets').select('*').eq('property_url', propertyUrl)
    .order('effective_from', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  const merged = { ...(latest || {}), ...patch };
  if ((merged.stretch1_gp_monthly || 0) <= (merged.survival_gp_monthly || 0)) throw new Error('stretch £4,000 target must be above survival');
  if (latest && String(latest.effective_from) === today) {
    const { error: e2 } = await supabase.from('business_targets').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', latest.id);
    if (e2) throw new Error(e2.message);
    return 'updated';
  }
  const { id, created_at, updated_at, ...rest } = merged;
  const { error: e3 } = await supabase.from('business_targets').insert({ ...rest, property_url: propertyUrl, effective_from: today, notes: 'Saved from the Targets panel (Strategy & Actions)' });
  if (e3) throw new Error(e3.message);
  return 'inserted';
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const supabase = client();
  const propertyUrl = String(req.query?.propertyUrl || req.body?.propertyUrl || DEFAULT_PROPERTY);
  try {
    if (req.method === 'GET') return send(res, 200, { ok: true, ...(await loadTargetsMaster(supabase, propertyUrl)) });
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
    if (!requireAdminKeyOnly(req, res, send)) return undefined;
    const saved = await saveTargets(supabase, propertyUrl, targetsPatch(req.body || {}));
    return send(res, 200, { ok: true, saved, ...(await loadTargetsMaster(supabase, propertyUrl)) });
  } catch (err) {
    return send(res, 400, { ok: false, error: err?.message || String(err) });
  }
}
