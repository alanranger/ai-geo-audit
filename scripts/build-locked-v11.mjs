/**
 * Build LOCKED v11 from v10 (Ruling 3b workshops uncross).
 * Usage: node scripts/build-locked-v11.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = path.join(root, 'config');
const src = path.join(cfg, 'keyword-tracking-locations-and-class-LOCKED-v10.csv');
const dest = path.join(cfg, 'keyword-tracking-locations-and-class-LOCKED-v11.csv');
const drive = 'C:/Users/alan/Google Drive/Claude shared resources/07 Data & Exports';

const map = {
  'photography workshops': '/landscape-photography-workshops',
  'nature photography workshops': '/landscape-photography-workshops',
  'one day photography workshops': '/photography-workshops'
};

function parseLine(line) {
  const parts = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') { q = !q; cur += c; continue; }
    if (c === ',' && !q) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

const text = fs.readFileSync(src, 'utf8').replace(/^\uFEFF/, '');
let n = 0;
const out = text.split(/\r?\n/).map((line) => {
  if (!line || line.startsWith('keyword,')) return line;
  const parts = parseLine(line);
  const kw = parts[0];
  if (!map[kw]) return line;
  n += 1;
  parts[4] = map[kw];
  return parts.join(',');
});

fs.writeFileSync(dest, `${out.join('\n').replace(/\n$/, '')}\n`);
fs.mkdirSync(drive, { recursive: true });
fs.copyFileSync(src, path.join(drive, 'keyword-tracking-locations-and-class-LOCKED-v10.csv'));
fs.copyFileSync(dest, path.join(drive, 'keyword-tracking-locations-and-class-LOCKED-v11.csv'));

const unchanged = [
  'macro photography workshops',
  'photography workshops uk',
  'photography workshops near me'
].map((k) => out.find((l) => l.startsWith(`${k},`)));

console.log(JSON.stringify({
  remapped: n,
  rows: out.filter(Boolean).length - 1,
  samples: Object.keys(map).map((k) => out.find((l) => l.startsWith(`${k},`))),
  unchanged
}, null, 2));
