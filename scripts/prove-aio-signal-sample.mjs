/**
 * PROOF — AIO signal on 9 local+national money keywords.
 * Usage: node scripts/prove-aio-signal-sample.mjs
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
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'output');
mkdirSync(outDir, { recursive: true });

const SAMPLE = [
  { keyword: 'photographer coventry', class: 'local-money', intent: 'hire' },
  { keyword: 'hire a photographer coventry', class: 'local-money', intent: 'hire' },
  { keyword: 'commercial photographer coventry', class: 'local-money', intent: 'commercial' },
  { keyword: 'photography classes coventry', class: 'local-money', intent: 'teaching' },
  { keyword: 'photography courses coventry', class: 'local-money', intent: 'teaching' },
  { keyword: 'online photography course', class: 'national-money', intent: 'course' },
  { keyword: 'photography workshops', class: 'national-money', intent: 'workshops' },
  { keyword: 'landscape photography workshops uk', class: 'national-money', intent: 'workshops' },
  { keyword: 'corporate photography training', class: 'national-money', intent: 'training' },
];

async function post(path, body) {
  const t0 = Date.now();
  const res = await fetch(`https://api.dataforseo.com/v3/${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const task = json?.tasks?.[0];
  return {
    path,
    status: json?.status_code,
    task: task?.status_code,
    msg: task?.status_message || json?.status_message,
    cost: Number(task?.cost ?? json?.cost ?? 0) || 0,
    ms: Date.now() - t0,
    result: task?.result ?? null,
  };
}

function citesAlan(text) {
  return /alanranger\.com|alan\s*ranger/i.test(String(text || ''));
}

function extractCitations(result) {
  const blob = JSON.stringify(result || {});
  const domains = new Set();
  const re = /https?:\/\/(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})/gi;
  let m;
  while ((m = re.exec(blob)) !== null) {
    const d = m[1].toLowerCase();
    if (!/dataforseo|openai|googleusercontent|gstatic|youtube\.com\/watch/i.test(d)) {
      domains.add(d);
    }
  }
  return [...domains].slice(0, 12);
}

let totalCost = 0;
const rows = SAMPLE.map((s) => ({ ...s }));

// 1) AI search volume — one batch
console.error('1) AI keyword volumes…');
{
  const r = await post('ai_optimization/ai_keyword_data/keywords_search_volume/live', [{
    language_code: 'en',
    location_code: 2826,
    keywords: SAMPLE.map((s) => s.keyword),
  }]);
  totalCost += r.cost;
  const items = r.result?.[0]?.items || [];
  const byKw = new Map(items.map((it) => [String(it.keyword || '').toLowerCase(), it]));
  for (const row of rows) {
    const it = byKw.get(row.keyword.toLowerCase());
    row.ai_search_volume = it?.ai_search_volume ?? null;
    row.ai_volume_ok = r.task === 20000;
  }
  console.error('  cost', r.cost, 'status', r.task, r.msg);
}

// 2) Mentions — domain + keyword together (google UK)
console.error('2) search_mentions domain+keyword…');
for (const row of rows) {
  const r = await post('ai_optimization/llm_mentions/search_mentions/live', [{
    language_code: 'en',
    location_code: 2826,
    platform: 'google',
    target: [
      { domain: 'alanranger.com', search_filter: 'include', include_subdomains: true },
      { keyword: row.keyword, search_filter: 'include', search_scope: ['any'], match_type: 'partial_match' },
    ],
    limit: 20,
  }]);
  totalCost += r.cost;
  const items = r.result?.[0]?.items || [];
  const itemsCount = r.result?.[0]?.items_count ?? items.length;
  let mentionHits = 0;
  let citationHits = 0;
  for (const it of items) {
    const blob = JSON.stringify(it);
    if (/alanranger\.com/i.test(blob)) {
      mentionHits += 1;
      if (/alanranger\.com/i.test(JSON.stringify(it.sources || it.references || []))
        || /\[\[\d+\]\]\(https?:\/\/(?:www\.)?alanranger\.com/i.test(blob)
        || /https?:\/\/(?:www\.)?alanranger\.com/i.test(blob)) {
        citationHits += 1;
      }
    }
  }
  row.mentions_items = itemsCount;
  row.domain_mentioned = mentionHits > 0 || (/alanranger\.com/i.test(JSON.stringify(items)) && items.length > 0);
  row.domain_cited = citationHits > 0 || (row.domain_mentioned && /alanranger\.com/i.test(JSON.stringify(items)));
  row.mentions_cost = r.cost;
  row.mentions_ok = r.task === 20000;
  row.mentions_msg = r.msg;
  // If AND of domain+keyword returns empty, try domain-only and scan answers for keyword (secondary)
  if (items.length === 0 && r.task === 20000) {
    row.domain_mentioned = false;
    row.domain_cited = false;
  }
  console.error(`  ${row.keyword}: items=${itemsCount} mentioned=${row.domain_mentioned} cost=${r.cost}`);
}

// 3) ChatGPT live responses
console.error('3) chat_gpt llm_responses…');
for (const row of rows) {
  const r = await post('ai_optimization/chat_gpt/llm_responses/live', [{
    user_prompt: row.keyword,
    model_name: 'gpt-4o-mini',
    max_output_tokens: 1024,
    web_search: true,
    web_search_country_iso_code: 'GB',
  }]);
  totalCost += r.cost;
  const result = r.result;
  const text = JSON.stringify(result || {});
  row.chatgpt_ok = r.task === 20000;
  row.chatgpt_cost = r.cost;
  row.chatgpt_msg = r.msg;
  row.named_in_chatgpt = citesAlan(text);
  row.cited_instead = extractCitations(result).filter((d) => !/alanranger/i.test(d)).slice(0, 8);
  // short answer preview
  const msg = result?.[0]?.items?.find((i) => i.type === 'message')
    || result?.[0]?.items?.[0];
  const preview = msg?.sections?.map((s) => s.text).filter(Boolean).join(' ')
    || msg?.text
    || '';
  row.chatgpt_preview = String(preview).slice(0, 280);
  console.error(`  ${row.keyword}: named=${row.named_in_chatgpt} cost=${r.cost} instead=${row.cited_instead.slice(0, 3).join(',')}`);
}

const report = {
  tested_at: new Date().toISOString(),
  total_cost_usd: Math.round(totalCost * 1000) / 1000,
  rows,
};

writeFileSync(join(outDir, 'prove-aio-signal-sample-2026-07-16.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
