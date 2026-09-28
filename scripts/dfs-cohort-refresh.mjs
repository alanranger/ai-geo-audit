/**
 * Bounded production SERP-only cohort refresh for legacy/empty keyword_rankings.
 * Preserves the 3 already-verified complete_ranked rows. No AI Mode spend.
 *
 * Caps: ≤155 keywords, ≤3 attempts/kw (server-side), hard DFS cost ≤ $5.
 */
import { config as dotenvConfig } from 'dotenv';
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildCombinedRows, buildKeywordRows } from '../lib/keyword-ranking/refresh-core.js';
import {
  resolveCaptureQualityKind,
  summarizeSerpCaptureCoverage,
  CAPTURE_STATUS,
  CAPTURE_LEGACY_UNVERIFIED,
} from '../lib/keyword-ranking/dfs-serp-quality.js';
import { computeSurfaceVisibilityRollup } from '../lib/audit/surfaceScores.js';
import { computeTopOfPageRollup } from '../lib/audit/topOfPage.js';

dotenvConfig({ path: '.env.local' });

const OUT = 'C:/Users/alan/Documents/Codex/2026-09-28/when/outputs';
const API_BASE = process.env.AIGEO_API_BASE || 'https://ai-geo-audit.vercel.app';
const PROPERTY = 'https://www.alanranger.com';
const AUDIT_DATE = new Date().toISOString().slice(0, 10);
const BATCH_SIZE = 10;
const COST_CAP_USD = 5.0;
/** Conservative per-attempt estimate before send (full depth-50 ≈ $0.008). */
const EST_COST_PER_ATTEMPT = 0.008;
const MAX_ATTEMPTS_PER_KW = 3; // server serp-rank-test already retries incomplete

const PRESERVE_VERIFIED = new Set([
  'beginners photography courses coventry',
  'free photography classes near me',
  'photography gift card',
].map((k) => k.toLowerCase()));

mkdirSync(OUT, { recursive: true });

function coverageCounts(rows) {
  const cov = summarizeSerpCaptureCoverage(rows);
  const by = {
    complete_ranked: 0,
    complete_no_match: 0,
    incomplete: 0,
    empty: 0,
    error: 0,
    legacy_unverified: 0,
  };
  for (const r of rows || []) {
    const k = resolveCaptureQualityKind(r);
    if (by[k] != null) by[k] += 1;
    else by.legacy_unverified += 1;
  }
  return { ...cov, by_status: by };
}

function scoresFromRows(rows) {
  const s = computeSurfaceVisibilityRollup(rows);
  const t = computeTopOfPageRollup(rows);
  return {
    surface: Math.round(Number(s.overall) || 0),
    top: Math.round(Number(t.overall) || 0),
    surface_coverage: s.coverage,
    top_coverage: t.coverage,
    provisional: !!(s.provisional || t.provisional),
  };
}

async function fetchAllKeywordRows() {
  const url = `${API_BASE}/api/supabase/get-keyword-rankings?propertyUrl=${encodeURIComponent(PROPERTY)}&auditDate=${AUDIT_DATE}`;
  const res = await fetch(url, { cache: 'no-store' });
  const json = await res.json();
  if (!res.ok || json?.status === 'error') {
    throw new Error(`get-keyword-rankings failed: ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json?.data?.keywords || [];
}

function mergePreserveNonSerp(prev, nextRow) {
  const out = { ...nextRow };
  const engines = { ...(out.ai_engines && typeof out.ai_engines === 'object' ? out.ai_engines : {}) };
  const prevMode = prev?.ai_engines?.google_ai_mode;
  if (prevMode && typeof prevMode === 'object') {
    engines.google_ai_mode = prevMode;
  }
  out.ai_engines = Object.keys(engines).length ? engines : (prev?.ai_engines || null);
  if ((out.search_volume == null || out.search_volume === 0) && prev?.search_volume != null) {
    out.search_volume = prev.search_volume;
  }
  // Preserve local_grid (parked product) — SERP refresh does not rewrite it.
  if (out.local_grid == null && prev?.local_grid != null) out.local_grid = prev.local_grid;
  return out;
}

async function serpBatch(keywords) {
  const res = await fetch(`${API_BASE}/api/aigeo/serp-rank-test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keywords,
      depth: 50,
      // Explicit: classic SERP only — no expand_ai_overview / no AI Mode
      ai_overview: false,
    }),
  });
  const json = await res.json().catch(() => ({}));
  return { http: res.status, json };
}

async function saveBatch(keywordRows) {
  const res = await fetch(`${API_BASE}/api/supabase/save-keyword-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywordRows, auditDate: AUDIT_DATE, propertyUrl: PROPERTY }),
  });
  const json = await res.json().catch(() => ({}));
  return { http: res.status, json };
}

async function saveSummaryScores(surface, top, coverage) {
  const res = await fetch(`${API_BASE}/api/supabase/save-ranking-ai-summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      propertyUrl: PROPERTY,
      auditDate: AUDIT_DATE,
      surfaceVisibilityScore: surface,
      topOfPageScore: top,
      rankingAiPillarScores: {
        schema_version: 3,
        surfaceVisibility: { overall: surface, coverage, provisional: coverage?.provisional },
        topOfPage: { overall: top, coverage, provisional: coverage?.provisional },
        capture_coverage: coverage,
        source: 'dfs-cohort-refresh',
        refreshed_at: new Date().toISOString(),
      },
    }),
  });
  const json = await res.json().catch(() => ({}));
  return { http: res.status, json };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const t0 = Date.now();
  const beforeRows = await fetchAllKeywordRows();
  if (!beforeRows.length) throw new Error('No keyword_rankings rows for today');

  const beforeCoverage = coverageCounts(beforeRows);
  const beforeScores = scoresFromRows(beforeRows);

  writeFileSync(`${OUT}/dfs-cohort-refresh-backup-before.json`, JSON.stringify({
    backed_up_at: new Date().toISOString(),
    auditDate: AUDIT_DATE,
    propertyUrl: PROPERTY,
    row_count: beforeRows.length,
    coverage: beforeCoverage,
    scores: beforeScores,
    rows: beforeRows,
  }));

  const prevByKw = new Map(
    beforeRows.map((r) => [String(r.keyword || '').trim().toLowerCase(), r])
  );

  const toRefresh = beforeRows
    .map((r) => String(r.keyword || '').trim())
    .filter((kw) => kw && !PRESERVE_VERIFIED.has(kw.toLowerCase()));

  // Consistency: if somehow < 152, also include any missing tracked empties already in beforeRows only.
  const uniqueRefresh = [...new Set(toRefresh)];
  if (uniqueRefresh.length > 155) {
    throw new Error(`Refresh cohort ${uniqueRefresh.length} exceeds hard max 155`);
  }

  const plan = {
    tracked: beforeRows.length,
    preserve_verified: [...PRESERVE_VERIFIED],
    refresh_count: uniqueRefresh.length,
    est_min_usd: +(uniqueRefresh.length * EST_COST_PER_ATTEMPT).toFixed(4),
    est_max_usd_with_retries: +(uniqueRefresh.length * EST_COST_PER_ATTEMPT * MAX_ATTEMPTS_PER_KW).toFixed(4),
    cost_cap_usd: COST_CAP_USD,
    batch_size: BATCH_SIZE,
    note: 'Server serp-rank-test retries incomplete up to 3 attempts/kw; expand_ai_overview=false',
  };
  if (plan.est_min_usd > COST_CAP_USD) {
    throw new Error(`Abort: estimated min cost $${plan.est_min_usd} exceeds cap $${COST_CAP_USD}`);
  }
  writeFileSync(`${OUT}/dfs-cohort-refresh-plan.json`, JSON.stringify(plan, null, 2));

  let actualCost = 0;
  let requests = 0;
  const batchLog = [];
  const refreshedKeywords = [];
  let stoppedReason = null;

  for (let i = 0; i < uniqueRefresh.length; i += BATCH_SIZE) {
    const batch = uniqueRefresh.slice(i, i + BATCH_SIZE);
    const remaining = uniqueRefresh.length - i;
    // Before send: require headroom for this batch first-attempt estimate
    const estBatch = batch.length * EST_COST_PER_ATTEMPT;
    if (actualCost + estBatch > COST_CAP_USD) {
      stoppedReason = `cost_cap_preflight: actual $${actualCost.toFixed(4)} + est batch $${estBatch.toFixed(4)} > $${COST_CAP_USD}`;
      break;
    }
    // Also block if remaining worst-case overshoot from here would blow past hard cap
    // (we still send this batch if first-attempt fits).
    console.log(`[cohort] batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} kws, spent $${actualCost.toFixed(4)}, remaining ${remaining}`);

    const { http, json } = await serpBatch(batch);
    requests += 1;
    const per = Array.isArray(json?.per_keyword) ? json.per_keyword : [];
    const batchCost = per.reduce((s, r) => {
      const c = Number(r.dfs_cost);
      if (Number.isFinite(c) && c > 0) return s + c;
      // Missing cost: charge estimate (retries already billed by DFS; final row may omit prior attempts)
      return s + EST_COST_PER_ATTEMPT;
    }, 0);
    actualCost += batchCost;

    batchLog.push({
      batch_index: Math.floor(i / BATCH_SIZE) + 1,
      keywords: batch,
      http,
      dfs_fatal: json?.summary?.dfs_fatal || false,
      per_count: per.length,
      batch_cost_usd: +batchCost.toFixed(6),
      cumulative_cost_usd: +actualCost.toFixed(6),
      statuses: per.map((r) => ({
        keyword: r.keyword,
        capture_status: r.serp_features?.capture_status || resolveCaptureQualityKind(r),
        dfs_cost: r.dfs_cost ?? null,
        organic_count: r.organic_count ?? null,
        crawl_incomplete: !!r.crawl_incomplete,
        best_rank_group: r.best_rank_group ?? null,
        error: r.error || null,
      })),
    });

    if (actualCost > COST_CAP_USD) {
      stoppedReason = `cost_cap_after_batch: $${actualCost.toFixed(4)} > $${COST_CAP_USD}`;
      // Still try to save this batch's results — we already spent
    }

    if (http !== 200 || !per.length) {
      batchLog[batchLog.length - 1].save_skipped = true;
      batchLog[batchLog.length - 1].error = json?.error || `HTTP ${http}`;
      if (json?.summary?.dfs_fatal) {
        stoppedReason = `dfs_fatal: ${json?.summary?.dfs_fatal_reason || 'unknown'}`;
        break;
      }
      continue;
    }

    const combined = buildCombinedRows(per, []);
    let keywordRows = buildKeywordRows(combined, AUDIT_DATE, PROPERTY, { stampRefreshedAt: true });
    keywordRows = keywordRows.map((row) => {
      const prev = prevByKw.get(String(row.keyword || '').toLowerCase());
      return mergePreserveNonSerp(prev, row);
    });

    const save = await saveBatch(keywordRows);
    batchLog[batchLog.length - 1].save_http = save.http;
    batchLog[batchLog.length - 1].save = save.json;
    for (const r of keywordRows) refreshedKeywords.push(r.keyword);

    if (stoppedReason?.startsWith('cost_cap_after')) break;
    await sleep(400);
  }

  await sleep(2000);
  const afterRows = await fetchAllKeywordRows();
  const afterCoverage = coverageCounts(afterRows);
  const afterScores = scoresFromRows(afterRows);

  writeFileSync(`${OUT}/dfs-cohort-refresh-backup-after.json`, JSON.stringify({
    backed_up_at: new Date().toISOString(),
    auditDate: AUDIT_DATE,
    row_count: afterRows.length,
    coverage: afterCoverage,
    scores: afterScores,
    rows: afterRows,
  }));

  const summarySave = await saveSummaryScores(
    afterScores.surface,
    afterScores.top,
    afterScores.surface_coverage || afterCoverage
  );

  const report = {
    generated_at: new Date().toISOString(),
    api_base: API_BASE,
    auditDate: AUDIT_DATE,
    duration_ms: Date.now() - t0,
    production_commit_note: 'Uses live production serp-rank-test + save-keyword-batch + save-ranking-ai-summary (capture quality path)',
    plan,
    stopped_reason: stoppedReason,
    requests_to_serp_rank_test: requests,
    keywords_targeted: uniqueRefresh.length,
    keywords_saved_batches: refreshedKeywords.length,
    preserved_verified: [...PRESERVE_VERIFIED],
    cost: {
      cap_usd: COST_CAP_USD,
      estimated_per_attempt_usd: EST_COST_PER_ATTEMPT,
      actual_usd: +actualCost.toFixed(6),
      under_cap: actualCost <= COST_CAP_USD,
    },
    before: {
      coverage: beforeCoverage,
      scores: beforeScores,
    },
    after: {
      coverage: afterCoverage,
      scores: afterScores,
    },
    summary_save: summarySave,
    batch_log_path: 'dfs-cohort-refresh-batches.json',
    residual_unknown: {
      incomplete: afterCoverage.by_status.incomplete,
      empty: afterCoverage.by_status.empty,
      error: afterCoverage.by_status.error,
      legacy_unverified: afterCoverage.by_status.legacy_unverified,
    },
  };

  writeFileSync(`${OUT}/dfs-cohort-refresh-batches.json`, JSON.stringify(batchLog, null, 2));
  writeFileSync(`${OUT}/dfs-cohort-refresh-verify.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${OUT}/dfs-cohort-refresh.md`, `# DFS cohort refresh — production SERP-only

**Generated:** ${report.generated_at}  
**Audit date:** ${AUDIT_DATE}  
**API:** ${API_BASE}

## Cost

| | |
|---|---|
| Cap | $${COST_CAP_USD.toFixed(2)} |
| Est / attempt | $${EST_COST_PER_ATTEMPT} (depth 50 full crawl) |
| Est min (first attempt × ${uniqueRefresh.length}) | $${plan.est_min_usd} |
| Est max (×3 retries) | $${plan.est_max_usd_with_retries} |
| **Actual** | **$${actualCost.toFixed(4)}** |
| serp-rank-test requests | ${requests} |
| Stopped | ${stoppedReason || 'completed'} |

## Cohort

- Tracked rows: ${beforeRows.length}
- Preserved verified (no re-spend): ${[...PRESERVE_VERIFIED].join('; ')}
- Targeted refresh: ${uniqueRefresh.length}
- Keywords saved via batches: ${refreshedKeywords.length}

## Capture status counts

| Status | Before | After |
|---|---:|---:|
| complete_ranked | ${beforeCoverage.by_status.complete_ranked} | ${afterCoverage.by_status.complete_ranked} |
| complete_no_match | ${beforeCoverage.by_status.complete_no_match} | ${afterCoverage.by_status.complete_no_match} |
| incomplete | ${beforeCoverage.by_status.incomplete} | ${afterCoverage.by_status.incomplete} |
| empty | ${beforeCoverage.by_status.empty} | ${afterCoverage.by_status.empty} |
| error | ${beforeCoverage.by_status.error} | ${afterCoverage.by_status.error} |
| legacy_unverified | ${beforeCoverage.by_status.legacy_unverified} | ${afterCoverage.by_status.legacy_unverified} |
| measurable | ${beforeCoverage.measurable} | ${afterCoverage.measurable} |
| provisional | ${beforeCoverage.provisional} | ${afterCoverage.provisional} |

## Scores (shared Surface / Top — Site AI Health + Ranking)

| | Before | After |
|---|---:|---:|
| Surface Visibility | ${beforeScores.surface} | ${afterScores.surface} |
| Top of Page | ${beforeScores.top} | ${afterScores.top} |

Scores are recomputed from stored evidence after refresh — **not forced up**. Residual unknown (incomplete/empty/error): ${afterCoverage.by_status.incomplete + afterCoverage.by_status.empty + afterCoverage.by_status.error}.

## Summary persist

- save-ranking-ai-summary HTTP ${summarySave.http}
- Writes \`surface_visibility_score\` / \`top_of_page_score\` + pillar coverage (does **not** wipe combinedRows)

## Artifacts

- \`dfs-cohort-refresh-backup-before.json\`
- \`dfs-cohort-refresh-backup-after.json\`
- \`dfs-cohort-refresh-batches.json\`
- \`dfs-cohort-refresh-verify.json\`
- \`dfs-cohort-refresh-plan.json\`
`);

  console.log(JSON.stringify({
    ok: true,
    actual_usd: actualCost,
    before: beforeCoverage.by_status,
    after: afterCoverage.by_status,
    scores_before: beforeScores,
    scores_after: afterScores,
    stopped: stoppedReason,
    duration_ms: Date.now() - t0,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  writeFileSync(`${OUT}/dfs-cohort-refresh-error.json`, JSON.stringify({
    at: new Date().toISOString(),
    error: String(err?.message || err),
    stack: err?.stack || null,
  }, null, 2));
  process.exit(1);
});
