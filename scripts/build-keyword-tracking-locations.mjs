import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const driveCsv = 'C:/Users/alan/Google Drive/Claude shared resources/07 Data & Exports/keyword-tracking-locations-LOCKED.csv';
const configDir = join(root, 'config');
const configCsv = join(configDir, 'keyword-tracking-locations-LOCKED.csv');
const outJson = join(root, 'lib/keyword-ranking/keyword-tracking-locations-LOCKED.json');

mkdirSync(configDir, { recursive: true });
copyFileSync(driveCsv, configCsv);

function parseLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

const lines = readFileSync(configCsv, 'utf8').trim().split(/\r?\n/);
const byKeyword = {};
for (const line of lines.slice(1)) {
  const r = parseLine(line);
  if (!r[0]) continue;
  const keyword = r[0].trim();
  const k = keyword.toLowerCase();
  byKeyword[k] = {
    keyword,
    tracking_location: (r[1] || '').trim(),
    location_name_dfs: (r[2] || '').trim(),
    target_page: (r[3] || '').trim() || null,
  };
}

writeFileSync(outJson, JSON.stringify({
  source: 'keyword-tracking-locations-LOCKED.csv',
  locked_at: '2026-07-12',
  count: Object.keys(byKeyword).length,
  by_keyword: byKeyword,
}, null, 2) + '\n');

const local = Object.values(byKeyword).filter((x) => x.tracking_location === 'Local').length;
const uk = Object.values(byKeyword).filter((x) => x.tracking_location === 'UK').length;
console.log('wrote', Object.keys(byKeyword).length, 'Local', local, 'UK', uk);
