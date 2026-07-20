/**
 * Compare pre/post Phase 5b baselines — original fields must match exactly.
 */
import fs from 'node:fs';
import path from 'node:path';

const api = process.argv[2];
if (!api) {
  console.error('Usage: node scripts/compare-phase5b-baseline.mjs <api-basename>');
  process.exit(1);
}

const prePath = path.resolve(`test/baselines/${api}-baseline-pre-phase5b.json`);
const postPath = path.resolve(`test/baselines/${api}-baseline-post-phase5b.json`);
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
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => added.push(...listNewKeys(item, `${prefix}[${i}]`)));
    return added;
  }
  for (const [key, val] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${key}` : key;
    if (isNewKey(key)) added.push(p);
    else if (val && typeof val === 'object') added.push(...listNewKeys(val, p));
  }
  return added;
}

const mismatches = [];
if (api.startsWith('get-portfolio-segment-metrics')) {
  compareObjects('count', pre.count, post.count, mismatches);
  compareObjects('metrics', pre.metrics, post.metrics, mismatches);
} else if (api.startsWith('money-pages-timeseries')) {
  compareObjects('status', pre.status, post.status, mismatches);
  compareObjects('data', pre.data, post.data, mismatches);
  compareObjects('message', pre.message, post.message, mismatches);
} else {
  compareObjects('status', pre.status, post.status, mismatches);
  compareObjects('data', pre.data, post.data, mismatches);
  compareObjects('audit_date', pre.audit_date, post.audit_date, mismatches);
  compareObjects('message', pre.message, post.message, mismatches);
}

console.log(`API: ${api}`);
console.log('Original-field mismatches:', mismatches.length);
mismatches.slice(0, 20).forEach((m) => console.log('  MISMATCH', m));

const newFields = listNewKeys(post);
console.log('New fields added:', [...new Set(newFields)].slice(0, 40).join(', ') || '(none)');

process.exit(mismatches.length ? 1 : 0);
