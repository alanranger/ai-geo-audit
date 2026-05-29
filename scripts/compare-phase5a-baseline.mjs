/**
 * Compare pre/post Phase 5a baselines — original fields must match exactly.
 */
import fs from 'node:fs';
import path from 'node:path';

const api = process.argv[2];
if (!api) {
  console.error('Usage: node scripts/compare-phase5a-baseline.mjs <api-basename>');
  process.exit(1);
}

const prePath = path.resolve(`test/baselines/${api}-baseline-pre-phase5a.json`);
const postPath = path.resolve(`test/baselines/${api}-baseline-post-phase5a.json`);
const pre = JSON.parse(fs.readFileSync(prePath, 'utf8'));
const post = JSON.parse(fs.readFileSync(postPath, 'utf8'));

const INDEXABLE_SUFFIX = '_indexable';
const ROW_KEYS = new Set(['rows_total_count', 'rows_indexable_count']);

function isNewKey(key) {
  return key.endsWith(INDEXABLE_SUFFIX) || ROW_KEYS.has(key);
}

function compareObjects(label, a, b, mismatches) {
  if (a === b) return;
  if (typeof a !== typeof b) {
    mismatches.push(`${label}: type ${typeof a} vs ${typeof b}`);
    return;
  }
  if (a == null || b == null || typeof a !== 'object') {
    if (a !== b) mismatches.push(`${label}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      mismatches.push(`${label}: array length or type mismatch`);
      return;
    }
    a.forEach((_, i) => compareObjects(`${label}[${i}]`, a[i], b[i], mismatches));
    return;
  }
  for (const key of Object.keys(a)) {
    if (isNewKey(key)) continue;
    if (!(key in b)) mismatches.push(`${label}.${key}: missing in post`);
    else compareObjects(`${label}.${key}`, a[key], b[key], mismatches);
  }
}

function listNewKeys(obj, prefix = '') {
  const added = [];
  if (!obj || typeof obj !== 'object') return added;
  for (const [key, val] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${key}` : key;
    if (isNewKey(key)) added.push(p);
    else if (val && typeof val === 'object' && !Array.isArray(val)) added.push(...listNewKeys(val, p));
  }
  return added;
}

const mismatches = [];
if (api.startsWith('gsc-subsegment')) {
  compareObjects('data', pre.data, post.data, mismatches);
  compareObjects('params', pre.params, post.params, mismatches);
} else {
  compareObjects('segments', pre.segments, post.segments, mismatches);
  compareObjects('pageCount', pre.pageCount, post.pageCount, mismatches);
}

console.log(`API: ${api}`);
console.log('Original-field mismatches:', mismatches.length);
mismatches.slice(0, 20).forEach((m) => console.log('  MISMATCH', m));

const root = api.startsWith('gsc-subsegment') ? post.data : post.segments;
const newFields = listNewKeys(root);
console.log('New fields added:', newFields.join(', ') || '(none)');

if (api.startsWith('gsc-subsegment')) {
  for (const seg of Object.keys(post.data || {})) {
    const row = post.data[seg];
    for (const key of ['clickPages', 'impressionPages']) {
      const idx = `${key}_indexable`;
      if (row[idx] !== row[key]) {
        console.log(`WARN ${seg}.${idx} (${row[idx]}) !== ${key} (${row[key]})`);
      }
    }
    if (row.rows_indexable_count !== row.rows_total_count) {
      console.log(`WARN ${seg} rows mismatch`, row.rows_total_count, row.rows_indexable_count);
    }
  }
} else {
  for (const seg of Object.keys(post.segments || {})) {
    const row = post.segments[seg];
    for (const key of Object.keys(row)) {
      if (key.endsWith('_indexable')) continue;
      if (ROW_KEYS.has(key)) continue;
      if (typeof row[key] === 'number' || row[key] == null) {
        const idx = `${key}_indexable`;
        if (idx in row && row[idx] !== row[key]) {
          console.log(`WARN ${seg}.${idx} (${row[idx]}) !== ${key} (${row[key]})`);
        }
      }
    }
    if (row.rows_indexable_count !== row.rows_total_count) {
      console.log(`WARN ${seg} rows mismatch`, row.rows_total_count, row.rows_indexable_count);
    }
  }
}

process.exit(mismatches.length ? 1 : 0);
