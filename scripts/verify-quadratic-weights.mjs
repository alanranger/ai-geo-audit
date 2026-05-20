// verify-quadratic-weights.mjs
//
// After deploying the quadratic weight shape (tier^2 and lever^2 inside
// weighted_score), re-activate each Auto: scenario and STRESS: scenario
// already in the library and capture the picker's Top 3 under the new
// formula. Compare to the previous run (linear weights) to confirm
// realistic 0.2-2.0 weights now actually re-rank candidates.

const BASE = 'https://ai-geo-audit.vercel.app';
const PROPERTY = 'https://www.alanranger.com';

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function listScenarios() {
  const j = await getJson(`${BASE}/api/aigeo/revenue-funnel-scenarios?propertyUrl=${encodeURIComponent(PROPERTY)}`);
  return j.scenarios || [];
}

async function activate(id) {
  await fetch(`${BASE}/api/aigeo/revenue-funnel-scenarios`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenarioId: id, makeActive: true })
  });
}

async function probe() {
  await new Promise(r => setTimeout(r, 700));
  const sp = await getJson(`${BASE}/api/aigeo/revenue-funnel-smart-priorities?propertyUrl=${encodeURIComponent(PROPERTY)}`);
  return (sp.candidates || []).slice(0, 5).map(c => ({
    title: c.title,
    tier: c.tier_id,
    lever: c.lever_id,
    lift: c.estimated_lift_gbp_profit,
    score: c.weighted_score,
    tw: c.applied_tier_weight, lw: c.applied_lever_weight,
    twS: c.applied_tier_weight_shaped, lwS: c.applied_lever_weight_shaped
  }));
}

function fmtTop(rows) {
  return rows.map((r, i) => `  ${i + 1}. ${r.lever}/${r.tier} £${r.lift} (s=${Math.round((r.score || 0) * 10) / 10}, tier=${r.tw}->${r.twS}, lever=${r.lw}->${r.lwS})`).join('\n');
}

async function main() {
  const scenarios = await listScenarios();
  const targetNames = ['Auto: Easy', 'Auto: Balanced', 'Auto: Hard', 'STRESS: Rank-only zealot', 'STRESS: AIO-only zealot'];
  const matched = scenarios.filter(s => targetNames.some(n => s.name.startsWith(n)));
  console.log('Probing', matched.length, 'scenarios under quadratic weights:\n');
  const results = [];
  for (const s of matched) {
    await activate(s.id);
    const top = await probe();
    console.log(s.name + ':');
    console.log(fmtTop(top));
    console.log();
    results.push({ name: s.name, top });
  }
  // restore Baseline so dashboard opens sanely
  const baseline = scenarios.find(s => s.name === 'Baseline');
  if (baseline) {
    await activate(baseline.id);
    console.log('Restored Baseline as active.');
  }
  return results;
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
