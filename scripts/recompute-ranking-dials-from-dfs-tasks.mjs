/**
 * Recompute Surface + Top-of-page for stored ranking scans from the STORED DataForSEO responses
 * (task_get/advanced by the dfs_task_id on each keyword_rankings row — no SERP re-buy), with the
 * current matcher. Read-only: never writes keyword_rankings or audit_results.
 *
 *   node scripts/recompute-ranking-dials-from-dfs-tasks.mjs --runs=keyword_rankings:2026-11-02,keyword_rankings:2026-11-09
 *   [--cache=outputs/_serp-instability/raw] [--out=outputs/_serp-instability/recompute.json]
 *
 * Variants per run: stored (rows as saved), recomputed (fixed matcher + AIO slot kept),
 * recomputed_no_aio_slot (fixed matcher, AIO slot dropped as the Monday cron finalize did).
 */
import fs from 'node:fs';
import path from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { parseSerpResult } from '../lib/keyword-ranking/parse-serp-result.js';
import { loadRedirectLookups } from '../lib/keyword-ranking/redirect-lookups.js';
import { scoreSurfaceAndTop } from '../lib/keyword-ranking/ranking-dial-scores.js';
import { filterTrackedRows } from '../lib/keyword-ranking/tracked-set-v3.js';
import { scanFlipGuard, rankBucket } from '../lib/keyword-ranking/scan-stability-guard.js';
import { CAPTURE_STATUS } from '../lib/keyword-ranking/dfs-serp-quality.js';

dotenvConfig({ path: '.env.local', quiet: true });

const PROPERTY = 'https://www.alanranger.com';
const ROOT = 'alanranger.com';
const arg = (name, dflt) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=') || dflt;

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dfsAuth = () => Buffer.from(`${process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD}`).toString('base64');

async function loadRows(table, date) {
  const out = [];
  for (let from = 0; ; from += 500) {
    const q = `${SB_URL}/rest/v1/${table}?select=*&property_url=eq.${encodeURIComponent(PROPERTY)}&audit_date=eq.${date}&order=id.asc&limit=500&offset=${from}`;
    const r = await fetch(q, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
    if (!r.ok) throw new Error(`${table} ${date}: HTTP ${r.status}`);
    const chunk = await r.json();
    out.push(...chunk);
    if (chunk.length < 500) return out;
  }
}

async function loadTask(taskId, cacheDir) {
  const hit = fs.readdirSync(cacheDir).find((f) => f.endsWith(`_${taskId}.json`));
  if (hit) return JSON.parse(fs.readFileSync(path.join(cacheDir, hit), 'utf8'));
  const r = await fetch(`https://api.dataforseo.com/v3/serp/google/organic/task_get/advanced/${taskId}`, { headers: { Authorization: `Basic ${dfsAuth()}` } });
  const data = await r.json();
  fs.writeFileSync(path.join(cacheDir, `task_${taskId}.json`), JSON.stringify(data));
  return data;
}

function captureStatus(row, bestRank) {
  const prev = row.serp_features?.capture_status;
  if (prev && ![CAPTURE_STATUS.COMPLETE_RANKED, CAPTURE_STATUS.COMPLETE_NO_MATCH].includes(prev)) return prev;
  return bestRank != null ? CAPTURE_STATUS.COMPLETE_RANKED : CAPTURE_STATUS.COMPLETE_NO_MATCH;
}

/** The stored row with every SERP-derived field replaced by the fixed parse of its own stored response. */
export function rebuildRow(row, parsed, { keepAioSlot = true } = {}) {
  const s = parsed.surfaces;
  const engines = { ...(row.ai_engines || {}) };
  if (keepAioSlot) engines.google_aio = parsed.ai_overview_citations;
  else delete engines.google_aio;
  return {
    ...row,
    best_rank_group: parsed.best_rank_group,
    best_rank_absolute: parsed.best_rank_absolute,
    best_url: parsed.best_url,
    best_title: parsed.best_title,
    local_pack_position: s.local_pack_position,
    local_pack_present_any: row.local_pack_present_any === true || s.local_pack_present === true,
    kp_present: s.kp_present,
    kp_ours: s.kp_ours,
    featured_snippet_ours: s.featured_snippet_ours,
    paa_ours: s.paa_ours,
    serp_surface_stack: parsed.serp_surface_stack,
    ai_engines: engines,
    serp_features: { ...(row.serp_features || {}), capture_status: captureStatus(row, parsed.best_rank_group) },
  };
}

function counts(rows) {
  const c = { keywords: rows.length, top3: 0, top10: 0, unranked: 0, pack_ours: 0, aio_cited_keywords: 0 };
  for (const r of rows) {
    const b = rankBucket(r.best_rank_group);
    if (b === 'top3') c.top3 += 1;
    if (r.best_rank_group != null && r.best_rank_group <= 10) c.top10 += 1;
    if (b === 'not_found') c.unranked += 1;
    if (r.local_pack_position != null) c.pack_ours += 1;
    if (Number(r.ai_engines?.google_aio?.alan_citations_count) > 0) c.aio_cited_keywords += 1;
  }
  return c;
}

async function recomputeRun(spec, cacheDir, lookups) {
  const [table, date] = spec.split(':');
  const stored = filterTrackedRows(await loadRows(table, date));
  const fixed = [];
  const noSlot = [];
  for (const row of stored) {
    const taskId = row.serp_features?.dfs_task_id;
    const result = taskId ? (await loadTask(taskId, cacheDir))?.tasks?.[0]?.result?.[0] : null;
    if (!result) { fixed.push(row); noSlot.push(row); continue; }
    const parsed = parseSerpResult(result, ROOT, lookups);
    fixed.push(rebuildRow(row, parsed));
    noSlot.push(rebuildRow(row, parsed, { keepAioSlot: false }));
  }
  const variant = (rows) => ({ ...scoreSurfaceAndTop(rows), ...counts(rows) });
  return { run: spec, stored: variant(stored), recomputed: variant(fixed), recomputed_no_aio_slot: variant(noSlot), rows: fixed };
}

const perKeyword = (rows) => rows.map((r) => ({ keyword: r.keyword, location: r.location_name, rank: r.best_rank_group, pack: r.local_pack_position, aio: r.ai_engines?.google_aio?.alan_citations_count ?? 0 }));

async function main() {
  const cacheDir = arg('cache', 'outputs/_serp-instability/raw');
  fs.mkdirSync(cacheDir, { recursive: true });
  const lookups = await loadRedirectLookups(ROOT);
  const runs = [];
  for (const spec of arg('runs', '').split(',').filter(Boolean)) runs.push(await recomputeRun(spec, cacheDir, lookups));
  const pairs = runs.slice(1).map((r, i) => ({ from: runs[i].run, to: r.run, guard: scanFlipGuard(runs[i].rows, r.rows) }));
  const report = { generated_at: new Date().toISOString(), runs: runs.map(({ rows, ...rest }) => ({ ...rest, per_keyword: perKeyword(rows) })), pairs };
  fs.writeFileSync(arg('out', 'outputs/_serp-instability/recompute.json'), JSON.stringify(report, null, 2));
  for (const r of report.runs) console.log(r.run, JSON.stringify({ stored: r.stored, recomputed: r.recomputed, recomputed_no_aio_slot: r.recomputed_no_aio_slot }));
  for (const p of pairs) console.log(`${p.from} → ${p.to}:`, JSON.stringify({ ...p.guard, flips: p.guard.flips.length }));
}

await main();
