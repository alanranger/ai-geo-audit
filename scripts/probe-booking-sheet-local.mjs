// Local dry-run of the booking-sheet importer using the updated parser.
// Shows: how many rows we now skip vs include, by funding, and the new
// per-tier 2026 YTD totals so we can confirm the Pick n Mix dedup
// landed exactly as expected before pushing.

import { readFileSync } from 'node:fs';
import { readWorkbookFromBuffer, parseBookingSheet } from '../lib/booking-sheet-parser.mjs';

const SHEET = 'G:\\Dropbox\\1. Bookings\\Booking Sheet 2026 - Alan Ranger Photography.xlsm';
const wb = readWorkbookFromBuffer(readFileSync(SHEET));
const { records, skipReasons, byMonth } = parseBookingSheet(wb, { years: [2026] });

console.log(`Parsed ${records.length} eligible 2026 rows.`);
console.log('Skip reasons:', skipReasons);

const fundingTotals = {};
for (const r of records) fundingTotals[r.funding] = (fundingTotals[r.funding] || 0) + r.amount;
console.log('\nIncluded rows by funding (after PicknMix exclusion):');
for (const [k, v] of Object.entries(fundingTotals)) console.log(`  ${k.padEnd(18)} \u00a3${v.toFixed(2).padStart(10)}`);

const tier = {};
for (const r of records) if (r.date >= '2026-01-01' && r.date <= '2026-05-31') tier[r.tier] = (tier[r.tier] || 0) + r.amount;
console.log('\nBooking-sheet 2026 YTD per tier (new):');
for (const k of Object.keys(tier).sort()) console.log(`  ${k.padEnd(22)} \u00a3${tier[k].toFixed(2).padStart(10)}`);

console.log('\nMonths it will upsert into Supabase:');
for (const [m, b] of byMonth) console.log(`  ${m}: \u00a3${b.revenue.toFixed(2)}`);
