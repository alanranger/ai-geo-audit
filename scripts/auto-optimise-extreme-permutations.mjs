// auto-optimise-extreme-permutations.mjs
//
// Follow-on to auto-optimise-permutation-tests.mjs.
//
// Three jobs:
//   1. Probe whether the smart-priorities picker actually responds to
//      strategic weights at all. Earlier run showed Easy/Balanced/Hard
//      gave identical Top 3 because the absolute monthly lift of
//      ctr/academy (£275) dominates anything else in the candidate
//      pool no matter how the weights are set within 0.5-2.0 range.
//      We test with EXTREME weights (e.g. ctr=0.01, rank=5.0) to
//      confirm the picker reads the DB.
//
//   2. Create three additional named "stress test" scenarios with
//      extreme weight profiles so the dropdown carries enough variety
//      for the user to verify behaviour manually after the report.
//
//   3. Capture sensitivity findings to feed into the markdown report.

import { writeFile, appendFile } from 'fs/promises';

const BASE = process.env.AIGEO_BASE || 'https://ai-geo-audit.vercel.app';
const PROPERTY = 'https://www.alanranger.com';

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

function fmtGbp(n) { return '£' + Math.round(Number(n) || 0).toLocaleString('en-GB'); }

function wrapWeights(raw) {
  const out = {};
  for (const k of Object.keys(raw || {})) out[k] = { strategic_weight: Number(raw[k]) };
  return out;
}

async function createScenario(name, notes, tierWeights, leverWeights, surv) {
  const created = await getJson(`${BASE}/api/aigeo/revenue-funnel-scenarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create', propertyUrl: PROPERTY, name, notes,
      monthlySurvivalBaselineGbp: surv || 2500, hoursPerWeek: 0
    })
  });
  const scenarioId = created.scenario?.id;
  if (!scenarioId) throw new Error('No scenario id from create');
  await getJson(`${BASE}/api/aigeo/revenue-funnel-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scenarioId, propertyUrl: PROPERTY,
      tier_weights:  wrapWeights(tierWeights),
      lever_weights: wrapWeights(leverWeights)
    })
  });
  return { scenarioId, name };
}

async function activate(scenarioId) {
  const r = await fetch(`${BASE}/api/aigeo/revenue-funnel-scenarios`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenarioId, makeActive: true })
  });
  if (!r.ok) throw new Error('activate failed ' + r.status);
  return r.json();
}

async function probe() {
  await new Promise(r => setTimeout(r, 800));
  const sp = await getJson(`${BASE}/api/aigeo/revenue-funnel-smart-priorities?propertyUrl=${encodeURIComponent(PROPERTY)}`);
  return {
    active: sp.active_scenario,
    top3: (sp.candidates || []).slice(0, 3).map(c => ({
      title: c.title, lever: c.lever_id, tier: c.tier_id,
      lift: c.estimated_lift_gbp_profit,
      score: c.weighted_score,
      tw: c.applied_tier_weight, lw: c.applied_lever_weight
    })),
    count: (sp.candidates || []).length
  };
}

// Extreme stress profiles - design intent in each `notes` field.
// All include all 6 tiers + all 6 levers so the picker can't silently
// fall back to defaults.
const STRESS = [
  {
    name: 'STRESS: Rank-only zealot',
    notes: 'EXTREME profile. Lever weights: rank=5.0, all others=0.01. Designed to force rank candidates to top 3 regardless of absolute monthly lift. If picker still returns CTR top 3 the weighted_score formula is too dominated by absolute lift.',
    tier:  { academy: 1, courses: 1, workshops_nonres: 1, workshops_residential: 1, services: 1, hire: 1 },
    lever: { ctr: 0.01, schema: 0.01, aio: 0.01, rank: 5.0, surfacing: 0.01, conversion: 0.01 }
  },
  {
    name: 'STRESS: AIO-only zealot',
    notes: 'EXTREME profile. Lever weights: aio=5.0, all others=0.01. Forces AI Overview citation candidates to top.',
    tier:  { academy: 1, courses: 1, workshops_nonres: 1, workshops_residential: 1, services: 1, hire: 1 },
    lever: { ctr: 0.01, schema: 0.01, aio: 5.0, rank: 0.01, surfacing: 0.01, conversion: 0.01 }
  },
  {
    name: 'STRESS: Academy + Hire focus (high-GP tiers only)',
    notes: 'Tier emphasis test. Academy and Hire weighted 5.0 (very high-GP tiers), workshops/courses/services 0.05. Tests whether tier weights flow through.',
    tier:  { academy: 5.0, courses: 0.05, workshops_nonres: 0.05, workshops_residential: 0.05, services: 0.05, hire: 5.0 },
    lever: { ctr: 1, schema: 1, aio: 1, rank: 1, surfacing: 1, conversion: 1 }
  },
  {
    name: 'STRESS: Workshops survival mode',
    notes: 'Tier emphasis test inverse - workshops_residential + workshops_nonres at 5.0, all others 0.05. Tests "what if I had to dig myself out via workshops only?".',
    tier:  { academy: 0.05, courses: 0.05, workshops_nonres: 5.0, workshops_residential: 5.0, services: 0.05, hire: 0.05 },
    lever: { ctr: 1, schema: 1, aio: 1, rank: 1, surfacing: 1, conversion: 1 }
  },
  {
    name: 'STRESS: All zeros except CTR (do only quick wins)',
    notes: 'Survival-mode test. Only CTR enabled, everything else 0 - effectively the picker should return ONLY CTR candidates regardless of tier.',
    tier:  { academy: 1, courses: 1, workshops_nonres: 1, workshops_residential: 1, services: 1, hire: 1 },
    lever: { ctr: 1, schema: 0, aio: 0, rank: 0, surfacing: 0, conversion: 0 }
  },
  {
    name: 'STRESS: All zeros except Rank (compound-only)',
    notes: 'Inverse survival - only rank enabled. Verifies that filtering out a whole lever class returns an entirely different candidate list.',
    tier:  { academy: 1, courses: 1, workshops_nonres: 1, workshops_residential: 1, services: 1, hire: 1 },
    lever: { ctr: 0, schema: 0, aio: 0, rank: 1, surfacing: 0, conversion: 0 }
  }
];

async function main() {
  const results = [];
  console.log('Running', STRESS.length, 'extreme permutation probes...');
  for (const s of STRESS) {
    try {
      console.log('  creating:', s.name);
      const c = await createScenario(s.name, s.notes, s.tier, s.lever);
      await activate(c.scenarioId);
      const p = await probe();
      console.log('   active:', p.active?.scenario_name, '| top3:', p.top3.map(t => t.lever + '/' + t.tier + '£' + t.lift + '(s=' + Math.round((t.score || 0) * 10) / 10 + ')').join(' | '));
      results.push({ ...s, scenarioId: c.scenarioId, probe: p });
    } catch (err) {
      console.error('  FAIL', s.name, err.message);
      results.push({ ...s, error: err.message });
    }
  }

  // Append to the existing markdown report so the user has one place to read everything.
  const lines = ['', '## 5. Extreme weight stress probes', ''];
  lines.push('Each row creates a named scenario with deliberately extreme weight values, activates it, and reads back the picker\'s Top 3. The intent is to verify the picker reads weights from the DB and that the weighted_score formula is sensitive enough to re-rank candidates under realistic strategic preferences.');
  lines.push('');
  for (const r of results) {
    if (r.error) { lines.push('### ' + r.name); lines.push(''); lines.push('FAIL — ' + r.error); lines.push(''); continue; }
    lines.push('### ' + r.name);
    lines.push('');
    lines.push('> ' + r.notes);
    lines.push('');
    lines.push('Scenario ID: `' + r.scenarioId + '`');
    lines.push('');
    lines.push('Tier weights: ' + JSON.stringify(r.tier));
    lines.push('');
    lines.push('Lever weights: ' + JSON.stringify(r.lever));
    lines.push('');
    lines.push('Picker Top 3 (with active=' + (r.probe.active?.scenario_name || '?') + '):');
    lines.push('');
    lines.push('| # | Lever | Tier | Mo GP lift | Weighted score | Applied tier w | Applied lever w |');
    lines.push('|---|---|---|---:|---:|---:|---:|');
    r.probe.top3.forEach((t, i) => lines.push('| ' + (i + 1) + ' | ' + t.lever + ' | ' + t.tier + ' | ' + fmtGbp(t.lift) + ' | ' + (Math.round((t.score || 0) * 100) / 100) + ' | ' + t.tw + ' | ' + t.lw + ' |'));
    lines.push('');
  }

  // Pick the latest existing report file to append onto. If none exists, write fresh.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fname = `Docs/AUTO_OPTIMISE_STRESS_${stamp}.md`;
  await writeFile(fname, lines.join('\n'), 'utf8');
  console.log('Stress report written:', fname);
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
