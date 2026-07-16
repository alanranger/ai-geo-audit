// Refresh SERP/surface data for the 22 new v4 keywords via live refresh-keywords API.
import { config as dotenvConfig } from 'dotenv';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseCsvLine } from '../lib/keyword-ranking/parse-tracking-csv.js';

dotenvConfig({ path: '.env.local' });

const PROPERTY = 'https://www.alanranger.com';
const AUDIT_DATE = '2026-07-14';
const API = 'https://ai-geo-audit.vercel.app/api/aigeo/refresh-keywords';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const v3 = new Set(
  readFileSync(join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v3.csv'), 'utf8')
    .trim().split(/\r?\n/).slice(1)
    .map((l) => parseCsvLine(l)[0].toLowerCase())
);
const neu = readFileSync(join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v4.csv'), 'utf8')
  .trim().split(/\r?\n/).slice(1)
  .map((l) => parseCsvLine(l)[0])
  .filter((k) => k && !v3.has(k.toLowerCase()));

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const results = [];
for (const batch of chunk(neu, 3)) {
  console.error('Refreshing', batch.length, 'keywords…');
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keywords: batch,
      propertyUrl: PROPERTY,
      auditDate: AUDIT_DATE,
      depth: 50,
    }),
  });
  const json = await res.json().catch(() => ({}));
  results.push({
    status: res.status,
    ok: json.status,
    count: json.meta?.keyword_count,
    message: json.message,
    sample: (json.rows || []).slice(0, 2).map((r) => ({
      keyword: r.keyword,
      rank: r.best_rank_absolute,
      local_pack: r.local_pack_position,
      ai: r.has_ai_overview,
    })),
  });
  if (!res.ok) {
    console.error('Batch failed', JSON.stringify(results[results.length - 1], null, 2));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1500));
}

console.log(JSON.stringify({ newKeywords: neu.length, batches: results }, null, 2));
