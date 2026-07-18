/**
 * KE UK volumes for tracked-set candidates (parallel data task, Stage 1 brief).
 * Keywords: residential photography workshops, portrait photography course
 */
import { config as loadEnv } from 'dotenv';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: join(root, '.env') });
loadEnv({ path: join(root, '.env.local'), override: true });

const apiKey = String(process.env.KEYWORDS_EVERYWHERE_API_KEY || '').trim();
if (!apiKey) {
  console.error('Missing KEYWORDS_EVERYWHERE_API_KEY');
  process.exit(1);
}

const KEYWORDS = [
  'residential photography workshops',
  'portrait photography course',
  'portrait photography courses',
  'residential photography workshop',
  'photography holidays uk'
];

const BASE_URL = 'https://api.keywordseverywhere.com/v1/get_keyword_data';

async function fetchBatch(keywords) {
  const form = new URLSearchParams();
  form.set('country', 'gb');
  form.set('currency', 'GBP');
  form.set('dataSource', 'gkp');
  keywords.forEach((kw) => form.append('kw[]', kw));
  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      Authorization: `Bearer ${apiKey}`
    },
    body: form.toString()
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { _parseError: true, text: text.slice(0, 200) };
  }
  if (!res.ok) throw new Error(`KE ${res.status}: ${json?.message || text.slice(0, 200)}`);
  const data = json?.data;
  const items = Array.isArray(data) ? data : data && typeof data === 'object' ? Object.values(data) : [];
  return items;
}

const items = await fetchBatch(KEYWORDS);
const rows = KEYWORDS.map((kw) => {
  const hit = items.find((i) => String(i.keyword || i.kw || '').toLowerCase() === kw.toLowerCase());
  return {
    keyword: kw,
    volume: hit?.vol ?? hit?.volume ?? null,
    cpc: hit?.cpc?.value ?? hit?.cpc ?? null,
    competition: hit?.competition ?? null,
    trend: hit?.trend ?? null
  };
});

const outDir = join(root, 'scripts/output');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'ke-tracked-set-candidates-2026-07-18.json');
writeFileSync(outPath, JSON.stringify({ fetched_at: new Date().toISOString(), country: 'gb', rows }, null, 2));
console.log(JSON.stringify(rows, null, 2));
console.log('wrote', outPath);
