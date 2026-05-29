/**
 * Capture gsc-subsegment-page-activity-counts via local handler (post-change).
 */
import handler from '../api/aigeo/gsc-subsegment-page-activity-counts.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const outPath = process.argv[2]
  || path.resolve('test/baselines/gsc-subsegment-page-activity-counts-baseline-post-phase5a.json');

const req = {
  method: 'GET',
  query: {
    property: 'https://www.alanranger.com',
    startDate: '2026-04-28',
    endDate: '2026-05-26'
  }
};

const res = {
  _status: 200,
  status(code) { this._status = code; return this; },
  setHeader() { return this; },
  json(body) { this._body = body; this._status = this._status || 200; }
};

await handler(req, res);
const payload = res._body;
if (payload?.status !== 'ok') {
  console.error('Bad response', payload);
  process.exit(1);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const json = JSON.stringify(payload, null, 2);
fs.writeFileSync(outPath, json, 'utf8');
const sha = crypto.createHash('sha256').update(json).digest('hex');

console.log('Wrote', outPath);
console.log('Sample landing:', JSON.stringify(payload.data?.landing));
console.log('SHA256:', sha);
