// Full Booking Sheet truth import (2024+): category grid, GP, transactions, wide refresh.
//
// Usage:
//   node scripts/import-booking-sheet-truth.mjs --dry-run
//   node scripts/import-booking-sheet-truth.mjs

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { readWorkbookFromBuffer, parseBookingSheetTruth } from '../lib/booking-sheet-truth-parser.mjs';
import { persistBookingSheetTruth } from '../lib/booking-sheet-persist.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = 'G:/Dropbox/alan ranger photography/Website Code/alan-shared-resources/csv/files/Booking_Sheet_2026_-_WITH_PRODUCT_MAPPING.xlsm';
const PROPERTY_URL = 'https://www.alanranger.com';

function loadDotEnv(p) {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
}

function assertVerification(verification) {
  const fails = verification.filter((v) => !v.reconciles);
  if (!fails.length) return;
  throw new Error(fails.map((v) =>
    `${v.sheet}: derived £${v.derivedYearSum} != ${v.ytdActualCell}=£${v.ytdActualValue}`
  ).join('; '));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  loadDotEnv(resolve(__dirname, '..', '.env.local'));

  const buf = readFileSync(SOURCE);
  const parsed = parseBookingSheetTruth(readWorkbookFromBuffer(buf), { propertyUrl: PROPERTY_URL, minYear: 2024 });
  assertVerification(parsed.verification);

  const byYear = {};
  for (const t of parsed.transactionRows) {
    byYear[t.year] = (byYear[t.year] || 0) + 1;
  }
  console.log('tabs:', parsed.verification.map((v) => `${v.sheet} reconciles=${v.reconciles} ytd=£${v.ytdActualValue}`).join(' | '));
  console.log('transactions by year:', byYear);
  console.log('category rows:', parsed.monthlyPerCategory.length, '| gp rows:', parsed.gpPerCategory.length);

  if (dryRun) {
    console.log('dry-run: no DB writes.');
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env.local');

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const written = await persistBookingSheetTruth(supabase, PROPERTY_URL, parsed);
  console.log('import complete:', written);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
