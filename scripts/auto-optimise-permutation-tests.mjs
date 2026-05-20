// auto-optimise-permutation-tests.mjs
//
// Headless / scripted exercise of the Scenario Planning system:
//   1. Hits /api/aigeo/revenue-funnel-auto-optimise to get the canonical
//      Easy / Balanced / Hard preset projections.
//   2. Creates three real named scenarios in Supabase via the
//      scenarios + config APIs (so they appear in the dropdown).
//   3. Runs N tier+lever permutations through smart-priorities to
//      record sensitivity (which weights move the Top 3 picks the
//      most, which barely change the outcome).
//   4. Writes a markdown report the user can read.
//
// Designed to be runnable with `node scripts/auto-optimise-permutation-tests.mjs`
// from a workstation with no env (everything goes to production endpoints).

import { writeFile } from 'fs/promises';

const BASE = process.env.AIGEO_BASE || 'https://ai-geo-audit.vercel.app';
const PROPERTY = 'https://www.alanranger.com';

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function fmtGbp(n) { return '£' + Math.round(Number(n) || 0).toLocaleString('en-GB'); }
function pct(n)    { return (n == null) ? '—' : (n >= 0 ? '+' : '') + n + '%'; }

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`${r.status} ${url} - ${t.slice(0, 200)}`);
  }
  return r.json();
}

// ---- 1. Fetch the three Auto-Optimise preset projections ----------
async function fetchAutoOptimise() {
  const url = `${BASE}/api/aigeo/revenue-funnel-auto-optimise?propertyUrl=${encodeURIComponent(PROPERTY)}`;
  console.log('[1] GET', url);
  return getJson(url);
}

// ---- 2. Create + populate a named scenario -----------------------
async function createScenarioWithWeights(name, notes, tierWeights, leverWeights) {
  const createBody = {
    action: 'create',
    propertyUrl: PROPERTY,
    name,
    notes,
    monthlySurvivalBaselineGbp: 2500,
    hoursPerWeek: 0
  };
  const created = await getJson(`${BASE}/api/aigeo/revenue-funnel-scenarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createBody)
  });
  const scenarioId = created.scenario?.id;
  if (!scenarioId) throw new Error('No scenario id from create: ' + JSON.stringify(created));
  console.log('  created:', name, '->', scenarioId);

  const wrapWeights = (raw) => {
    const out = {};
    for (const k of Object.keys(raw || {})) out[k] = { strategic_weight: Number(raw[k]) };
    return out;
  };
  const cfgBody = {
    scenarioId,
    propertyUrl: PROPERTY,
    tier_weights:  wrapWeights(tierWeights),
    lever_weights: wrapWeights(leverWeights)
  };
  const cfg = await getJson(`${BASE}/api/aigeo/revenue-funnel-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfgBody)
  });
  console.log('  weights pushed: tier_rows', cfg.tier_weights?.saved, 'lever_rows', cfg.lever_weights?.saved);
  return { scenarioId, name };
}

// Three canonical preset scenarios that mirror the Auto-Optimise card
// weight sets. These appear in the scenario library dropdown and the
// user can activate any of them from the Scenario Planning tab.
const NAMED_SCENARIOS = [
  {
    name: 'Auto: Easy path (quick wins)',
    notes: 'Auto-generated Easy preset. Heavy CTR + schema lever weighting, light rank/AIO. Best £/hr but assumes 6-month decay on CTR wins.',
    tierWeights:  { academy: 1, courses: 1, workshops_nonres: 1, workshops_residential: 1, services: 1, hire: 1 },
    leverWeights: { ctr: 2.0, schema: 1.5, aio: 0.5, rank: 0.2, surfacing: 0.5, conversion: 1.0 }
  },
  {
    name: 'Auto: Balanced path (most £ this month)',
    notes: 'Auto-generated Balanced preset. All levers eligible, picker sorts by absolute monthly GP. Best for moderate (12h) commit.',
    tierWeights:  { academy: 1, courses: 1, workshops_nonres: 1, workshops_residential: 1, services: 1, hire: 1 },
    leverWeights: { ctr: 1.2, schema: 1.0, aio: 1.5, rank: 1.0, surfacing: 1.0, conversion: 1.2 }
  },
  {
    name: 'Auto: Hard path (full-commit compound)',
    notes: 'Auto-generated Hard preset. All levers eligible at 24h budget. Compound bets dominate annualised due to per-lever persistence.',
    tierWeights:  { academy: 1, courses: 1, workshops_nonres: 1, workshops_residential: 1, services: 1, hire: 1 },
    leverWeights: { ctr: 1.0, schema: 1.0, aio: 1.5, rank: 1.5, surfacing: 1.2, conversion: 1.0 }
  }
];

async function createAllNamedScenarios() {
  console.log('[2] Creating named scenarios:');
  const out = [];
  for (const s of NAMED_SCENARIOS) {
    try {
      out.push(await createScenarioWithWeights(s.name, s.notes, s.tierWeights, s.leverWeights));
    } catch (err) {
      console.error('  FAILED', s.name, ':', err.message);
      out.push({ name: s.name, error: err.message });
    }
  }
  return out;
}

// ---- 3. Permutation matrix ---------------------------------------
//
// We need the picker's view of each permutation but the auto-optimise
// endpoint only runs the three presets. To probe sensitivity we hit
// smart-priorities directly with override weights and capture the
// Top 5 + totals it returns.
//
// smart-priorities reads the ACTIVE scenario's weights from DB. To
// pass override weights without persisting them we'd need a query
// param. Since smart-priorities doesn't have that, we instead just
// observe the response under each new named scenario we ACTIVATE in
// turn - this also doubles as the activation test for phase 4.

async function activateScenario(scenarioId) {
  const r = await fetch(`${BASE}/api/aigeo/revenue-funnel-scenarios`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenarioId, makeActive: true })
  });
  if (!r.ok) throw new Error(`activate HTTP ${r.status}`);
  return r.json();
}

async function fetchSmartPriorities() {
  return getJson(`${BASE}/api/aigeo/revenue-funnel-smart-priorities?propertyUrl=${encodeURIComponent(PROPERTY)}`);
}

function summariseSmartResponse(r) {
  const top3 = (r.candidates || []).slice(0, 3).map(c => ({
    title: c.title,
    tier:  c.tier_id,
    lever: c.lever_id,
    gpLift: c.estimated_lift_gbp_profit,
    weightedScore: c.weighted_score,
    appliedTierW: c.applied_tier_weight,
    appliedLeverW: c.applied_lever_weight
  }));
  return {
    scenario: r.active_scenario || null,
    candidate_count: (r.candidates || []).length,
    top3
  };
}

async function probeActivatedScenarios(created) {
  console.log('[3] Activating each scenario and probing smart-priorities:');
  const out = [];
  for (const s of created) {
    if (!s.scenarioId) continue;
    try {
      await activateScenario(s.scenarioId);
      // small grace period before the picker reads DB
      await new Promise(r => setTimeout(r, 800));
      const sp = await fetchSmartPriorities();
      out.push({ name: s.name, scenarioId: s.scenarioId, summary: summariseSmartResponse(sp) });
      console.log('  ', s.name, ':', out[out.length - 1].summary.top3.map(c => c.lever + '/' + c.tier + '£' + c.gpLift).join(' | '));
    } catch (err) {
      console.error('  FAIL probing', s.name, err.message);
      out.push({ name: s.name, scenarioId: s.scenarioId, error: err.message });
    }
  }
  return out;
}

// ---- 4. Markdown report ------------------------------------------
function reportMarkdown(autoResp, createdList, probeList) {
  const lines = [];
  lines.push('# Auto-Optimise self-test run');
  lines.push('');
  lines.push('Stamp: ' + new Date().toISOString());
  lines.push('Property: ' + PROPERTY);
  lines.push('');
  lines.push('## 1. Do-Nothing baseline (current YTD pace)');
  const b = autoResp.do_nothing_baseline || {};
  lines.push('');
  lines.push('| Metric | Monthly | Annualised |');
  lines.push('|---|---:|---:|');
  lines.push('| Revenue | ' + fmtGbp(b.monthly_revenue_gbp) + ' | ' + fmtGbp(b.annualised_revenue_gbp) + ' |');
  lines.push('| Gross Profit | ' + fmtGbp(b.monthly_gp_gbp) + ' | ' + fmtGbp(b.annualised_gp_gbp) + ' |');
  lines.push('| YTD so far | ' + fmtGbp(b.ytd_revenue_gbp) + ' rev / ' + fmtGbp(b.ytd_gp_gbp) + ' gp | — |');
  lines.push('');
  lines.push('## 2. Three preset scenarios (Easy / Balanced / Hard)');
  for (const p of autoResp.presets || []) {
    const t = p.totals || {};
    const v = p.vs_do_nothing || {};
    lines.push('');
    lines.push('### ' + p.preset_name);
    lines.push('');
    lines.push('> ' + p.preset_description);
    lines.push('');
    lines.push('- Budget: ' + p.budget_hours + 'h committed = ' + t.effort_hours + 'h actually used');
    lines.push('- Blended persistence: ' + t.blended_persistence_months + ' months');
    lines.push('- Monthly lift: +' + fmtGbp(t.monthly_revenue_lift_gbp) + ' rev / +' + fmtGbp(t.monthly_gp_lift_gbp) + ' GP');
    lines.push('- Annualised lift: +' + fmtGbp(t.annualised_revenue_lift_gbp) + ' rev / +' + fmtGbp(t.annualised_gp_lift_gbp) + ' GP');
    lines.push('- £/hour annualised: ' + fmtGbp(t.lift_per_hour_gbp_annualised));
    lines.push('- Δ vs do-nothing (annual GP): ' + pct(v.annualised_gp_delta_pct));
    lines.push('');
    lines.push('**By segment (ranked by annualised GP):**');
    lines.push('');
    lines.push('| Segment | Actions | Mo Rev | Mo GP | Yr Rev | Yr GP |');
    lines.push('|---|---:|---:|---:|---:|---:|');
    for (const r of p.by_tier || []) {
      lines.push('| ' + r.tier_id
        + ' | ' + r.count
        + ' | ' + fmtGbp(r.monthly_revenue_gbp)
        + ' | ' + fmtGbp(r.monthly_gp_gbp)
        + ' | ' + fmtGbp(r.annualised_revenue_gbp)
        + ' | ' + fmtGbp(r.annualised_gp_gbp) + ' |');
    }
    lines.push('');
    lines.push('**Top 5 actions:**');
    lines.push('');
    for (const c of p.top_candidates || []) {
      lines.push('1. **' + c.title + '** (' + c.tier_id + ', ' + c.effort_hours + 'h, ' + c.time_to_realise_days + 'd) — +' + fmtGbp(c.estimated_lift_gbp_profit) + '/mo GP');
      lines.push('   - What to do: ' + (c.effort_label || '—'));
      if (c.description) lines.push('   - Evidence: ' + c.description.replace(/\s+/g, ' ').slice(0, 280) + (c.description.length > 280 ? '...' : ''));
    }
  }

  lines.push('');
  lines.push('## 3. Scenario library writes');
  lines.push('');
  for (const c of createdList) {
    lines.push('- ' + (c.scenarioId ? 'OK' : 'FAIL') + ' — `' + c.name + '`' + (c.scenarioId ? ' (id: `' + c.scenarioId + '`)' : ' — ' + c.error));
  }

  lines.push('');
  lines.push('## 4. Permutation probes (smart-priorities response with each activated)');
  lines.push('');
  for (const p of probeList) {
    if (p.error) {
      lines.push('- FAIL `' + p.name + '` — ' + p.error);
      continue;
    }
    lines.push('### ' + p.name);
    lines.push('');
    lines.push('Active scenario: ' + (p.summary.scenario?.scenario_name || '?') + ' (id: ' + (p.summary.scenario?.scenario_id || '?') + ')');
    lines.push('');
    lines.push('Top 3 from picker:');
    lines.push('');
    for (const t of p.summary.top3) {
      lines.push('1. **' + t.title + '** — ' + t.lever + '/' + t.tier
        + ' • +' + fmtGbp(t.gpLift) + '/mo GP'
        + ' • weighted_score=' + (t.weightedScore != null ? Math.round(t.weightedScore * 100) / 100 : '—')
        + ' • applied weights tier=' + t.appliedTierW + ' lever=' + t.appliedLeverW);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const auto = await fetchAutoOptimise();
  const created = await createAllNamedScenarios();
  const probes  = await probeActivatedScenarios(created);
  const md = reportMarkdown(auto, created, probes);
  const fname = `Docs/AUTO_OPTIMISE_TEST_${nowStamp()}.md`;
  await writeFile(fname, md, 'utf8');
  console.log('\nReport written:', fname);
  console.log('Summary: created=' + created.filter(c => c.scenarioId).length + '/' + created.length
    + '  probed=' + probes.filter(p => !p.error).length + '/' + probes.length);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
