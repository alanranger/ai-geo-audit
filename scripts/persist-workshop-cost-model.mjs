/**
 * Parse Workshop Costs from the Booking Sheet and upsert booking_sheet_workshop_cost_model.
 * node scripts/persist-workshop-cost-model.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import xlsx from 'xlsx';
import { parseWorkshopCosts, persistWorkshopCostModel } from '../lib/booking-sheet-workshop-costs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['.env.vercel.prod', '.env.local']) {
  const p = resolve(root, name);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const val = m[2].replace(/^["']|["']$/g, '');
    if (!process.env[m[1]] || val.startsWith('sb_')) process.env[m[1]] = val;
  }
}

const sheet = resolve(root, 'Docs/Booking Sheet 2026 - Alan Ranger Photography.xlsm');
const wb = xlsx.readFile(sheet, { cellDates: true });
const model = parseWorkshopCosts(wb);
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});
const r = await persistWorkshopCostModel(sb, 'https://www.alanranger.com', model);
console.log(JSON.stringify({
  r,
  dayNet: model.dayNetByClients,
  resNet: model.resNetByClients,
  locations: (model.locations || []).length
}, null, 2));
