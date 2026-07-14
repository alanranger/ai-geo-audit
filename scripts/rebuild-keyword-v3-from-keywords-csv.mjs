/**
 * Rebuild LOCKED v3 CSV to exactly match Keywords.csv (98 rows).
 * Usage: node scripts/rebuild-keyword-v3-from-keywords-csv.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const keywordsPath = join(root, '../alan-shared-resources/csv/Keywords.csv');
const existingCsv = join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v3.csv');
const outCsv = join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v3.csv');
const driveDir = 'C:/Users/alan/Google Drive/Claude shared resources/07 Data & Exports';
const driveCsv = join(driveDir, 'keyword-tracking-locations-and-class-LOCKED-v3.csv');

const NEW_ROWS = {
  'photography course': { tracking: 'Local', locDfs: 'Coventry,England,United Kingdom', cls: 'local-money', target: '/photography-courses-coventry' },
  'photographer near me': { tracking: 'Local', locDfs: 'Coventry,England,United Kingdom', cls: 'local-money', target: '/professional-photographer-near-me' },
  'photographer for hire': { tracking: 'Local', locDfs: 'Coventry,England,United Kingdom', cls: 'local-money', target: '/hire-a-professional-photographer-in-coventry' },
  'basic photography lessons': { tracking: 'Local', locDfs: 'Coventry,England,United Kingdom', cls: 'local-money', target: '/beginners-photography-classes' },
  'photography workshops coventry': { tracking: 'UK', locDfs: 'United Kingdom', cls: 'local-money', target: '/photography-workshops' },
  'photography courses online': { tracking: 'UK', locDfs: 'United Kingdom', cls: 'national-money', target: '/free-online-photography-course' },
  'free photography courses': { tracking: 'UK', locDfs: 'United Kingdom', cls: 'national-money', target: '/free-online-photography-course' },
  'free online photography courses': { tracking: 'UK', locDfs: 'United Kingdom', cls: 'national-money', target: '/free-online-photography-course' },
  'online photography courses uk': { tracking: 'UK', locDfs: 'United Kingdom', cls: 'national-money', target: '/free-online-photography-course' },
  'photography experience gifts': { tracking: 'UK', locDfs: 'United Kingdom', cls: 'national-money', target: '/photography-gift-vouchers' },
  'outdoor photography training': { tracking: 'UK', locDfs: 'United Kingdom', cls: 'national-money', target: '/photography-workshops' },
};

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

function rowToCsv(keyword, tracking, locDfs, cls, target) {
  const loc = locDfs.includes(',') ? `"${locDfs}"` : locDfs;
  return `${keyword},${tracking},${loc},${cls},${target}`;
}

const keywords = readFileSync(keywordsPath, 'utf8')
  .trim()
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

const existing = new Map();
for (const line of readFileSync(existingCsv, 'utf8').trim().split(/\r?\n/).slice(1)) {
  const r = parseLine(line);
  existing.set(r[0].toLowerCase(), r);
}

const out = ['keyword,tracking_location,location_name_dfs,class,target_page'];
const missing = [];

for (const kw of keywords) {
  const key = kw.toLowerCase();
  if (kw === 'alan ranger') {
    out.push(rowToCsv(kw, 'UK', 'United Kingdom', 'brand', '/'));
    continue;
  }
  if (kw === 'alan ranger photography') {
    out.push(rowToCsv(kw, 'UK', 'United Kingdom', 'brand', '/'));
    continue;
  }
  if (kw === 'rps distinctions') {
    out.push(rowToCsv(kw, 'UK', 'United Kingdom', 'national-money', '/rps-courses-mentoring-distinctions'));
    continue;
  }
  if (NEW_ROWS[key]) {
    const { tracking, locDfs, cls, target } = NEW_ROWS[key];
    out.push(rowToCsv(kw, tracking, locDfs, cls, target));
    continue;
  }
  const row = existing.get(key);
  if (!row) {
    missing.push(kw);
    continue;
  }
  out.push(rowToCsv(row[0], row[1], row[2], row[3], row[4]));
}

if (missing.length) {
  console.error('Missing mappings for:', missing);
  process.exit(1);
}

if (out.length - 1 !== keywords.length) {
  console.error('Row count mismatch:', out.length - 1, 'vs', keywords.length);
  process.exit(1);
}

writeFileSync(outCsv, out.join('\n') + '\n');
mkdirSync(driveDir, { recursive: true });
copyFileSync(outCsv, driveCsv);
console.log('✓ Wrote', out.length - 1, 'rows to repo + Drive v3 CSV');

const classes = {};
for (const line of out.slice(1)) {
  const cls = parseLine(line)[3];
  classes[cls] = (classes[cls] || 0) + 1;
}
console.log('Class census:', classes);
