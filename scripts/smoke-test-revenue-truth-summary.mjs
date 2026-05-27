// Local smoke test for /api/aigeo/revenue-truth-summary.
// Loads env from .env.local and invokes the handler with a mock req/res.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import handler from '../api/aigeo/revenue-truth-summary.js';

const envFile = path.resolve('.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['\"]|['\"]$/g, '');
  }
}

const req = { method: 'GET', query: { propertyUrl: 'https://www.alanranger.com' } };
const res = {
  status(code) { this._code = code; return this; },
  setHeader() { return this; },
  json(body) { this._body = body; }
};

await handler(req, res);

if (res._code !== 200) {
  console.error('FAIL status=' + res._code);
  console.error(JSON.stringify(res._body, null, 2));
  process.exit(1);
}

const p = res._body;
console.log('asOf:', p.asOf);
console.log('config.tierBands:', JSON.stringify(p.config.tierBands));
console.log('config.now:', JSON.stringify(p.config.now));
console.log(`monthly: ${p.monthly.length} rows`);
console.log('  first:', p.monthly[0]);
console.log('  last:', p.monthly[p.monthly.length - 1]);
console.log('yearTotals:', p.yearTotals);
console.log('headlineStrip:', JSON.stringify(p.headlineStrip, null, 2));
console.log(`categoryBreakdown: ${p.categoryBreakdown.length} cells`);
console.log('  sample 2026-04:', p.categoryBreakdown.filter(c => c.year === 2026 && c.month === 4));
console.log(`channelMix: ${p.channelMix.length} rows`);
console.log('  2026-04:', p.channelMix.filter(c => c.year === 2026 && c.month === 4));
console.log(`newVsExisting: ${p.newVsExisting.length} rows`);
console.log('  2026-04:', p.newVsExisting.filter(c => c.year === 2026 && c.month === 4));
console.log(`fundingFees: ${p.fundingFees.length} rows`);
console.log('  2026-04:', p.fundingFees.filter(c => c.year === 2026 && c.month === 4));
console.log(`gpRates: ${p.gpRates.length} rows (year × category)`);
console.log('forecast:', JSON.stringify(p.forecast, null, 2));

// reconcile: sum of monthly headline should equal year totals
let sum2025 = 0;
let sum2026 = 0;
for (const m of p.monthly) {
  if (m.year === 2025) sum2025 += m.headlineRevenue;
  else if (m.year === 2026) sum2026 += m.headlineRevenue;
}
console.log('--- reconciliation ---');
console.log('  sum(monthly 2025) =', sum2025.toFixed(2), '(expect 46572.46)');
console.log('  sum(monthly 2026) =', sum2026.toFixed(2), '(expect 19598.04)');
const ok = Math.abs(sum2025 - 46572.46) < 0.01 && Math.abs(sum2026 - 19598.04) < 0.01;
console.log('  status:', ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
