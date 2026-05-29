/**
 * Capture aggregate-page-metrics baseline against live Supabase.
 */
import handler from '../api/portfolio/aggregate-page-metrics.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const outPath = process.argv[2]
  || path.resolve('test/baselines/aggregate-page-metrics-baseline-pre-phase5a.json');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const siteUrl = 'https://www.alanranger.com';
const { data: latest } = await sb
  .from('gsc_page_metrics_28d')
  .select('run_id, date_start, date_end')
  .eq('site_url', siteUrl)
  .order('date_end', { ascending: false })
  .limit(1);

const row = latest?.[0];
if (!row) {
  console.error('No gsc_page_metrics_28d rows');
  process.exit(1);
}

const req = {
  method: 'POST',
  body: {
    runId: row.run_id,
    siteUrl,
    dateStart: row.date_start,
    dateEnd: row.date_end
  }
};
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
if (!payload?.segments) {
  console.error('No segments in response', payload?.error || payload);
  process.exit(1);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const json = JSON.stringify(payload, null, 2);
fs.writeFileSync(outPath, json, 'utf8');
const sha = crypto.createHash('sha256').update(json).digest('hex');
const segKeys = Object.keys(payload.segments);

console.log('Wrote', outPath);
console.log('runId', row.run_id, 'dateEnd', row.date_end);
console.log('Segment groups:', segKeys.length, segKeys.join(', '));
console.log('Sample money:', JSON.stringify(payload.segments?.money));
console.log('Sample event:', JSON.stringify(payload.segments?.event));
console.log('pageCount:', payload.pageCount);
console.log('SHA256:', sha);
