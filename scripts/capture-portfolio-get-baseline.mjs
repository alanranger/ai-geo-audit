/**
 * Capture get-portfolio-segment-metrics baseline.
 */
import handler from '../api/supabase/get-portfolio-segment-metrics.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const outPath = process.argv[2]
  || path.resolve('test/baselines/get-portfolio-segment-metrics-baseline-pre-phase5b.json');

const toDate = new Date();
const fromDate = new Date();
fromDate.setDate(fromDate.getDate() - 365);

const req = {
  method: 'GET',
  query: {
    siteUrl: 'https://www.alanranger.com',
    segment: 'money',
    scope: 'all_pages',
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    order: 'asc'
  }
};
const res = {
  status(code) { this._status = code; return this; },
  setHeader() { return this; },
  send(_statusOrBody, body) {
    if (body !== undefined) { this._status = _statusOrBody; this._body = body; }
    else this._body = _statusOrBody;
  }
};

await handler(req, res);
const payload = typeof res._body === 'string' ? JSON.parse(res._body) : res._body;
fs.mkdirSync(path.dirname(outPath), { recursive: true });
const json = JSON.stringify(payload, null, 2);
fs.writeFileSync(outPath, json, 'utf8');
const sha = crypto.createHash('sha256').update(json).digest('hex');
console.log('Wrote', outPath);
console.log('count', payload.count);
console.log('sample0', JSON.stringify(payload.metrics?.[0]));
console.log('sample1', JSON.stringify(payload.metrics?.[1]));
console.log('SHA256', sha);
