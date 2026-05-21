// Returns the current-month per-tier seasonality band so the dashboard
// can show a banner like "May 2026 - PEAK for workshops, GAP for
// courses winding down, opportunity to push 1-2-1's". Also returns the
// active monitoring tasks so the same banner can warn the user about
// how many URLs already have work in flight before they go and
// recommend another tweak.

import { createClient } from '@supabase/supabase-js';
import { __INTERNAL as SP } from './revenue-funnel-smart-priorities.js';
import { loadBlendedSeasonality } from '../../lib/revenue-funnel-seasonality-blend.js';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';

function need(key) {
  const v = process.env[key];
  if (!v) throw new Error('missing env ' + key);
  return v;
}

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).end(JSON.stringify(body));
}

function buildTierBands(monthIdx) {
  const bands = [];
  for (const tier of Object.keys(SP.SEASONALITY_BY_TIER)) {
    bands.push({
      tier_id: tier,
      factor: SP.seasonalityFor(tier, monthIdx),
      band: SP.seasonalityBandFor(tier, monthIdx),
      label: SP.seasonalityLabel(SP.seasonalityBandFor(tier, monthIdx))
    });
  }
  return bands.sort((a, b) => b.factor - a.factor);
}

function summariseMonitoring(suppressionMap) {
  const byKpi = {};
  let totalUrls = 0;
  for (const entries of suppressionMap.values()) {
    totalUrls += 1;
    for (const e of entries) {
      const k = e.primary_kpi || 'unknown';
      byKpi[k] = (byKpi[k] || 0) + 1;
    }
  }
  return { urls_in_monitoring: totalUrls, by_kpi: byKpi };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  try {
    const propertyUrl = String(req.query?.propertyUrl || DEFAULT_PROPERTY).trim();
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const [cycles, blended] = await Promise.all([
      SP.fetchActiveOptimisationCycles(supabase),
      loadBlendedSeasonality(supabase, propertyUrl)
    ]);
    if (SP.setBlendedSeasonality) SP.setBlendedSeasonality(blended);
    const suppressionMap = SP.buildSuppressionMap(cycles);
    const monthIdx = SP.currentMonthIndex();
    return send(res, 200, {
      property_url: propertyUrl,
      generated_at: new Date().toISOString(),
      month_index: monthIdx,
      month_name: SP.MONTH_NAMES[monthIdx],
      tier_bands: buildTierBands(monthIdx),
      monitoring: summariseMonitoring(suppressionMap),
      seasonality_calibration: blended.calibration_note
    });
  } catch (e) {
    return send(res, 500, { error: 'server_error', detail: String(e && e.message || e) });
  }
}
