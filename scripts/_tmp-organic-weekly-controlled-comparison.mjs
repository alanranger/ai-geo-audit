/**
 * Diagnostic-only: paired old GBP-pin vs current Coventry city-code SERPs
 * for Local-tier keywords. NO keyword_rankings / audit / website writes.
 *
 * Settings recovered from Sep-21 saved rows + config/business-location-LOCKED.json
 * + git history through 3326f8e^ (pin era).
 */
import { config as dotenvConfig } from 'dotenv';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolveTrackingLocation } from '../lib/keyword-ranking/tracking-location.js';
import { isIncompleteSerpCrawl } from '../lib/keyword-ranking/dfs-serp-quality.js';
import { getHyperlocalCoordinate, getBusinessDevice } from '../lib/keyword-ranking/business-location.js';

dotenvConfig({ path: '.env.local' });

const OUT = 'C:/Users/alan/Documents/Codex/2026-09-28/when/outputs';
const API = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';
const DEPTH = 50;
const LANG = 'en';
const DEVICE = getBusinessDevice() || 'desktop';
const OS = DEVICE === 'desktop' ? 'windows' : 'android';
const PIN = getHyperlocalCoordinate(); // verified = Sep21 location_coordinate
const LOCAL_CODE = 9215523;
const NAT_CODE = 2826;
const COST_CAP = 5.0;
const MAX_ATTEMPTS_TOTAL = 465;
const MAX_ATTEMPTS_PER_CONDITION = 3;
const UNIT_EST = 0.008;

const login = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
const password = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;
if (!login || !password) throw new Error('Missing DFS credentials');
const auth = Buffer.from(`${login}:${password}`).toString('base64');

mkdirSync(OUT, { recursive: true });

function loadKeywords(file) {
  const j = JSON.parse(readFileSync(`${OUT}/${file}`, 'utf8'));
  const rows = j.data?.keywords || j.rows || [];
  return new Map(rows.map((r) => [norm(r.keyword), r]));
}

function norm(k) {
  return String(k || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isLocalRow(r) {
  if (!r) return false;
  if (r.location_coordinate) return true;
  return Number(r.location_code) === LOCAL_CODE;
}

function inTop10(r) {
  const g = r?.best_rank_group;
  return g != null && Number.isFinite(Number(g)) && Number(g) <= 10;
}

function rg(r) {
  if (!r || r.best_rank_group == null) return null;
  const n = Number(r.best_rank_group);
  return Number.isFinite(n) ? n : null;
}

let attempts = 0;
let spent = 0;
const callLog = [];
const sanitized = [];

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function oneCall({ keyword, setting, location_code, location_coordinate }) {
  if (attempts >= MAX_ATTEMPTS_TOTAL) return { skipped: true, reason: 'max_attempts' };
  if (spent + UNIT_EST > COST_CAP + 0.001) return { skipped: true, reason: 'cost_cap' };

  const payload = {
    keyword,
    language_code: LANG,
    device: DEVICE,
    os: OS,
    depth: DEPTH,
    load_async_ai_overview: false,
    expand_ai_overview: false,
    location_code,
  };
  if (location_coordinate) payload.location_coordinate = location_coordinate;

  attempts += 1;
  const t0 = Date.now();
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify([payload]),
  });
  const data = await res.json();
  const task = data?.tasks?.[0];
  const result = task?.result?.[0];
  const items = Array.isArray(result?.items) ? result.items : [];
  const organic = items.filter((i) => i?.type === 'organic');
  const cost = Number(task?.cost ?? data?.cost ?? 0) || 0;
  spent += cost;

  const alan = organic.filter((i) =>
    String(i.domain || i.url || '').toLowerCase().includes('alanranger')
  );
  const best = alan[0] || null;
  const incomplete = isIncompleteSerpCrawl({
    depth: DEPTH,
    organicCount: organic.length,
    itemsCount: items.length,
    seResultsCount: result?.se_results_count,
    cost,
    error: !result ? 'empty SERP' : null,
  });

  const row = {
    at: new Date().toISOString(),
    keyword,
    setting,
    location_code,
    location_coordinate: location_coordinate || null,
    depth: DEPTH,
    device: DEVICE,
    os: OS,
    language_code: LANG,
    http_ok: res.ok,
    dfs_status: data?.status_code ?? null,
    task_status: task?.status_code ?? null,
    task_id: task?.id || null,
    cost_usd: cost,
    cumulative_cost_usd: Number(spent.toFixed(6)),
    attempt_global: attempts,
    ms: Date.now() - t0,
    organic_count: organic.length,
    items_count: items.length,
    se_results_count: result?.se_results_count ?? null,
    incomplete: !!incomplete,
    rank_group: best?.rank_group ?? null,
    rank_absolute: best?.rank_absolute ?? null,
    url: best?.url ? String(best.url).slice(0, 160) : null,
    completeness: incomplete
      ? 'incomplete'
      : best
        ? 'complete_ranked'
        : organic.length
          ? 'complete_no_match'
          : 'empty',
  };
  callLog.push(row);
  sanitized.push({
    ...row,
    top5_domains: organic.slice(0, 5).map((i) => i.domain || null),
    // strip full SERP bodies — keep task id for audit trail
  });
  return row;
}

async function conditionWithRetries(keyword, setting, loc) {
  const tries = [];
  for (let i = 0; i < MAX_ATTEMPTS_PER_CONDITION; i += 1) {
    const r = await oneCall({
      keyword,
      setting,
      location_code: loc.location_code,
      location_coordinate: loc.location_coordinate,
    });
    if (r.skipped) {
      tries.push(r);
      break;
    }
    tries.push(r);
    if (!r.incomplete && r.completeness !== 'empty') break;
    await sleep(400);
  }
  const ok = [...tries].reverse().find((t) => !t.skipped && !t.incomplete && t.completeness !== 'empty');
  const last = tries[tries.length - 1];
  return {
    keyword,
    setting,
    attempts: tries.length,
    tries: tries.map((t) => ({
      incomplete: t.incomplete,
      completeness: t.completeness,
      cost_usd: t.cost_usd,
      rank_group: t.rank_group,
      organic_count: t.organic_count,
      task_id: t.task_id,
      skipped: t.skipped,
      reason: t.reason,
    })),
    final: ok || last,
    known_complete: !!(ok && !ok.incomplete),
  };
}

function classifyMovement(prevRg, nowRg, nowKnown) {
  if (!nowKnown) return 'unknown';
  const prevTop = prevRg != null && prevRg <= 10;
  const nowTop = nowRg != null && nowRg <= 10;
  if (prevTop && nowTop) return 'retained';
  if (prevTop && !nowTop) return 'lost';
  if (!prevTop && nowTop) return 'gained';
  return 'outside_both';
}

async function main() {
  if (!String(PIN).includes('52.3991769')) {
    throw new Error(`PIN mismatch — expected GBP centroid, got ${PIN}`);
  }

  const M14 = loadKeywords('_krprobe-2026-09-14.json');
  const M21 = loadKeywords('_krprobe-2026-09-21.json');
  const M28 = loadKeywords('dfs-cohort-refresh-backup-after.json');

  const keywords = [...M21.keys()].sort();
  const localKws = keywords.filter((k) => isLocalRow(M21.get(k)));
  const natKws = keywords.filter((k) => !isLocalRow(M21.get(k)));

  // Verify recovered pin matches every Local Sep21 row that had a coordinate
  const pinMismatch = localKws.filter((k) => {
    const c = M21.get(k)?.location_coordinate;
    return c && c !== PIN;
  });
  if (pinMismatch.length) throw new Error(`Pin mismatch on ${pinMismatch.length} Sep21 rows`);

  const lostLocal = localKws.filter((k) => inTop10(M21.get(k)) && !inTop10(M28.get(k)));
  const retainedLocal = localKws.filter((k) => inTop10(M21.get(k)) && inTop10(M28.get(k)));
  const otherLocal = localKws.filter((k) => !lostLocal.includes(k) && !retainedLocal.includes(k));

  // Priority order: lost pairs first, then retained, then remaining local
  const ordered = [...lostLocal, ...retainedLocal, ...otherLocal];

  const plan = {
    generated_at: new Date().toISOString(),
    recovered_settings: {
      old_local: {
        location_code: LOCAL_CODE,
        location_name: 'Coventry,England,United Kingdom',
        location_coordinate: PIN,
        source: 'Sep21 keyword_rankings.location_coordinate + config/business-location-LOCKED.json + fc78435/pre-3326f8e',
        depth: DEPTH,
        device: DEVICE,
        os: OS,
        language_code: LANG,
        expand_ai_overview: false,
      },
      current_local: {
        location_code: LOCAL_CODE,
        location_name: 'Coventry,England,United Kingdom',
        location_coordinate: null,
        source: 'post-3326f8e production (city code only)',
        depth: DEPTH,
        device: DEVICE,
        os: OS,
        language_code: LANG,
        expand_ai_overview: false,
      },
      national_unchanged: {
        location_code: NAT_CODE,
        location_coordinate: null,
        note: 'National/brand not in geo-change cohort — historical Sep21 vs saved current only',
      },
    },
    cohorts: {
      tracked: keywords.length,
      local_affected: localKws.length,
      national_control: natKws.length,
      local_top10_lost_vs_saved_current: lostLocal.length,
      local_top10_retained_vs_saved_current: retainedLocal.length,
      local_other: otherLocal.length,
    },
    cost_plan: {
      hard_cap_usd: COST_CAP,
      unit_est: UNIT_EST,
      planned_conditions: ordered.length * 2,
      est_min_usd: Number((ordered.length * 2 * UNIT_EST).toFixed(4)),
      est_max_3retries_usd: Number((ordered.length * 2 * MAX_ATTEMPTS_PER_CONDITION * UNIT_EST).toFixed(4)),
      max_attempts_total: MAX_ATTEMPTS_TOTAL,
    },
    pin_verified: true,
    pin_mismatches: pinMismatch.length,
  };
  writeFileSync(`${OUT}/organic-weekly-controlled-comparison-plan.json`, JSON.stringify(plan, null, 2));
  console.log(JSON.stringify(plan.cohorts, null, 2));
  console.log('cost plan', plan.cost_plan);

  const results = new Map(); // keyword -> { old, current }

  for (const keyword of ordered) {
    if (spent + UNIT_EST > COST_CAP) {
      console.log('STOP cost cap before', keyword);
      break;
    }
    if (attempts >= MAX_ATTEMPTS_TOTAL) break;

    const oldLoc = {
      location_code: LOCAL_CODE,
      location_coordinate: PIN,
    };
    const curLoc = {
      location_code: LOCAL_CODE,
      location_coordinate: null,
    };

    // Paired near each other: old then current
    const oldRes = await conditionWithRetries(keyword, 'old_gbp_pin', oldLoc);
    await sleep(250);
    const curRes = await conditionWithRetries(keyword, 'current_city_code', curLoc);

    results.set(keyword, { old: oldRes, current: curRes });
    const oRg = oldRes.known_complete ? oldRes.final?.rank_group ?? null : null;
    const cRg = curRes.known_complete ? curRes.final?.rank_group ?? null : null;
    console.log(
      `[${results.size}/${ordered.length}] $${spent.toFixed(3)} ${keyword} | Sep21=${rg(M21.get(keyword))} oldNow=${oldRes.known_complete ? oRg : 'UNK'} curNow=${curRes.known_complete ? cRg : 'UNK'}`
    );
  }

  // Build per-keyword table (all 155)
  const rows = [];
  for (const keyword of keywords) {
    const r14 = M14.get(keyword);
    const r21 = M21.get(keyword);
    const r28 = M28.get(keyword);
    const local = isLocalRow(r21);
    const live = results.get(keyword);
    const oldLive = live?.old;
    const curLive = live?.current;
    const sep21 = rg(r21);
    const sep14 = rg(r14);
    const savedCur = rg(r28);
    const oldNow = oldLive?.known_complete ? (oldLive.final?.rank_group ?? null) : null;
    const curNow = curLive?.known_complete ? (curLive.final?.rank_group ?? null) : null;
    const oldKnown = !!oldLive?.known_complete;
    const curKnown = !!curLive?.known_complete;

    const vsSaved = classifyMovement(sep21, savedCur, true); // saved current always "known" as snapshot but may be legacy quality
    const vsOldSetting = local && oldLive
      ? classifyMovement(sep21, oldNow, oldKnown)
      : (local ? 'not_tested' : 'n/a_national');
    const vsCurSetting = local && curLive
      ? classifyMovement(sep21, curNow, curKnown)
      : (local ? 'not_tested' : 'n/a_national');

    const loc = resolveTrackingLocation(keyword);
    rows.push({
      keyword,
      tier: local ? 'local' : 'national',
      location_code_sep21: r21?.location_code ?? null,
      location_coordinate_sep21: r21?.location_coordinate ?? null,
      tracking_tier: loc.tier,
      sep14_rank_group: sep14,
      sep21_rank_group: sep21,
      sep21_in_top10: inTop10(r21),
      saved_current_rank_group: savedCur,
      saved_current_in_top10: inTop10(r28),
      saved_current_capture: r28?.serp_features?.capture_status || 'unknown',
      old_setting_now_rank_group: oldNow,
      old_setting_now_complete: oldLive ? oldLive.final?.completeness ?? null : null,
      old_setting_now_known: oldKnown,
      old_setting_attempts: oldLive?.attempts ?? 0,
      current_setting_now_rank_group: curNow,
      current_setting_now_complete: curLive ? curLive.final?.completeness ?? null : null,
      current_setting_now_known: curKnown,
      current_setting_attempts: curLive?.attempts ?? 0,
      movement_sep21_vs_saved_current: local
        ? (inTop10(r21) && inTop10(r28) ? 'retained' : inTop10(r21) && !inTop10(r28) ? 'lost' : !inTop10(r21) && inTop10(r28) ? 'gained' : 'outside_both')
        : (inTop10(r21) && inTop10(r28) ? 'retained' : inTop10(r21) && !inTop10(r28) ? 'lost' : !inTop10(r21) && inTop10(r28) ? 'gained' : 'outside_both'),
      movement_sep21_vs_old_setting_now: vsOldSetting,
      movement_sep21_vs_current_setting_now: vsCurSetting,
      settings_attribution: (() => {
        if (!local || !oldKnown || !curKnown) return local ? 'insufficient_live' : 'national_control';
        const lostSaved = inTop10(r21) && !inTop10(r28);
        if (!lostSaved) return 'not_in_saved_loss_set';
        const stillLostOld = !(oldNow != null && oldNow <= 10);
        const stillLostCur = !(curNow != null && curNow <= 10);
        if (stillLostOld && stillLostCur) return 'persists_under_both_settings';
        if (!stillLostOld && stillLostCur) return 'artifact_of_city_vs_pin';
        if (stillLostOld && !stillLostCur) return 'unexpected_city_better_than_pin';
        return 'recovered_under_both';
      })(),
    });
  }

  // Aggregates — Local matched denominators where live known-complete
  const localRows = rows.filter((r) => r.tier === 'local');
  const liveLocal = localRows.filter((r) => r.old_setting_now_known && r.current_setting_now_known);
  const top21Local = localRows.filter((r) => r.sep21_in_top10);
  const top21LocalLive = top21Local.filter((r) => r.old_setting_now_known && r.current_setting_now_known);

  function countMove(list, field) {
    const out = { retained: 0, lost: 0, gained: 0, outside_both: 0, unknown: 0, not_tested: 0, n_a_national: 0 };
    for (const r of list) {
      const v = r[field];
      if (out[v] != null) out[v] += 1;
      else out.unknown += 1;
    }
    return out;
  }

  const attr = {};
  for (const r of liveLocal.filter((x) => x.sep21_in_top10)) {
    const a = r.settings_attribution;
    attr[a] = (attr[a] || 0) + 1;
  }

  const summary = {
    generated_at: new Date().toISOString(),
    diagnostic_only: true,
    no_db_writes: true,
    recovered_pin: PIN,
    pin_source_verified: true,
    spend: {
      attempts,
      cost_usd_evidenced: Number(spent.toFixed(6)),
      cost_cap_usd: COST_CAP,
      call_log_sum: Number(callLog.reduce((s, c) => s + (Number(c.cost_usd) || 0), 0).toFixed(6)),
    },
    denominators: {
      tracked_keywords: keywords.length,
      local_geo_affected: localKws.length,
      national_control: natKws.length,
      local_live_paired_known_complete: liveLocal.length,
      local_top10_sep21: top21Local.length,
      local_top10_sep21_live_paired: top21LocalLive.length,
    },
    top10_sep21_vs_saved_current_local: countMove(top21Local, 'movement_sep21_vs_saved_current'),
    top10_sep21_vs_old_pin_now_local_live: countMove(top21LocalLive, 'movement_sep21_vs_old_setting_now'),
    top10_sep21_vs_city_now_local_live: countMove(top21LocalLive, 'movement_sep21_vs_current_setting_now'),
    top10_sep21_vs_saved_current_national: countMove(
      rows.filter((r) => r.tier === 'national' && r.sep21_in_top10),
      'movement_sep21_vs_saved_current'
    ),
    attribution_among_sep21_top10_local_live: attr,
    headline_counts: {
      sep21_top10_all: keywords.filter((k) => inTop10(M21.get(k))).length,
      sep28_saved_top10_all: keywords.filter((k) => inTop10(M28.get(k))).length,
      sep21_top10_local: top21Local.length,
      sep28_saved_top10_local: localRows.filter((r) => r.saved_current_in_top10).length,
    },
  };

  writeFileSync(`${OUT}/organic-weekly-controlled-comparison.json`, JSON.stringify({ summary, plan, rows, live_by_keyword: Object.fromEntries(results) }, null, 2));
  writeFileSync(`${OUT}/organic-weekly-controlled-comparison-calls.json`, JSON.stringify(callLog, null, 2));
  writeFileSync(`${OUT}/organic-weekly-controlled-comparison-raw-sanitized.json`, JSON.stringify(sanitized, null, 2));

  const csvHeader = Object.keys(rows[0] || { keyword: 1 }).join(',');
  const csvEsc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [csvHeader, ...rows.map((r) => Object.values(r).map(csvEsc).join(','))].join('\n');
  writeFileSync(`${OUT}/organic-weekly-controlled-comparison.csv`, csv);

  writeFileSync(`${OUT}/organic-weekly-controlled-comparison-summary.json`, JSON.stringify(summary, null, 2));
  console.log('\nSUMMARY\n', JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  writeFileSync(`${OUT}/organic-weekly-controlled-comparison-error.json`, JSON.stringify({
    at: new Date().toISOString(),
    error: String(e?.message || e),
    attempts,
    spent,
  }, null, 2));
  process.exit(1);
});
