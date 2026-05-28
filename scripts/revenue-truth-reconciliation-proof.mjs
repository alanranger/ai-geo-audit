// Prints tier reconciliation vs booking-sheet non-JLR targets (penny-exact gate).
import handler from '../api/aigeo/revenue-funnel-diagnosis.js';
import { BOOKING_SHEET_NON_JLR_TARGETS } from '../lib/revenue-tier-mapping.js';
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const envFile = path.resolve('.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const req = { method: 'GET', query: { propertyUrl: 'https://www.alanranger.com', windowMonths: 12 } };
const res = {
  status() { return this; },
  setHeader() { return this; },
  json(body) { this._body = body; }
};

await handler(req, res);
const rec = res._body?.tier_reconciliation;
if (!rec) {
  console.error('No tier_reconciliation in response');
  process.exit(1);
}

const fmt = (n) => '£' + Number(n).toFixed(2);
const targets = BOOKING_SHEET_NON_JLR_TARGETS;
const sums = rec.tier_sum_non_jlr || {};
const delta = rec.delta_vs_targets || {};
console.log('=== Revenue Truth tier reconciliation (non-JLR) ===');
console.log('Target 2024:      ', fmt(targets.y2024));
console.log('Computed 2024:    ', fmt(sums.y2024));
console.log('Delta 2024:       ', fmt(delta.y2024 ?? 0));
console.log('Target 2025:      ', fmt(targets.y2025));
console.log('Computed 2025:    ', fmt(sums.y2025));
console.log('Delta 2025:       ', fmt(delta.y2025 ?? 0));
console.log('Target 2026 YTD:  ', fmt(targets.y2026_ytd));
console.log('Computed 2026 YTD:', fmt(sums.y2026_ytd));
console.log('Delta 2026 YTD:   ', fmt(delta.y2026_ytd ?? 0));
console.log('PASS:', rec.passes ? 'YES — penny-exact' : 'NO — FAIL');
process.exit(rec.passes ? 0 : 1);
