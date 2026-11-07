/**
 * Root-cause probe: identical DFS calls, capture FULL task/result metadata
 * for good vs thin responses — find what DFS is telling us when SERP collapses.
 */
import { config as dotenvConfig } from 'dotenv';
import { writeFileSync } from 'node:fs';
dotenvConfig({ path: '.env.local' });

const login = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
const password = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;
const auth = Buffer.from(`${login}:${password}`).toString('base64');
const ENDPOINT = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced';

const CASES = [
  {
    id: 'gift_card_uk',
    keyword: 'photography gift card',
    location_code: 2826,
    use_coord: false,
  },
  {
    id: 'classes_near_me_cov',
    keyword: 'photography classes near me',
    location_code: 9215523,
    use_coord: true,
    location_coordinate: '52.3991769,-1.5937149,14z',
  },
];

function summarisePayload(data, ms) {
  const task = data?.tasks?.[0] || {};
  const result = task?.result?.[0] || {};
  const items = Array.isArray(result.items) ? result.items : [];
  const organic = items.filter((i) => i.type === 'organic');
  const alan = organic.filter((i) => String(i.domain || i.url || '').toLowerCase().includes('alanranger'));
  const typeCounts = {};
  for (const i of items) typeCounts[i.type] = (typeCounts[i.type] || 0) + 1;

  return {
    ms,
    top_status_code: data?.status_code,
    top_status_message: data?.status_message,
    top_cost: data?.cost,
    tasks_count: data?.tasks_count,
    tasks_error: data?.tasks_error,
    task_id: task?.id,
    task_status_code: task?.status_code,
    task_status_message: task?.status_message,
    task_cost: task?.cost,
    task_time: task?.time,
    task_path: task?.path,
    task_data: task?.data, // echo of request params DFS accepted
    result_meta: {
      keyword: result.keyword,
      type: result.type,
      se_domain: result.se_domain,
      location_code: result.location_code,
      language_code: result.language_code,
      check_url: result.check_url,
      datetime: result.datetime,
      spell: result.spell,
      refinement_chips: result.refinement_chips ? 'present' : null,
      item_types: result.item_types,
      se_results_count: result.se_results_count,
      items_count: result.items_count,
      raw_items_length: items.length,
      organic_count: organic.length,
      typeCounts,
      alan_count: alan.length,
      alan_best_rg: alan[0]?.rank_group ?? null,
      top3_organic: organic.slice(0, 3).map((i) => ({
        rg: i.rank_group,
        domain: i.domain,
        // thin vs full often differs here:
        is_featured: i.is_featured_snippet,
        is_malicious: i.is_malicious,
        website_name: i.website_name,
      })),
    },
    thin: organic.length > 0 && organic.length < 15,
    empty: items.length === 0,
  };
}

async function oneCall(caseDef, label) {
  const payload = {
    keyword: caseDef.keyword,
    language_code: 'en',
    location_code: caseDef.location_code,
    device: 'desktop',
    os: 'windows',
    depth: 50,
    load_async_ai_overview: false,
    expand_ai_overview: false,
  };
  if (caseDef.use_coord) payload.location_coordinate = caseDef.location_coordinate;

  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify([payload]),
  });
  const data = await res.json();
  const summary = summarisePayload(data, Date.now() - t0);
  summary.label = label;
  summary.case_id = caseDef.id;
  summary.http_status = res.status;
  summary.request_payload = payload;
  return { summary, data };
}

const allSummaries = [];
const rawDump = {};

for (const c of CASES) {
  // 4 rapid repeats to catch thin vs full
  for (let i = 1; i <= 4; i++) {
    const { summary, data } = await oneCall(c, `${c.id}_r${i}`);
    allSummaries.push(summary);
    rawDump[summary.label] = {
      summary,
      // keep result-level only to limit size
      task_data: data?.tasks?.[0]?.data,
      result0: (() => {
        const r = data?.tasks?.[0]?.result?.[0];
        if (!r) return null;
        const { items, ...meta } = r;
        return {
          ...meta,
          items_preview: (items || []).slice(0, 8).map((it) => ({
            type: it.type,
            rank_group: it.rank_group,
            rank_absolute: it.rank_absolute,
            domain: it.domain,
            title: it.title ? String(it.title).slice(0, 80) : null,
          })),
          items_len: (items || []).length,
        };
      })(),
    };
    console.log(JSON.stringify({
      label: summary.label,
      organic: summary.result_meta.organic_count,
      items: summary.result_meta.raw_items_length,
      se_results_count: summary.result_meta.se_results_count,
      items_count: summary.result_meta.items_count,
      thin: summary.thin,
      alan: summary.result_meta.alan_best_rg,
      se_domain: summary.result_meta.se_domain,
      datetime: summary.result_meta.datetime,
      check_url_host: summary.result_meta.check_url
        ? (() => { try { return new URL(summary.result_meta.check_url).host; } catch { return summary.result_meta.check_url; } })()
        : null,
      task_status: summary.task_status_code,
      cost: summary.task_cost,
      ms: summary.ms,
    }));
    await new Promise((r) => setTimeout(r, 800));
  }
}

// Also test: same keyword WITHOUT location_coordinate (Coventry code only)
{
  const c = {
    id: 'classes_near_me_code_only',
    keyword: 'photography classes near me',
    location_code: 9215523,
    use_coord: false,
  };
  for (let i = 1; i <= 3; i++) {
    const { summary, data } = await oneCall(c, `${c.id}_r${i}`);
    allSummaries.push(summary);
    rawDump[summary.label] = { summary, task_data: data?.tasks?.[0]?.data, result0: data?.tasks?.[0]?.result?.[0] ? {
      se_domain: data.tasks[0].result[0].se_domain,
      se_results_count: data.tasks[0].result[0].se_results_count,
      items_count: data.tasks[0].result[0].items_count,
      datetime: data.tasks[0].result[0].datetime,
      check_url: data.tasks[0].result[0].check_url,
      items_len: (data.tasks[0].result[0].items || []).length,
      organic: (data.tasks[0].result[0].items || []).filter((x) => x.type === 'organic').length,
    } : null };
    console.log(JSON.stringify({
      label: summary.label,
      organic: summary.result_meta.organic_count,
      thin: summary.thin,
      alan: summary.result_meta.alan_best_rg,
      se_domain: summary.result_meta.se_domain,
      se_results_count: summary.result_meta.se_results_count,
    }));
    await new Promise((r) => setTimeout(r, 800));
  }
}

// Test: depth 100 vs 50 on gift card if we saw thin
{
  const c = { id: 'gift_card_depth100', keyword: 'photography gift card', location_code: 2826, use_coord: false };
  const payloadExtra = async (depth) => {
    const payload = {
      keyword: c.keyword,
      language_code: 'en',
      location_code: 2826,
      device: 'desktop',
      os: 'windows',
      depth,
      load_async_ai_overview: false,
      expand_ai_overview: false,
    };
    const t0 = Date.now();
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify([payload]),
    });
    const data = await res.json();
    const summary = summarisePayload(data, Date.now() - t0);
    summary.label = `gift_card_depth_${depth}`;
    console.log(JSON.stringify({
      label: summary.label,
      organic: summary.result_meta.organic_count,
      thin: summary.thin,
      alan: summary.result_meta.alan_best_rg,
      se_results_count: summary.result_meta.se_results_count,
      items_count: summary.result_meta.items_count,
    }));
    allSummaries.push(summary);
  };
  await payloadExtra(10);
  await payloadExtra(100);
}

writeFileSync('scripts/output/_dfs-thin-serp-probe.json', JSON.stringify({ allSummaries, rawDump }, null, 2));
console.log('\n=== PATTERN SUMMARY ===');
const thin = allSummaries.filter((s) => s.thin || s.empty);
const full = allSummaries.filter((s) => !s.thin && !s.empty && s.result_meta.organic_count >= 15);
console.log(JSON.stringify({
  total: allSummaries.length,
  thin_or_empty: thin.length,
  full: full.length,
  thin_se_domains: [...new Set(thin.map((s) => s.result_meta.se_domain))],
  full_se_domains: [...new Set(full.map((s) => s.result_meta.se_domain))],
  thin_se_results_count: thin.map((s) => s.result_meta.se_results_count),
  full_se_results_count: full.map((s) => s.result_meta.se_results_count),
  thin_items_count: thin.map((s) => s.result_meta.items_count),
  full_items_count: full.map((s) => s.result_meta.items_count),
  thin_check_hosts: thin.map((s) => {
    try { return s.result_meta.check_url ? new URL(s.result_meta.check_url).host : null; } catch { return null; }
  }),
  full_check_hosts: full.map((s) => {
    try { return s.result_meta.check_url ? new URL(s.result_meta.check_url).host : null; } catch { return null; }
  }),
}, null, 2));
