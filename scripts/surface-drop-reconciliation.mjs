/**
 * Surface Visibility 40→36 + AI Summary 47→36 decomposition (stored data only).
 * Usage: node --env-file=.env.local scripts/surface-drop-reconciliation.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { computeSurfaceVisibilityRollup } from '../lib/audit/surfaceScores.js';
import { computeSurfaceOutcomesRollup } from '../lib/audit/surfaceOutcomes.js';
import { computeAiSummaryLikelihood, calculateSnippetReadiness } from '../lib/audit/pillarScores.js';
import { loadByKeywordFromCsv } from '../lib/keyword-ranking/locked-config-merge.js';
import { normalizeTrackingKey } from '../lib/keyword-ranking/locked-config-merge.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const propertyUrl = process.env.PROPERTY_URL || 'https://www.alanranger.com';

if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

function normKw(row) {
  return normalizeTrackingKey(row?.keyword || '');
}

async function fetchRowsForDate(auditDate) {
  const { data, error } = await sb
    .from('keyword_rankings')
    .select('*')
    .eq('property_url', propertyUrl)
    .eq('audit_date', auditDate);
  if (error) throw error;
  return data || [];
}

async function fetchAuditResult(auditDate) {
  const { data, error } = await sb
    .from('audit_results')
    .select('audit_date,surface_visibility_score,top_of_page_score,ai_summary_score,ai_summary,brand_score,ranking_ai_data')
    .eq('property_url', propertyUrl)
    .eq('audit_date', auditDate)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function listAuditDates() {
  const { data, error } = await sb
    .from('keyword_rankings')
    .select('audit_date')
    .eq('property_url', propertyUrl)
    .gte('audit_date', '2026-07-10')
    .order('audit_date', { ascending: true });
  if (error) throw error;
  return [...new Set((data || []).map((r) => String(r.audit_date).slice(0, 10)))];
}

function scoreSurface(rows) {
  return Math.round(Number(computeSurfaceVisibilityRollup(rows).overall) || 0);
}

function scoreCitationRate(rows) {
  const outcomes = computeSurfaceOutcomesRollup(rows);
  const aiRow = outcomes?.rows?.find((r) => r.key === 'ai_answer');
  return aiRow?.overall?.pct != null ? Math.round(Number(aiRow.overall.pct)) : 0;
}

function perKeywordScores(rows) {
  const rollup = computeSurfaceVisibilityRollup(rows);
  const map = new Map();
  for (const p of rollup.perKeyword || []) {
    map.set(normalizeTrackingKey(p.keyword), p.score);
  }
  return map;
}

function computeAiSummary(surface, citeRate, snippet, brand) {
  return computeAiSummaryLikelihood(snippet, surface, brand, citeRate);
}

function load121Set() {
  const v4 = loadByKeywordFromCsv(join(root, 'config', 'keyword-tracking-locations-and-class-LOCKED-v4.csv'));
  const keys151 = new Set(Object.keys(v4));
  const v3 = loadByKeywordFromCsv(join(root, 'config', 'keyword-tracking-locations-and-class-LOCKED-v3.csv'));
  const keys98 = new Set(Object.keys(v3));
  const newInV4 = [...keys151].filter((k) => !keys98.has(k));
  const old121 = [...keys151].filter((k) => !newInV4.slice(0, 30).includes(k) || keys98.has(k));
  return { keys151, keys98, newInV4, v4, v3 };
}

const dates = await listAuditDates();
console.log('keyword_rankings dates:', dates.join(', '));

const baselineDate = dates.find((d) => d >= '2026-07-13') || dates[0];
const latestDate = dates[dates.length - 1];
console.log('baseline:', baselineDate, 'latest:', latestDate);

const baselineRows = await fetchRowsForDate(baselineDate);
const latestRows = await fetchRowsForDate(latestDate);
const baselineAudit = await fetchAuditResult(baselineDate);
const latestAudit = await fetchAuditResult(latestDate);

const baselineKw = new Set(baselineRows.map(normKw));
const latestKw = new Set(latestRows.map(normKw));
const sharedKw = [...baselineKw].filter((k) => latestKw.has(k));
const onlyLatest = [...latestKw].filter((k) => !baselineKw.has(k));

const { keys151, keys98, newInV4 } = load121Set();
const old121Keys = [...keys151].slice(0, 121);
const old121Set = new Set(
  sharedKw.length >= 115
    ? sharedKw
    : [...keys151].filter((k) => !newInV4.includes(k) || keys98.has(k)).slice(0, 121)
);

if (sharedKw.length >= 100) {
  old121Set.clear();
  for (const k of sharedKw) old121Set.add(k);
}

const filterRows = (rows, keySet) => rows.filter((r) => keySet.has(normKw(r)));

const latestFiltered121 = filterRows(latestRows, old121Set);
const latestFull151 = latestRows;
const baselineFiltered121 = filterRows(baselineRows, old121Set);

const surfaceOn121Today = scoreSurface(latestFiltered121);
const surfaceOn151Today = scoreSurface(latestFull151);
const surfaceOn121Baseline = scoreSurface(baselineFiltered121);
const surfaceOn151Baseline = scoreSurface(baselineRows);

const cite121Today = scoreCitationRate(latestFiltered121);
const cite151Today = scoreCitationRate(latestFull151);
const cite121Baseline = scoreCitationRate(baselineFiltered121);
const cite151Baseline = scoreCitationRate(baselineRows);

const brandToday = latestAudit?.brand_score ?? 0;
const brandBaseline = baselineAudit?.brand_score ?? 0;
const snippetToday = latestAudit?.ai_summary?.snippetReadiness ?? 50;
const snippetBaseline = baselineAudit?.ai_summary?.snippetReadiness ?? 50;

const ai121Today = computeAiSummary(surfaceOn121Today, cite121Today, snippetToday, brandToday);
const ai151Today = computeAiSummary(surfaceOn151Today, cite151Today, snippetToday, brandToday);
const ai121Baseline = computeAiSummary(surfaceOn121Baseline, cite121Baseline, snippetBaseline, brandBaseline);
const ai151Baseline = computeAiSummary(surfaceOn151Baseline, cite151Baseline, snippetBaseline, brandBaseline);

const oldContrib = perKeywordScores(baselineFiltered121);
const newContrib = perKeywordScores(latestFiltered121);
const movers = [];
for (const k of old121Set) {
  const old = oldContrib.get(k) ?? null;
  const neu = newContrib.get(k) ?? null;
  if (old == null && neu == null) continue;
  const delta = (neu ?? 0) - (old ?? 0);
  const row = latestFiltered121.find((r) => normKw(r) === k) || baselineFiltered121.find((r) => normKw(r) === k);
  movers.push({ keyword: row?.keyword || k, old, new: neu, delta: Math.abs(delta), signedDelta: delta });
}
movers.sort((a, b) => b.delta - a.delta);
const top10 = movers.slice(0, 10);

const storedBaselineSurface = baselineAudit?.surface_visibility_score;
const storedLatestSurface = latestAudit?.surface_visibility_score;
const storedBaselineAi = baselineAudit?.ai_summary_score ?? baselineAudit?.ai_summary?.score;
const storedLatestAi = latestAudit?.ai_summary_score ?? latestAudit?.ai_summary?.score;

const report = {
  generated_at: new Date().toISOString(),
  property_url: propertyUrl,
  dates: { baseline: baselineDate, latest: latestDate, all: dates },
  keyword_sets: {
    baseline_row_count: baselineRows.length,
    latest_row_count: latestRows.length,
    shared_keywords: sharedKw.length,
    new_in_latest_only: onlyLatest.length,
    old121_definition: `Keywords present on both dates (${old121Set.size} keywords) — proxy for pre-expansion tracked set`,
    v4_csv_total: keys151.size,
    v3_csv_total: keys98.size,
    new_in_v4_csv: newInV4.length,
  },
  stored_audit_results: {
    baseline: {
      date: baselineDate,
      surface_visibility_score: storedBaselineSurface,
      ai_summary_score: storedBaselineAi,
      ai_summary_components: baselineAudit?.ai_summary,
    },
    latest: {
      date: latestDate,
      surface_visibility_score: storedLatestSurface,
      ai_summary_score: storedLatestAi,
      ai_summary_components: latestAudit?.ai_summary,
    },
  },
  surface_visibility_decomposition: {
    formula_changed: 'No — computeKeywordSurfaceScore / demandWeightedMean unchanged since 2026-07-13 baseline. Citation-rate input to AI Summary changed (stack.ours vs citation count) on 2026-07-17; does not alter Surface dial formula.',
    baseline_date_full_set: surfaceOn151Baseline,
    latest_recomputed: {
      on_old121_with_today_data: surfaceOn121Today,
      on_full151_today: surfaceOn151Today,
      delta_keyword_expansion: surfaceOn151Today - surfaceOn121Today,
      on_old121_baseline_data: surfaceOn121Baseline,
      genuine_movement_on_original_keywords: surfaceOn121Today - surfaceOn121Baseline,
    },
    stored_vs_recomputed: {
      baseline_stored: storedBaselineSurface,
      latest_stored: storedLatestSurface,
      latest_recomputed_151: surfaceOn151Today,
    },
  },
  ai_summary_decomposition: {
    formula: '0.35×cite + 0.25×surface + 0.25×snippet + 0.15×brand (signed 2026-07-16)',
    citation_derivation_changed: 'Yes — 2026-07-17: AI citation rate now won-of-served via serp_surface_stack.ours (was citation-count based; often showed ~28). Surface formula unchanged.',
    baseline_full: ai151Baseline,
    latest: {
      on_old121_today: ai121Today,
      on_full151_today: ai151Today,
      stored: storedLatestAi,
    },
    components_today_151: {
      aiCitationRate: cite151Today,
      surfaceVisibility: surfaceOn151Today,
      snippetReadiness: snippetToday,
      brand: brandToday,
      score: ai151Today.score,
    },
    components_baseline: {
      aiCitationRate: cite151Baseline,
      surfaceVisibility: surfaceOn151Baseline,
      snippetReadiness: snippetBaseline,
      brand: brandBaseline,
      score: ai151Baseline.score,
    },
    citation_rate_isolation: {
      baseline_cite_on_baseline_rows: cite151Baseline,
      today_cite_on_151: cite151Today,
      today_cite_on_121_only: cite121Today,
    },
  },
  top10_keyword_movers_original_set: top10.map(({ keyword, old, new: neu, signedDelta }) => ({
    keyword, old_contribution: old, new_contribution: neu, delta: signedDelta,
  })),
};

const outPath = join(root, 'scripts/output/surface-drop-reconciliation-LATEST.json');
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log('\nWrote', outPath);
