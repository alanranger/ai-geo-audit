#!/usr/bin/env node
/**
 * Head-to-head: organic-parse vs maps vs local_finder at GBP centroid.
 * Usage: node scripts/_tmp-compare-maps-vs-organic.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTBOX =
  'C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude';
const COORD = '52.3991769,-1.5937149,14z';
const LOCATION_CODE = 9215523;
const OUR_CID = '18051522973347696510';
const OUR_BRAND = /alan\s*ranger/i;

const KEYWORDS = [
  'photographer coventry',
  'photographer in coventry',
  'photography classes coventry',
  'commercial photographer coventry',
];

const ENDPOINTS = {
  organic: 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
  maps: 'https://api.dataforseo.com/v3/serp/google/maps/live/advanced',
  local_finder: 'https://api.dataforseo.com/v3/serp/google/local_finder/live/advanced',
};

for (const envFile of ['.env.local', '.env']) {
  const p = join(ROOT, envFile);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

const login = process.env.DATAFORSEO_API_LOGIN || process.env.DATAFORSEO_LOGIN;
const password = process.env.DATAFORSEO_API_PASSWORD || process.env.DATAFORSEO_PASSWORD;
if (!login || !password) {
  console.error('Missing DFS credentials');
  process.exit(1);
}
const auth = Buffer.from(`${login}:${password}`).toString('base64');

function isOurs(row) {
  const cid = row?.cid != null ? String(row.cid) : '';
  if (cid && cid === OUR_CID) return true;
  const title = row?.title || '';
  const domain = row?.domain || row?.url || '';
  return OUR_BRAND.test(title) || /alanranger\.com/i.test(domain);
}

function posOf(row) {
  const p = row?.rank_group ?? row?.rank_absolute;
  return Number.isFinite(Number(p)) ? Number(p) : null;
}

function topRows(items, limit = 3) {
  return (items || [])
    .filter((it) => it && (it.title || it.domain))
    .slice(0, limit)
    .map((it) => ({
      title: it.title || null,
      domain: it.domain || it.url || null,
      rank_group: it.rank_group ?? null,
      cid: it.cid != null ? String(it.cid) : null,
    }));
}

function parseOrganic(items) {
  const pack = (items || []).filter((it) => it?.type === 'local_pack');
  const organic = (items || []).filter((it) => it?.type === 'organic');
  let alanPack = null;
  for (const row of pack) {
    if (isOurs(row)) {
      alanPack = posOf(row);
      break;
    }
  }
  let alanOrganic = null;
  for (const row of organic) {
    if (isOurs(row)) {
      alanOrganic = posOf(row);
      break;
    }
  }
  return {
    alan_pack_position: pack.length ? (alanPack ?? 'ABSENT') : 'NO_PACK',
    alan_organic_position: alanOrganic,
    pack_top: topRows(pack),
    item_types: [...new Set((items || []).map((it) => it?.type).filter(Boolean))],
  };
}

function parseMapsOrFinder(items) {
  const list = items || [];
  let alanPos = null;
  for (const row of list) {
    if (isOurs(row)) {
      alanPos = posOf(row);
      break;
    }
  }
  return {
    alan_pack_position: list.length ? (alanPos ?? 'ABSENT') : 'NO_RESULTS',
    pack_top: topRows(list),
    item_types: [...new Set(list.map((it) => it?.type).filter(Boolean))],
    result_count: list.length,
  };
}

function buildPayload(endpointKey, keyword) {
  const base = {
    keyword,
    language_code: 'en',
    device: 'desktop',
    os: 'windows',
    location_coordinate: COORD,
    location_code: LOCATION_CODE,
  };
  if (endpointKey === 'organic') {
    return { ...base, depth: 50 };
  }
  if (endpointKey === 'maps') {
    return { ...base, depth: 20 };
  }
  return { ...base, depth: 20 };
}

async function dfsPost(url, payload) {
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify([payload]),
  });
  const data = await res.json();
  const task = data?.tasks?.[0];
  const result = task?.result?.[0];
  return {
    ok: res.ok && String(data?.status_code).startsWith('2'),
    ms: Date.now() - started,
    cost: task?.cost ?? null,
    status_code: task?.status_code,
    status_message: task?.status_message,
    items: result?.items || [],
    item_types: result?.item_types || [],
    check_url: result?.check_url || null,
  };
}

async function main() {
  const runs = [];
  let totalCost = 0;
  for (const keyword of KEYWORDS) {
    for (const [key, url] of Object.entries(ENDPOINTS)) {
      const payload = buildPayload(key, keyword);
      const raw = await dfsPost(url, payload);
      if (raw.cost != null) totalCost += Number(raw.cost);
      const parsed =
        key === 'organic'
          ? parseOrganic(raw.items)
          : parseMapsOrFinder(raw.items);
      runs.push({
        keyword,
        endpoint: key,
        cost: raw.cost,
        ms: raw.ms,
        status_code: raw.status_code,
        status_message: raw.status_message,
        ...parsed,
        dfs_item_types: raw.item_types,
      });
      console.log(
        `${keyword} | ${key} | alan=${parsed.alan_pack_position} | cost=${raw.cost} | items=${parsed.result_count ?? raw.items.length}`
      );
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  const out = {
    meta: {
      coord: COORD,
      location_code: LOCATION_CODE,
      keywords: KEYWORDS,
      endpoints: Object.keys(ENDPOINTS),
      total_cost_usd: totalCost,
      run_at: new Date().toISOString(),
    },
    runs,
  };
  const outPath = join(OUTBOX, 'PROOF-2026-07-16-maps-vs-organic-compare-LATEST.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`Total cost: $${totalCost.toFixed(4)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
