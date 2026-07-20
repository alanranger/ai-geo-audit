/**
 * Part B — live TEST of DFS AI Optimization endpoints (do not build feature yet).
 * Usage: node scripts/test-dfs-aio-endpoints.mjs
 */
import { config } from 'dotenv';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

config({ path: '.env.local' });
const login = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
const password = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;
if (!login || !password) throw new Error('Missing DFS creds');
const auth = Buffer.from(`${login}:${password}`).toString('base64');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'scripts/output');
mkdirSync(outDir, { recursive: true });

async function dfsPost(path, body) {
  const t0 = Date.now();
  const res = await fetch(`https://api.dataforseo.com/v3/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const task = json?.tasks?.[0];
  return {
    path,
    http_ok: res.ok,
    status_code: json?.status_code,
    status_message: json?.status_message,
    task_status: task?.status_code,
    task_message: task?.status_message,
    cost: task?.cost ?? json?.cost ?? null,
    ms: Date.now() - t0,
    result: task?.result ?? null,
    raw_task_data: task?.data ?? null,
  };
}

async function dfsGet(path) {
  const t0 = Date.now();
  const res = await fetch(`https://api.dataforseo.com/v3/${path}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const json = await res.json();
  return {
    path,
    http_ok: res.ok,
    status_code: json?.status_code,
    status_message: json?.status_message,
    cost: json?.cost ?? json?.tasks?.[0]?.cost ?? null,
    ms: Date.now() - t0,
    result: json?.tasks?.[0]?.result ?? json?.tasks ?? json,
  };
}

function trim(obj, max = 4000) {
  const s = JSON.stringify(obj, null, 2);
  return s.length > max ? `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]` : s;
}

const report = { tested_at: new Date().toISOString(), endpoints: [] };

// 1) Models list (platform-specific path — generic llm_responses/models 404s)
console.error('1) chat_gpt/llm_responses models…');
try {
  const models = await dfsGet('ai_optimization/chat_gpt/llm_responses/models');
  report.endpoints.push({
    name: 'chat_gpt/llm_responses/models',
    works: models.status_code === 20000,
    cost: models.cost,
    sample: Array.isArray(models.result)
      ? models.result.slice(0, 15).map((m) => m.llm_name || m.model_name || m)
      : trim(models.result, 1500),
    note: models.status_message,
  });
} catch (e) {
  report.endpoints.push({ name: 'chat_gpt/llm_responses/models', works: false, error: String(e) });
}

// 2) chat_gpt/llm_responses/live — 3 money queries
const prompts = [
  'best online photography courses UK',
  'photography classes coventry',
  'landscape photography workshops uk',
];
console.error('2) chat_gpt/llm_responses/live…');
for (const prompt of prompts) {
  const body = [{
    user_prompt: prompt,
    model_name: 'gpt-4.1-mini',
    max_output_tokens: 1024,
    web_search: true,
    web_search_country_iso_code: 'GB',
  }];
  let r = await dfsPost('ai_optimization/chat_gpt/llm_responses/live', body);
  // fallback model names if rejected
  if (r.task_status && r.task_status !== 20000) {
    for (const model of ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1']) {
      body[0].model_name = model;
      r = await dfsPost('ai_optimization/chat_gpt/llm_responses/live', body);
      if (r.task_status === 20000) break;
    }
  }
  const item = r.result?.[0] || r.result?.[0]?.items?.[0] || r.result;
  const text = JSON.stringify(item || {});
  const citesAlan = /alanranger\.com|alan\s*ranger/i.test(text);
  report.endpoints.push({
    name: 'chat_gpt/llm_responses/live',
    prompt,
    model_tried: body[0].model_name,
    works: r.task_status === 20000 || r.status_code === 20000,
    cost: r.cost,
    cites_or_mentions_alan: citesAlan,
    task_message: r.task_message || r.status_message,
    sample: trim(item, 2500),
  });
}

// 3) search_mentions/live — domain + brand
console.error('3) llm_mentions/search_mentions/live…');
for (const target of [
  { label: 'domain', payload: { domain: 'alanranger.com', search_filter: 'include' } },
  { label: 'brand', payload: { keyword: 'Alan Ranger Photography', search_filter: 'include', search_scope: ['answer', 'question'] } },
]) {
  for (const platform of ['google', 'chat_gpt']) {
    // Docs: chat_gpt mentions = United States (2840) only; google can use UK.
    const location_code = platform === 'chat_gpt' ? 2840 : 2826;
    const body = [{
      language_code: 'en',
      location_code,
      platform,
      target: [target.payload],
      limit: 10,
    }];
    const r = await dfsPost('ai_optimization/llm_mentions/search_mentions/live', body);
    const items = r.result?.[0]?.items || r.result?.[0] || r.result;
    report.endpoints.push({
      name: 'llm_mentions/search_mentions/live',
      target: target.label,
      platform,
      works: r.task_status === 20000 || r.status_code === 20000,
      cost: r.cost,
      items_count: Array.isArray(items) ? items.length : (r.result?.[0]?.items_count ?? null),
      task_message: r.task_message || r.status_message,
      sample: trim(items, 2500),
    });
  }
}

// 4) historical + timeseries + target_metrics (no location_code — use location_name)
console.error('4) historical / timeseries / target_metrics…');
{
  const histBody = [{
    language_code: 'en',
    location_name: 'United Kingdom',
    target: [{ domain: 'alanranger.com', search_filter: 'include' }],
    platform: 'google',
  }];
  const r = await dfsPost('ai_optimization/llm_mentions/historical/live', histBody);
  const items = r.result?.[0]?.items || r.result?.[0] || r.result;
  report.endpoints.push({
    name: 'llm_mentions/historical/live',
    works: r.task_status === 20000,
    cost: r.cost,
    items_count: Array.isArray(items) ? items.length : null,
    task_message: r.task_message || r.status_message,
    sample: trim(items || r.result, 2500),
  });
}
{
  const tsBody = [{
    language_code: 'en',
    location_name: 'United Kingdom',
    target: [{ domain: 'alanranger.com', search_filter: 'include' }],
    platform: 'google',
    date_from: '2025-08-01',
    date_to: '2026-07-01',
    group_by: 'month',
  }];
  const r = await dfsPost('ai_optimization/llm_mentions/timeseries_delta/live', tsBody);
  const items = r.result?.[0]?.items || r.result?.[0] || r.result;
  report.endpoints.push({
    name: 'llm_mentions/timeseries_delta/live',
    works: r.task_status === 20000,
    cost: r.cost,
    items_count: Array.isArray(items) ? items.length : null,
    task_message: r.task_message || r.status_message,
    sample: trim(items || r.result, 2500),
  });
}
{
  const metricsBody = [{
    language_code: 'en',
    location_name: 'United Kingdom',
    target: [{ domain: 'alanranger.com', search_filter: 'include' }],
    platform: 'google',
  }];
  const r = await dfsPost('ai_optimization/llm_mentions/aggregated_metrics/live', metricsBody);
  report.endpoints.push({
    name: 'llm_mentions/aggregated_metrics/live',
    works: r.task_status === 20000,
    cost: r.cost,
    task_message: r.task_message || r.status_message,
    sample: trim(r.result, 2500),
  });
}

// 5) AI keyword search volume
console.error('5) ai_keyword_data/keywords_search_volume/live…');
{
  const body = [{
    language_code: 'en',
    location_code: 2826,
    keywords: [
      'photography classes coventry',
      'photography courses',
      'landscape photography workshops',
      'hire a photographer coventry',
    ],
  }];
  const r = await dfsPost('ai_optimization/ai_keyword_data/keywords_search_volume/live', body);
  report.endpoints.push({
    name: 'ai_keyword_data/keywords_search_volume/live',
    works: r.task_status === 20000 || r.status_code === 20000,
    cost: r.cost,
    task_message: r.task_message || r.status_message,
    sample: trim(r.result, 3000),
  });
}

// 6) top mentioned domains/brands (if cheap)
console.error('6) top_mentioned…');
for (const path of [
  'ai_optimization/llm_mentions/top_mentioned_domains/live',
  'ai_optimization/llm_mentions/top_mentioned_brands/live',
]) {
  const body = [{
    language_code: 'en',
    location_name: 'United Kingdom',
    platform: 'google',
    target: [{ keyword: 'photography courses', search_filter: 'include', search_scope: ['answer', 'question'] }],
    limit: 10,
  }];
  const r = await dfsPost(path, body);
  report.endpoints.push({
    name: path.replace('ai_optimization/', ''),
    works: r.task_status === 20000 || r.status_code === 20000,
    cost: r.cost,
    task_message: r.task_message || r.status_message,
    sample: trim(r.result, 2000),
  });
}

report.total_cost_usd = report.endpoints.reduce((s, e) => s + (Number(e.cost) || 0), 0);
const outPath = join(outDir, 'dfs-aio-endpoint-tests-2026-07-16.json');
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.error('Wrote', outPath, 'total_cost', report.total_cost_usd);
