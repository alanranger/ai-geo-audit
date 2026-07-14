import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const keywordsPath = join(root, '../alan-shared-resources/csv/Keywords.csv');
const kws = readFileSync(keywordsPath, 'utf8')
  .trim()
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

writeFileSync(join(root, 'scripts/output/target-keywords-98.json'), JSON.stringify(kws, null, 2) + '\n');
writeFileSync(
  join(root, 'public/tracked-keywords-fallback.json'),
  JSON.stringify({ keywords: kws }, null, 2) + '\n'
);
console.log('wrote', kws.length, 'keywords to fallback + output JSON');
