import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import handler from '../api/aigeo/revenue-funnel-diagnosis.js';

const envFile = path.resolve('.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const req = { method: 'GET', query: { propertyUrl: 'https://www.alanranger.com' } };
const res = {
  status(code) { this._code = code; return this; },
  setHeader() { return this; },
  json(body) { this._body = body; }
};

await handler(req, res);
for (const t of res._body.tier_rollup) {
  console.log(`${t.tier_key}: page_count=${t.page_count} states=${JSON.stringify(t.page_state_counts)}`);
}
console.log('rec:', JSON.stringify(res._body.tier_reconciliation.tier_sum_non_jlr));
