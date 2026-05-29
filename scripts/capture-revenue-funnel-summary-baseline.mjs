/**
 * Capture revenue-funnel-summary JSON baseline for Phase 4 regression gate.
 */
import handler from '../api/aigeo/revenue-funnel-summary.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const outPath = process.argv[2]
  || path.resolve('test/baselines/revenue-funnel-summary-baseline-pre-phase4.json');

const req = { method: 'GET', query: { propertyUrl: 'https://www.alanranger.com' } };
const res = {
  _status: 200,
  status(code) { this._status = code; return this; },
  setHeader() { return this; },
  send(_statusOrBody, body) {
    if (body !== undefined) { this._status = _statusOrBody; this._body = body; }
    else this._body = _statusOrBody;
  }
};

await handler(req, res);
const payload = typeof res._body === 'string' ? JSON.parse(res._body) : res._body;
if (!payload?.kpis) {
  console.error('No kpis in response', payload?.error);
  process.exit(1);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const json = JSON.stringify(payload, null, 2);
fs.writeFileSync(outPath, json, 'utf8');
const sha = crypto.createHash('sha256').update(json).digest('hex');

console.log('Wrote', outPath);
console.log('KPI keys:', Object.keys(payload.kpis).join(', '));
console.log('KPI values:', JSON.stringify(payload.kpis, null, 2));
console.log('SHA256:', sha);
