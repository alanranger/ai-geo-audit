// Multi-scenario validation pass (2026-05-20 phase H+).
// Baseline + Auto presets + two custom weight permutations.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROD = 'https://ai-geo-audit.vercel.app';
const PROP = 'https://www.alanranger.com';
const OUT_DIR = path.join(__dirname, '..', 'Docs');

async function http(method, path_, body) {
  const url = PROD + path_;
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) init.body = JSON.stringify(body);
  const r = await fetch(url, init);
  const text = await r.text();
  try { return { status: r.status, json: JSON.parse(text) }; }
  catch (_) { return { status: r.status, text }; }
}

async function getSeasonality() {
  const r = await http('GET', '/api/aigeo/revenue-funnel-seasonality?propertyUrl=' + encodeURIComponent(PROP));
  return r.json || {};
}

async function getTopCandidates(validationScenario) {
  const qs = validationScenario
    ? '&validationScenario=' + encodeURIComponent(validationScenario)
    : '';
  const r = await http('GET', '/api/aigeo/revenue-funnel-smart-priorities?propertyUrl=' + encodeURIComponent(PROP) + qs);
  return (r.json && r.json.candidates) || [];
}

async function getAutoOptimise() {
  const r = await http('GET', '/api/aigeo/revenue-funnel-auto-optimise?propertyUrl=' + encodeURIComponent(PROP));
  return (r.json && r.json.presets) || [];
}

function topUrls(candidates, n) {
  return candidates.slice(0, n).map(c => (c.pages_affected || [])[0] || '(no url)');
}

function summariseCandidate(c) {
  const url = (c.pages_affected || [])[0] || '';
  const supp = c.suppression ? '[' + c.suppression.severity.toUpperCase() + ']' : '';
  const season = (c.seasonality_factor != null && c.seasonality_factor !== 1)
    ? '[seasonx' + Number(c.seasonality_factor).toFixed(2) + ']'
    : '';
  return `- ${c.tier_id}/${c.lever_id} - "${c.title}" - ${url} ${supp} ${season}`.trim();
}

function countSuppressed(candidates) {
  return candidates.filter(c => c.suppression && c.suppression.severity).length;
}

function countSeasonScaled(candidates) {
  return candidates.filter(c => c.seasonality_factor != null && Math.abs(c.seasonality_factor - 1) > 0.01).length;
}

function diffUrls(baselineUrls, scenarioUrls) {
  const set = new Set(baselineUrls);
  return scenarioUrls.filter(u => !set.has(u)).length;
}

function presetPairDiff(a, b) {
  const sa = new Set(a);
  return b.filter(u => !sa.has(u)).length;
}

async function run() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  console.log('Running multi-scenario validation at', ts);
  const seasonality = await getSeasonality();
  console.log('Current month:', seasonality.month_name, '·', (seasonality.monitoring || {}).urls_in_monitoring, 'URLs in monitoring');
  if (seasonality.seasonality_calibration) console.log(' ', seasonality.seasonality_calibration);

  const baseline = await getTopCandidates('');
  const baselineUrls = topUrls(baseline, 3);
  console.log('\nBASELINE top 3:');
  baseline.slice(0, 3).forEach(c => console.log(' ', summariseCandidate(c)));

  const customScenarios = [
    { key: 'workshops_peak', label: 'Custom: workshops-peak' },
    { key: 'services_opportunity', label: 'Custom: services-opportunity' }
  ];
  const customSummary = [];
  for (const sc of customScenarios) {
    const cands = await getTopCandidates(sc.key);
    const urls = topUrls(cands, 3);
    customSummary.push({
      preset: sc.key,
      name: sc.label,
      urls,
      diff_from_baseline: diffUrls(baselineUrls, urls),
      suppressed: countSuppressed(cands.slice(0, 8)),
      season_scaled: countSeasonScaled(cands.slice(0, 8))
    });
    console.log('\n' + sc.label + ' top 3:', urls.join(' | '), '| diff:', diffUrls(baselineUrls, urls));
  }

  const presets = await getAutoOptimise();
  const presetSummary = presets.map(p => {
    const urls = topUrls(p.top_candidates || [], 3);
    return {
      preset: p.preset_id,
      name: p.preset_name,
      urls,
      diff_from_baseline: diffUrls(baselineUrls, urls),
      suppressed: countSuppressed(p.top_candidates || []),
      season_scaled: countSeasonScaled(p.top_candidates || []),
      monthly_gp: (p.totals || {}).monthly_gp_lift_gbp,
      annual_gp: (p.totals || {}).annualised_gp_lift_gbp
    };
  });
  console.log('\nAUTO-OPTIMISE PRESETS:');
  for (const s of presetSummary) {
    console.log(' ', s.preset, '|', s.urls.join(' | '), '| diff:', s.diff_from_baseline);
  }

  const easy = presetSummary.find(s => s.preset === 'easy');
  const balanced = presetSummary.find(s => s.preset === 'balanced');
  const hard = presetSummary.find(s => s.preset === 'hard');
  const presetCrossDiff = (easy && balanced)
    ? presetPairDiff(easy.urls, balanced.urls) + presetPairDiff(balanced.urls, (hard || {}).urls || [])
    : 0;

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const lines = [];
  lines.push('# Multi-scenario validation report');
  lines.push('');
  lines.push('Generated: ' + new Date().toISOString());
  lines.push('Property: ' + PROP);
  lines.push('');
  lines.push('## Seasonality snapshot');
  lines.push('');
  lines.push('Current month: **' + seasonality.month_name + '**');
  lines.push('URLs in monitoring: **' + ((seasonality.monitoring || {}).urls_in_monitoring || 0) + '**');
  if (seasonality.seasonality_calibration) lines.push('');
  if (seasonality.seasonality_calibration) lines.push('_' + seasonality.seasonality_calibration + '_');
  lines.push('');
  lines.push('| Tier | Band | Factor |');
  lines.push('|---|---|---|');
  for (const b of (seasonality.tier_bands || [])) {
    lines.push('| ' + b.tier_id + ' | ' + b.label + ' | x' + b.factor.toFixed(2) + ' |');
  }
  lines.push('');
  lines.push('## Baseline top 3');
  lines.push('');
  for (const c of baseline.slice(0, 3)) lines.push(summariseCandidate(c));
  lines.push('');
  lines.push('Suppression flags in top 8: **' + countSuppressed(baseline) + '**');
  lines.push('Seasonality-scaled in top 8: **' + countSeasonScaled(baseline) + '**');
  lines.push('');
  lines.push('## Custom weight permutations');
  lines.push('');
  lines.push('| Scenario | Top 3 URLs | Diff from baseline | Suppressed | Season-scaled |');
  lines.push('|---|---|---|---|---|');
  for (const s of customSummary) {
    lines.push('| ' + s.preset + ' | ' + s.urls.join('<br>') + ' | ' + s.diff_from_baseline + ' | ' + s.suppressed + ' | ' + s.season_scaled + ' |');
  }
  lines.push('');
  lines.push('## Auto-Optimise presets');
  lines.push('');
  lines.push('| Preset | Top 3 URLs | Diff from baseline | Suppressed | Season-scaled | Mo GP | Yr GP |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const s of presetSummary) {
    lines.push('| ' + s.preset + ' | ' + s.urls.join('<br>') + ' | ' + s.diff_from_baseline + ' | ' + s.suppressed + ' | ' + s.season_scaled + ' | £' + s.monthly_gp + ' | £' + s.annual_gp + ' |');
  }
  lines.push('');
  lines.push('## Verdict');
  lines.push('');
  const allDifferentiate = presetSummary.every(s => s.diff_from_baseline >= 1);
  const customDifferentiate = customSummary.every(s => s.diff_from_baseline >= 1);
  const presetsDivergeEachOther = presetCrossDiff >= 2;
  const someSuppression = countSuppressed(baseline) > 0;
  const someSeason = countSeasonScaled(baseline) > 0;
  lines.push('- Auto preset vs baseline: ' + (allDifferentiate ? 'PASS' : 'FAIL'));
  lines.push('- Custom vs baseline: ' + (customDifferentiate ? 'PASS' : 'FAIL'));
  lines.push('- Easy/Balanced/Hard cross-divergence: ' + (presetsDivergeEachOther ? 'PASS' : 'FAIL'));
  lines.push('- Suppression layer firing: ' + (someSuppression ? 'PASS' : 'FAIL'));
  lines.push('- Seasonality layer firing: ' + (someSeason ? 'PASS' : 'FAIL'));
  const fname = 'MULTI_SCENARIO_VALIDATION_' + ts + '.md';
  fs.writeFileSync(path.join(OUT_DIR, fname), lines.join('\n'), 'utf8');
  console.log('\nReport written to Docs/' + fname);
}

run().catch(e => { console.error(e); process.exit(1); });
