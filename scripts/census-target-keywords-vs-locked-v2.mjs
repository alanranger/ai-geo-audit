/**
 * Census: every active targetKeyword must resolve in the locked v2 class/location CSV.
 * Usage: node scripts/census-target-keywords-vs-locked-v2.mjs
 * Pass keywords JSON via TARGET_KEYWORDS_JSON env, or defaults to reading from stdin path arg.
 */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const csvPath = join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v2.csv');

function parseLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      q = !q;
      continue;
    }
    if (c === ',' && !q) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function norm(k) {
  return String(k || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const lines = readFileSync(csvPath, 'utf8').trim().split(/\r?\n/).slice(1);
const csvKeys = new Set();
for (const line of lines) {
  const r = parseLine(line);
  if (r[0]) csvKeys.add(norm(r[0]));
}

  const keywordsPath = process.argv[2];
  let keywords;
  if (keywordsPath) {
    const raw = readFileSync(keywordsPath, 'utf8').replace(/^\uFEFF/, '');
    keywords = JSON.parse(raw);
} else if (process.env.TARGET_KEYWORDS_JSON) {
  keywords = JSON.parse(process.env.TARGET_KEYWORDS_JSON);
} else {
  console.error('Pass keywords JSON path as argv[2] or TARGET_KEYWORDS_JSON');
  process.exit(1);
}

const missing = [];
for (const kw of keywords) {
  if (!csvKeys.has(norm(kw))) missing.push(kw);
}

const report = {
  csv_count: csvKeys.size,
  active_count: keywords.length,
  missing_count: missing.length,
  missing,
};
const out = join(root, 'scripts/output/census-target-vs-locked-v2.json');
writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (missing.length) process.exitCode = 2;
