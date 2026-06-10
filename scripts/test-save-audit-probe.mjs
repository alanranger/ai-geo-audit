/**
 * Local probe for save-audit handler (loads .env.local).
 */
import { readFileSync } from 'node:fs';
import handler from '../api/supabase/save-audit.js';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

const body = {
  propertyUrl: 'https://www.alanranger.com',
  auditDate: '2026-06-10',
  searchData: {
    totalClicks: 7391,
    totalImpressions: 4100697,
    timeseries: [{ date: '2026-06-08', clicks: 268, impressions: 116700, ctr: 0.23, position: 9.6 }]
  },
  scores: { visibility: 83, authority: 45, contentSchema: 100, localEntity: 100, serviceArea: 100 }
};

const res = {
  statusCode: 0,
  headers: {},
  setHeader(k, v) { this.headers[k] = v; },
  status(code) { this.statusCode = code; return this; },
  json(obj) { console.log('STATUS', this.statusCode, JSON.stringify(obj, null, 2).slice(0, 2000)); },
  send(s) { console.log('STATUS', this.statusCode, String(s).slice(0, 2000)); },
  end() { console.log('STATUS', this.statusCode, 'end'); }
};

await handler({ method: 'POST', headers: { 'content-length': String(JSON.stringify(body).length) }, body }, res);
