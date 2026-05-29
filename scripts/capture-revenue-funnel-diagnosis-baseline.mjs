/**
 * Capture revenue-funnel-diagnosis JSON baseline for Phase 3 regression gate.
 * Usage: node scripts/capture-revenue-funnel-diagnosis-baseline.mjs [outPath]
 */
import handler from '../api/aigeo/revenue-funnel-diagnosis.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const outPath = process.argv[2]
  || path.resolve('test/baselines/revenue-funnel-diagnosis-baseline-pre-phase3.json');

const req = {
  method: 'GET',
  query: { propertyUrl: 'https://www.alanranger.com', windowMonths: 12, includeAllPages: 'true' }
};
const res = {
  status() { return this; },
  setHeader() { return this; },
  json(body) { this._body = body; }
};

await handler(req, res);
if (!res._body?.diagnostics) {
  console.error('Handler did not return diagnostics');
  process.exit(1);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const json = JSON.stringify(res._body, null, 2);
fs.writeFileSync(outPath, json, 'utf8');
const sha = crypto.createHash('sha256').update(json).digest('hex');
console.log('Wrote', outPath);
console.log('Diagnostics rows:', res._body.diagnostics.length);
console.log('First 3 rows:', JSON.stringify(res._body.diagnostics.slice(0, 3), null, 2));
console.log('SHA256:', sha);
