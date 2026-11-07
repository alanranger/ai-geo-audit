/**
 * Authorized diagnosis only — no DB writes.
 * Bounded DFS calls (hard cap 12) for two focus keywords + gift-card control.
 * Uses current production fetchSerpForKeyword + isIncompleteSerpCrawl.
 */
import { config as dotenvConfig } from 'dotenv';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fetchSerpForKeyword } from '../api/aigeo/serp-rank-test.js';
import { isIncompleteSerpCrawl, SERP_CRAWL_INCOMPLETE_ERROR } from '../lib/keyword-ranking/dfs-serp-quality.js';
import { resolveTrackingLocation } from '../lib/keyword-ranking/tracking-location.js';

dotenvConfig({ path: '.env.local' });

const OUT_DIR = 'C:/Users/alan/Documents/Codex/2026-09-28/when/outputs';
const TARGET = 'alanranger.com';
const MAX_CALLS = 12;
const ENDPOINT = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';

const login = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
const password = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;
if (!login || !password) throw new Error('Missing DFS credentials in .env.local');
const auth = Buffer.from(`${login}:${password}`).toString('base64');

const CASES = [
  { id: 'courses_coventry', keyword: 'beginners photography courses coventry', note: 'focus: audit null stub' },
  { id: 'free_near_me', keyword: 'free photography classes near me', note: 'focus: audit null organic + pack1' },
  { id: 'gift_card_control', keyword: 'photography gift card', note: 'control: audit rg1' },
];

let callsUsed = 0;
let totalCost = 0;
const callLog = [];
const sanitizedRaws = [];

function summarizeItems(items) {
  const list = Array.isArray(items) ? items : [];
  const organic = list.filter((i) => i?.type === 'organic');
  const alanOrganic = organic.filter((i) =>
    String(i.domain || i.url || '').toLowerCase().includes('alanranger')
  );
  const typeCounts = {};
  for (const i of list) typeCounts[i.type] = (typeCounts[i.type] || 0) + 1;
  const nestedOrganicHits = [];
  for (const i of list) {
    if (!i || i.type === 'organic') continue;
    const blob = JSON.stringify(i).toLowerCase();
    if (blob.includes('alanranger.com')) {
      nestedOrganicHits.push({
        parent_type: i.type,
        rank_group: i.rank_group ?? null,
        rank_absolute: i.rank_absolute ?? null,
      });
    }
  }
  return {
    items_count: list.length,
    organic_count: organic.length,
    type_counts: typeCounts,
    alan_organic: alanOrganic.map((i) => ({
      rank_group: i.rank_group ?? null,
      rank_absolute: i.rank_absolute ?? null,
      url: String(i.url || '').slice(0, 120),
      domain: i.domain || null,
    })),
    top5_organic: organic.slice(0, 5).map((i) => ({
      rank_group: i.rank_group ?? null,
      rank_absolute: i.rank_absolute ?? null,
      domain: i.domain || null,
      url: String(i.url || '').slice(0, 90),
    })),
    alan_mentions_outside_top_level_organic: nestedOrganicHits.slice(0, 10),
  };
}

async function rawDfsCall({ keyword, location_code, location_coordinate, depth, label, caseId }) {
  if (callsUsed >= MAX_CALLS) {
    return { skipped: true, reason: 'budget_exhausted' };
  }
  const payload = {
    keyword,
    language_code: 'en',
    location_code,
    device: 'desktop',
    os: 'windows',
    depth,
    load_async_ai_overview: false,
    expand_ai_overview: false,
  };
  if (location_coordinate) payload.location_coordinate = location_coordinate;

  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  callsUsed += 1;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify([payload]),
  });
  const data = await res.json();
  const ms = Date.now() - t0;
  const task = data?.tasks?.[0] || {};
  const result = task?.result?.[0] || {};
  const items = Array.isArray(result.items) ? result.items : [];
  const itemSum = summarizeItems(items);
  const cost = task?.cost != null ? Number(task.cost) : (data?.cost != null ? Number(data.cost) : null);
  if (Number.isFinite(cost)) totalCost += cost;

  const quality = {
    depth,
    organicCount: itemSum.organic_count,
    itemsCount: itemSum.items_count,
    seResultsCount: result?.se_results_count != null ? Number(result.se_results_count) : null,
    cost,
  };
  const incomplete = isIncompleteSerpCrawl(quality);

  // Mirror production parser path (no retries here — caller controls repeats).
  const loc = resolveTrackingLocation(keyword);
  const parsed = await (async () => {
    // Re-parse via production function would spend another call; instead apply
    // the same organic match rules locally from this raw payload.
    const ourOrganic = items.filter((item) => {
      if (item.type !== 'organic') return false;
      const d = String(item.domain || item.url || '').toLowerCase().replace(/^www\./, '');
      return d.includes(TARGET);
    });
    let bestRankGroup = null;
    let bestRankAbsolute = null;
    let bestUrl = null;
    for (const item of ourOrganic) {
      if (bestRankGroup === null || item.rank_group < bestRankGroup) {
        bestRankGroup = item.rank_group;
        bestRankAbsolute = item.rank_absolute;
        bestUrl = item.url;
      }
    }
    return {
      best_rank_group: bestRankGroup,
      best_rank_absolute: bestRankAbsolute,
      best_url: bestUrl,
      organic_count: itemSum.organic_count,
      dfs_cost: cost,
      se_results_count: quality.seResultsCount,
      crawl_incomplete: incomplete,
      error: incomplete ? SERP_CRAWL_INCOMPLETE_ERROR : null,
      location_code: location_code,
      location_coordinate: location_coordinate || null,
      device: 'desktop',
      os: 'windows',
      tier: loc.tier,
    };
  })();

  const entry = {
    call_index: callsUsed,
    label,
    case_id: caseId,
    started_at: startedAt,
    ms,
    http_status: res.status,
    request: { ...payload },
    task_id: task?.id || null,
    task_status_code: task?.status_code ?? null,
    task_status_message: task?.status_message ?? null,
    top_status_code: data?.status_code ?? null,
    top_status_message: data?.status_message ?? null,
    cost,
    result_datetime: result?.datetime ?? null,
    check_url: result?.check_url ?? null,
    se_results_count: quality.seResultsCount,
    item_types: result?.item_types ?? null,
    ...itemSum,
    production_quality_decision: incomplete ? 'incomplete_retry_candidate' : 'complete',
    production_parser_match: parsed,
  };
  callLog.push(entry);

  sanitizedRaws.push({
    call_index: callsUsed,
    label,
    case_id: caseId,
    request: payload,
    task_id: task?.id || null,
    task_status_code: task?.status_code ?? null,
    cost,
    result_meta: {
      keyword: result?.keyword,
      location_code: result?.location_code,
      datetime: result?.datetime,
      se_results_count: result?.se_results_count,
      items_count: result?.items_count,
      item_types: result?.item_types,
      check_url: result?.check_url,
    },
    items_sanitized: items.map((i) => ({
      type: i.type,
      rank_group: i.rank_group ?? null,
      rank_absolute: i.rank_absolute ?? null,
      domain: i.domain || null,
      url: i.url ? String(i.url).slice(0, 160) : null,
      title: i.title ? String(i.title).slice(0, 120) : null,
      // drop large nested blobs except type markers
      has_nested_items: Array.isArray(i.items) ? i.items.length : (i.items ? 1 : 0),
    })),
    production_parser_match: parsed,
  });

  console.log(JSON.stringify({
    call: callsUsed,
    label,
    task_id: entry.task_id,
    cost,
    organic: itemSum.organic_count,
    incomplete,
    alan_rg: parsed.best_rank_group,
    alan_ra: parsed.best_rank_absolute,
  }));

  return entry;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  // Pass A: exact audit settings (location_code, no coordinate), depth 50, desktop/windows.
  for (const c of CASES) {
    const loc = resolveTrackingLocation(c.keyword);
    await rawDfsCall({
      keyword: c.keyword,
      location_code: loc.location_code,
      location_coordinate: null,
      depth: 50,
      label: `${c.id}_exact_r1`,
      caseId: c.id,
    });
  }

  // Pass B: one repeat each for focus keywords if budget remains (variance).
  for (const c of CASES.filter((x) => x.id !== 'gift_card_control')) {
    if (callsUsed >= MAX_CALLS) break;
    const loc = resolveTrackingLocation(c.keyword);
    await rawDfsCall({
      keyword: c.keyword,
      location_code: loc.location_code,
      location_coordinate: null,
      depth: 50,
      label: `${c.id}_exact_r2`,
      caseId: c.id,
    });
  }

  // Pass C: third attempt for any focus call that was incomplete or empty (mirrors prod retry).
  for (const c of CASES.filter((x) => x.id !== 'gift_card_control')) {
    if (callsUsed >= MAX_CALLS) break;
    const prior = callLog.filter((e) => e.case_id === c.id);
    const needsRetry = prior.some((e) =>
      e.production_quality_decision === 'incomplete_retry_candidate'
      || e.organic_count === 0
      || e.production_parser_match?.best_rank_group == null
    );
    if (!needsRetry) continue;
    const loc = resolveTrackingLocation(c.keyword);
    await rawDfsCall({
      keyword: c.keyword,
      location_code: loc.location_code,
      location_coordinate: null,
      depth: 50,
      label: `${c.id}_exact_r3`,
      caseId: c.id,
    });
  }

  // Pass D (optional): old GBP pin vs exact settings — only if budget remains and focus still null.
  const stillNullFocus = CASES.filter((c) => c.id !== 'gift_card_control').filter((c) => {
    const rows = callLog.filter((e) => e.case_id === c.id && !e.skipped);
    return rows.length > 0 && rows.every((e) => e.production_parser_match?.best_rank_group == null);
  });
  const PIN = '52.3991769,-1.5937149,14z';
  for (const c of stillNullFocus) {
    if (callsUsed >= MAX_CALLS) break;
    const loc = resolveTrackingLocation(c.keyword);
    if (loc.tier !== 'L') continue;
    await rawDfsCall({
      keyword: c.keyword,
      location_code: loc.location_code,
      location_coordinate: PIN,
      depth: 50,
      label: `${c.id}_old_pin_r1`,
      caseId: c.id,
    });
  }

  // Also call production fetchSerpForKeyword once per focus if budget left —
  // validates exported path (adds paid calls). Prefer only if <3 calls remain
  // and we still lack a complete alan match explanation.
  for (const c of CASES.filter((x) => x.id !== 'gift_card_control')) {
    if (callsUsed >= MAX_CALLS) break;
    const loc = resolveTrackingLocation(c.keyword);
    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    callsUsed += 1;
    const serp = await fetchSerpForKeyword(c.keyword, auth, TARGET, 50, {
      location_code: loc.location_code,
      tier: loc.tier,
      expandAiOverview: false,
    });
    const cost = serp?.dfs_cost != null ? Number(serp.dfs_cost) : null;
    if (Number.isFinite(cost)) totalCost += cost;
    const entry = {
      call_index: callsUsed,
      label: `${c.id}_via_fetchSerpForKeyword`,
      case_id: c.id,
      started_at: startedAt,
      ms: Date.now() - t0,
      request: {
        keyword: c.keyword,
        language_code: 'en',
        location_code: loc.location_code,
        location_coordinate: null,
        device: 'desktop',
        os: 'windows',
        depth: 50,
        via: 'fetchSerpForKeyword',
      },
      task_id: null,
      cost,
      organic_count: serp?.organic_count ?? null,
      se_results_count: serp?.se_results_count ?? null,
      production_quality_decision: serp?.crawl_incomplete ? 'incomplete_retry_candidate' : 'complete',
      production_parser_match: {
        best_rank_group: serp?.best_rank_group ?? null,
        best_rank_absolute: serp?.best_rank_absolute ?? null,
        best_url: serp?.best_url ?? null,
        organic_count: serp?.organic_count ?? null,
        dfs_cost: cost,
        se_results_count: serp?.se_results_count ?? null,
        crawl_incomplete: !!serp?.crawl_incomplete,
        error: serp?.error ?? null,
        location_code: serp?.location_code ?? loc.location_code,
        location_coordinate: serp?.location_coordinate ?? null,
        device: serp?.device ?? null,
        os: serp?.os ?? null,
        local_pack_position: serp?.local_pack_position ?? null,
      },
      note: 'Single attempt via production fetchSerpForKeyword (handler retries not applied)',
    };
    callLog.push(entry);
    console.log(JSON.stringify({
      call: callsUsed,
      label: entry.label,
      cost,
      organic: entry.organic_count,
      incomplete: !!serp?.crawl_incomplete,
      alan_rg: serp?.best_rank_group ?? null,
    }));
  }

  const summary = {
    generated_at: new Date().toISOString(),
    max_calls: MAX_CALLS,
    calls_used: callsUsed,
    total_api_cost_usd: Number(totalCost.toFixed(6)),
    correction: 'Ten-test (~11:18–11:25 BST) preceded fix commit 3326f8e (12:05 BST); it did NOT verify the fix.',
    calls: callLog,
  };

  writeFileSync(`${OUT_DIR}/dfs-followup-diagnosis-calls.json`, JSON.stringify(summary, null, 2));
  writeFileSync(`${OUT_DIR}/dfs-followup-diagnosis-raw-sanitized.json`, JSON.stringify({
    generated_at: summary.generated_at,
    calls_used: callsUsed,
    total_api_cost_usd: summary.total_api_cost_usd,
    sanitizedRaws,
  }, null, 2));

  console.log('\n=== DONE ===');
  console.log(JSON.stringify({
    calls_used: callsUsed,
    total_api_cost_usd: summary.total_api_cost_usd,
    per_case: CASES.map((c) => {
      const rows = callLog.filter((e) => e.case_id === c.id);
      return {
        id: c.id,
        attempts: rows.length,
        ranks: rows.map((r) => r.production_parser_match?.best_rank_group ?? null),
        organics: rows.map((r) => r.organic_count),
        incomplete: rows.map((r) => r.production_quality_decision),
        costs: rows.map((r) => r.cost),
      };
    }),
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
