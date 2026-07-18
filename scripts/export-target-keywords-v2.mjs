/**
 * Export 07-url-target-keywords-v2.csv from curated DB dump + LOCKED-151.
 * Usage: node scripts/export-target-keywords-v2.mjs
 * (Reads scripts/output/target-keyword-master-35.json produced alongside this build.)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const masterPath = path.join(root, 'scripts/output/target-keyword-master-35.json');
const lockedPath = path.join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v4.csv');
const outRepo = path.join(
  root,
  '../alan-shared-resources/csv/07-url-target-keywords-v2.csv'
);
const outAudit = path.join(root, 'config/07-url-target-keywords-v2.csv');
const outDrive = path.join(
  'C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude/07-url-target-keywords-v2.csv'
);

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
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
    const o = {};
    headers.forEach((h, i) => {
      o[h] = (cols[i] || '').trim();
    });
    return o;
  });
}

function esc(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const master = JSON.parse(fs.readFileSync(masterPath, 'utf8'));
const locked = parseCsv(fs.readFileSync(lockedPath, 'utf8'));
const lockedByKw = new Map();
for (const r of locked) {
  lockedByKw.set(String(r.keyword || '').toLowerCase(), r);
}

const header = [
  'url',
  'target_keyword',
  'target_class',
  'keyword_class',
  'tracked_in_151',
  'notes'
];
const lines = [header.join(',')];
for (const row of master) {
  const kw = String(row.target_keyword || '').trim();
  const hit = kw ? lockedByKw.get(kw.toLowerCase()) : null;
  lines.push(
    [
      esc(row.url),
      esc(kw),
      esc(row.target_class || ''),
      esc(hit?.class || ''),
      esc(hit ? 'Y' : 'N'),
      esc(row.notes || '')
    ].join(',')
  );
}
const body = `${lines.join('\n')}\n`;

for (const p of [outRepo, outAudit, outDrive]) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, 'utf8');
  console.log('wrote', p, master.length, 'rows');
}
