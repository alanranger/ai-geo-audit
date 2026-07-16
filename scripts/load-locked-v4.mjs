// Load LOCKED-v4 into repo files + Supabase keywordTrackingLocked + keyword_rankings stubs.
// Usage: node scripts/load-locked-v4.mjs

import { config as dotenvConfig } from 'dotenv';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import handler from '../api/keywords/save-csv.js';

dotenvConfig({ path: '.env.local' });
dotenvConfig({ path: '.env' });

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const csvPath = join(root, 'config/keyword-tracking-locations-and-class-LOCKED-v4.csv');
const csv = readFileSync(csvPath, 'utf8');

const res = {
  headers: {},
  setHeader(k, v) { this.headers[k] = v; },
  status(c) { this.statusCode = c; return this; },
  send(b) { this.body = b; },
  end(b) { this.body = b; },
  json(b) { this.body = JSON.stringify(b); return this; },
};

await handler(
  { method: 'POST', body: { csv, replaceAll: true, writeFiles: true, version: 'v4' } },
  res
);

const out = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
console.log(JSON.stringify({
  statusCode: res.statusCode,
  status: out.status,
  format: out.format,
  added: out.added,
  updated: out.updated,
  unmapped: out.unmapped,
  census: out.census,
  keywordRowsInserted: out.keywordRowsInserted,
  keywordRowsPatched: out.keywordRowsPatched,
  filesWritten: out.filesWritten,
  error: out.message,
}, null, 2));

if (res.statusCode >= 400 || out.status !== 'ok') process.exit(1);
