import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const driveCsv =
  'C:/Users/alan/Google Drive/Claude shared resources/07 Data & Exports/keyword-tracking-locations-and-class-LOCKED-v3.csv';
const configDir = join(root, 'config');
const configCsv = join(configDir, 'keyword-tracking-locations-and-class-LOCKED-v3.csv');
const outJson = join(root, 'lib/keyword-ranking/keyword-tracking-locations-LOCKED.json');
const outClassJson = join(root, 'lib/keyword-ranking/keyword-tracking-class-LOCKED.json');
const outPublic = join(root, 'public/keyword-tracking-locations-LOCKED.json');
const outPublicClass = join(root, 'public/keyword-tracking-class-LOCKED.json');
const outPublicClassJs = join(root, 'public/keyword-tracking-class-LOCKED.js');
const outRoot = join(root, 'keyword-tracking-locations-LOCKED.json');

mkdirSync(configDir, { recursive: true });
copyFileSync(driveCsv, configCsv);

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

const lines = readFileSync(configCsv, 'utf8').trim().split(/\r?\n/);
const byKeyword = {};
const byClass = {};
for (const line of lines.slice(1)) {
  const r = parseLine(line);
  if (!r[0]) continue;
  const keyword = r[0].trim();
  const k = keyword.toLowerCase();
  const tracking_location = (r[1] || '').trim();
  const location_name_dfs = (r[2] || '').trim();
  const keyword_class = (r[3] || '').trim() || null;
  const target_page = (r[4] || '').trim() || null;
  byKeyword[k] = {
    keyword,
    tracking_location,
    location_name_dfs,
    keyword_class,
    target_page,
  };
  byClass[k] = {
    keyword,
    keyword_class,
    tracking_location,
    target_page,
  };
}

const locPayload = {
  source: 'keyword-tracking-locations-and-class-LOCKED-v3.csv',
  locked_at: '2026-07-14',
  count: Object.keys(byKeyword).length,
  by_keyword: byKeyword,
};
const classPayload = {
  source: 'keyword-tracking-locations-and-class-LOCKED-v3.csv',
  locked_at: '2026-07-14',
  count: Object.keys(byClass).length,
  by_keyword: byClass,
};

writeFileSync(outJson, JSON.stringify(locPayload, null, 2) + '\n');
writeFileSync(outClassJson, JSON.stringify(classPayload, null, 2) + '\n');
writeFileSync(outPublic, JSON.stringify(locPayload, null, 2) + '\n');
writeFileSync(outPublicClass, JSON.stringify(classPayload, null, 2) + '\n');
writeFileSync(outRoot, JSON.stringify(locPayload, null, 2) + '\n');

const classByKeyword = {};
for (const [k, row] of Object.entries(byClass)) {
  classByKeyword[k] = row.keyword_class || 'national-money';
}
const classJs =
  'window.__KEYWORD_CLASS_LOCKED_BY_KEYWORD=' +
  JSON.stringify(classByKeyword) +
  ';\n';
writeFileSync(outPublicClassJs, classJs);

const classes = {};
for (const row of Object.values(byClass)) {
  const c = row.keyword_class || 'unset';
  classes[c] = (classes[c] || 0) + 1;
}
const local = Object.values(byKeyword).filter((x) => x.tracking_location === 'Local').length;
const uk = Object.values(byKeyword).filter((x) => x.tracking_location === 'UK').length;
console.log('wrote locations', Object.keys(byKeyword).length, 'Local', local, 'UK', uk);
console.log('classes', classes);
