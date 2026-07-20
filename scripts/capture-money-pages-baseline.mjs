/**
 * Capture money-pages API baselines (historical + timeseries).
 */
import historical from '../api/supabase/money-pages-historical.js';
import timeseries from '../api/supabase/money-pages-timeseries.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const property = 'https://www.alanranger.com';
const target = '/photography-workshops';

async function runHandler(handler, query, outPath) {
  const req = { method: 'GET', query };
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
  console.log('SHA256', sha);
  return { payload, sha };
}

const histPath = process.argv[2]
  || path.resolve('test/baselines/money-pages-historical-baseline-pre-phase5b.json');
const tsPath = process.argv[3]
  || path.resolve('test/baselines/money-pages-timeseries-baseline-pre-phase5b.json');

const hist = await runHandler(historical, {
  property_url: property,
  target_url: target,
  days: '90'
}, histPath);
console.log('historical sample', JSON.stringify(hist.payload?.data));

const ts = await runHandler(timeseries, {
  property_url: property,
  target_url: target,
  days: '28'
}, tsPath);
console.log('timeseries count', ts.payload?.data?.length, 'sample0', JSON.stringify(ts.payload?.data?.[0]));
