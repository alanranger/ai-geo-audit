/**
 * Compare post-Phase-4 summary KPIs to pre-baseline (zero-regression gate).
 */
import fs from 'node:fs';
import path from 'node:path';
import handler from '../api/aigeo/revenue-funnel-summary.js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const prePath = path.resolve('test/baselines/revenue-funnel-summary-baseline-pre-phase4.json');
const postPath = process.argv[2]
  || path.resolve('test/baselines/revenue-funnel-summary-baseline-post-phase4.json');

const req = { method: 'GET', query: { propertyUrl: 'https://www.alanranger.com' } };
const res = {
  status(code) { this._status = code; return this; },
  setHeader() { return this; },
  send(statusOrBody, body) {
    if (body !== undefined) { this._status = statusOrBody; this._body = body; }
    else this._body = statusOrBody;
  }
};

await handler(req, res);
const post = typeof res._body === 'string' ? JSON.parse(res._body) : res._body;
fs.mkdirSync(path.dirname(postPath), { recursive: true });
fs.writeFileSync(postPath, JSON.stringify(post, null, 2), 'utf8');

const pre = JSON.parse(fs.readFileSync(prePath, 'utf8'));
let mismatches = 0;

console.log('=== Original KPI fields ===');
for (const key of Object.keys(pre.kpis)) {
  const a = pre.kpis[key];
  const b = post.kpis[key];
  const ok = JSON.stringify(a) === JSON.stringify(b);
  console.log(`${ok ? 'OK' : 'FAIL'}  ${key}: pre=${JSON.stringify(a)} post=${JSON.stringify(b)}`);
  if (!ok) mismatches += 1;
}

console.log('\n=== Indexable pairs (expect equal with NULL effective_date) ===');
for (const key of Object.keys(pre.kpis)) {
  const orig = post.kpis[key];
  const idx = post.kpis[`${key}_indexable`];
  const ok = JSON.stringify(orig) === JSON.stringify(idx);
  console.log(`${ok ? 'OK' : 'FAIL'}  ${key}_indexable vs ${key}`);
  if (!ok) mismatches += 1;
}

const rowOk = post.rows_indexable_count === post.rows_total_count;
console.log(`\nrows_total_count=${post.rows_total_count} rows_indexable_count=${post.rows_indexable_count} ${rowOk ? 'OK' : 'FAIL'}`);

const newFields = Object.keys(post).filter((k) => !(k in pre));
console.log('\nNew top-level fields:', newFields.join(', ') || '(none besides kpis expansion)');

process.exit(mismatches === 0 && rowOk ? 0 : 1);
