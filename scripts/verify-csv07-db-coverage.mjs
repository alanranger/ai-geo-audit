import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const csvPath = path.join(root, '../alan-shared-resources/csv/07-url-target-keywords-seospace.csv');
const v2Path = path.join(root, 'config/07-url-target-keywords-v2.csv');

function pathKey(u) {
  try {
    const url = new URL(u.startsWith('http') ? u : `https://www.alanranger.com${u}`);
    let p = (url.pathname || '/').toLowerCase();
    if (p.length > 1) p = p.replace(/\/+$/, '');
    return p || '/';
  } catch {
    return String(u || '').toLowerCase();
  }
}

function parseUrls(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const rows = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        q = !q;
        continue;
      }
      if (c === ',' && !q) {
        cols.push(cur);
        cur = '';
        continue;
      }
      cur += c;
    }
    cols.push(cur);
    rows.push((cols[0] || '').trim());
  }
  return rows;
}

const csv = parseUrls(fs.readFileSync(csvPath, 'utf8'));
const v2 = parseUrls(fs.readFileSync(v2Path, 'utf8'));
const db = new Set(v2.map(pathKey));
const missing = csv.filter((u) => !db.has(pathKey(u)));
console.log(JSON.stringify({
  csv: csv.length,
  v2: v2.length,
  missing: missing.length,
  sampleMissing: missing.slice(0, 8)
}, null, 2));
