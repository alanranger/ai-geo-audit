// Parse the "Sales YYYY" target rows from a local Booking Sheet and (with --write) upsert
// public.booking_sheet_sales_targets only. Normal path is the Booking Sheet upload API.
//   node scripts/sales-targets-from-workbook.mjs "<path.xlsm>" [--write]
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import xlsx from 'xlsx';
import { parseSalesTargets, persistSalesTargets } from '../lib/booking-sheet-sales-targets.mjs';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
for (const m of env.matchAll(/^([A-Z0-9_]+)=(.*)$/gm)) {
  if (!process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const file = process.argv[2];
if (!file) throw new Error('usage: sales-targets-from-workbook.mjs <xlsm> [--write]');
const wb = xlsx.read(fs.readFileSync(file), { type: 'buffer', cellDates: true });
const parsed = parseSalesTargets(wb);
for (const r of parsed.rows) {
  console.log(JSON.stringify({ ...r, monthly_target: r.monthly_target.join(','), working_days: r.working_days.join(','), weighting: r.weighting.join(',') }));
}
if (parsed.warnings.length) console.log('warnings:', parsed.warnings);
if (process.argv.includes('--write')) {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log(await persistSalesTargets(sb, 'https://www.alanranger.com', parsed));
}
