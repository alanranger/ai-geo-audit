// Read the "Sales 2026" pivot table (rows = categories, columns =
// months) directly from the Booking Sheet and compare 2026 YTD totals
// per tier against the dashboard's revenue_snapshots.
//
// Usage: node scripts/probe-bs-vs-dashboard.mjs

import { readFileSync } from 'node:fs';
import xlsx from 'xlsx';

const SHEET = 'G:\\Dropbox\\1. Bookings\\Booking Sheet 2026 - Alan Ranger Photography.xlsm';
const wb = xlsx.read(readFileSync(SHEET), { type: 'buffer', cellDates: true });
const rows = xlsx.utils.sheet_to_json(wb.Sheets['Sales 2026'], { header: 1, raw: false, defval: '' });

// Find the header row that lists 'Sales Categories | Target | Jan | Feb | ...'
let hi = -1;
for (let i = 0; i < 30; i += 1) {
  const c = (rows[i] || []).map(x => String(x || '').trim().toLowerCase());
  if (c.some(v => v.startsWith('sales categories')) && c.some(v => v === 'jan')) { hi = i; break; }
}
if (hi < 0) { console.error('Could not find pivot header row'); process.exit(1); }
const headers = rows[hi].map(h => String(h || '').trim());
console.log(`Pivot header @ row ${hi+1}:`, headers.filter(Boolean).join(' | '));

// Find columns for category, target, and Jan-May
const iCategory = headers.findIndex(h => /^sales categories?/i.test(h));
const iTarget   = headers.findIndex((h, idx) => /^target$/i.test(h) && idx > iCategory);
const monthIndexes = {};
for (const m of ['Jan','Feb','Mar','Apr','May']) {
  monthIndexes[m] = headers.findIndex(h => h.toLowerCase() === m.toLowerCase());
}
console.log('Column indexes:', { iCategory, iTarget, ...monthIndexes });

const CATEGORY_TO_TIER = (raw) => {
  const c = String(raw || '').toLowerCase().trim();
  if (!c) return null;
  // ORDER MATTERS: check non-res BEFORE residential, since "Workshops
  // Non Residential" contains the substring "residential".
  if (c.includes('non residential')) return 'workshops_nonres';
  if (c.includes('residential'))     return 'workshops_residential';
  if (c.includes('workshop'))        return 'workshops_nonres';
  if (c.includes('academy'))         return 'academy';
  if (c.includes('commission') || c.includes('print') || c.includes('royalt')) return 'hire';
  if (c.includes('course') || c.includes('masterclass')) return 'courses';
  if (c.includes('pick n mix') || c.includes('gift voucher') || c.includes('mentor') || c.includes('1-2-1') || c.includes('121') || c.includes('private') || c.includes('sensor')) return 'services';
  return null;
};

const num = v => { const n = Number(String(v || '').replace(/[\u00a3,\s]/g, '')); return Number.isFinite(n) ? n : 0; };

// Only read the FIRST revenue block: the 12 numbered categories
// "1. Courses/masterclasses" through "12. Academy". Below this block
// the spreadsheet repeats the same labels in variance, %, YTD-vs-target,
// and prior-year comparison sub-blocks - we don't want to double-count.
const sheet = {};
const unmapped = new Map();
const detail = [];
const seen = new Set();

for (let i = hi + 1; i < rows.length; i += 1) {
  const r = rows[i] || [];
  const cat = String(r[iCategory] || '').trim();
  if (!cat) continue;
  // Stop once we wrap back to category 1, or we hit a row that isn't a
  // numbered "N. <something>" category.
  if (!/^\d{1,2}\.?\s/.test(cat)) {
    // Tolerate cosmetic rows (blank / sub-headings) but stop as soon as
    // we've passed the first 12 numbered categories.
    if (seen.size >= 12) break;
    continue;
  }
  if (seen.has(cat)) break; // 2nd occurrence -> we're in the next block.
  seen.add(cat);
  const tier = CATEGORY_TO_TIER(cat);
  const ytd = ['Jan','Feb','Mar','Apr','May'].reduce((sum, m) => sum + num(r[monthIndexes[m]]), 0);
  if (!tier) {
    if (ytd !== 0) unmapped.set(cat, (unmapped.get(cat) || 0) + ytd);
    continue;
  }
  sheet[tier] = (sheet[tier] || 0) + ytd;
  detail.push({ cat, tier, ytd });
}

console.log('\nPer-category 2026 YTD rows from pivot:');
for (const d of detail) console.log(`  "${d.cat}" -> ${d.tier.padEnd(22)} \u00a3${d.ytd.toFixed(2)}`);
if (unmapped.size) { console.log('\nUnmapped categories (skipped):'); for (const [c, v] of unmapped) console.log(`  "${c}" \u00a3${v.toFixed(2)}`); }

console.log('\nSpreadsheet 2026 YTD per tier (Jan-May, all funding sources):');
for (const k of Object.keys(sheet).sort()) console.log(`  ${k.padEnd(22)} \u00a3${sheet[k].toFixed(2).padStart(10)}`);

// Dashboard side: post-fix figures from Supabase revenue_snapshots.
const SQ     = { workshops_residential: 7310, workshops_nonres: 3342, courses: 2150, services:  750, hire:  770, academy:   20, unidentified: 205 };
const STRIPE = { workshops_residential:    0, workshops_nonres:    0, courses:    0, services:  405, hire:  500, academy: 1263, unidentified:   0 };
// Booking-sheet 2026 YTD = sum of 4 monthly snapshots from Supabase:
//   Jan: res 575,    nonres 610, hire 436.67, services -1020
//   Feb:             nonres 170,              services 286
//   Mar:             nonres 110, hire 591.62
//   Apr: res 100,    nonres 965, hire 232.75, courses 100, services -325
const BOOKSHEET = { workshops_residential: 675, workshops_nonres: 1855, courses: 100, services: -1059, hire: 1261.04, academy: 0, unidentified: 0 };

console.log('\n--- 2026 YTD reconciliation by tier ---');
console.log('  Tier                    | SQ       | Stripe  | Book-sheet | Dashboard | Spreadsheet | Diff');
console.log('  ----------------------- | -------- | ------- | ---------- | --------- | ----------- | ----');
let totalDash = 0;
let totalSheet = 0;
for (const tier of Object.keys(SQ)) {
  const sq = SQ[tier] || 0;
  const st = STRIPE[tier] || 0;
  const bs = BOOKSHEET[tier] || 0;
  const dash = sq + st + bs;
  const sh = sheet[tier] || 0;
  const diff = dash - sh;
  totalDash += dash;
  totalSheet += sh;
  const flag = Math.abs(diff) < 25 ? 'OK ' : '!! ';
  console.log(`  ${flag}${tier.padEnd(21)} | \u00a3${String(sq).padStart(6)} | \u00a3${String(st).padStart(5)} | \u00a3${bs.toFixed(2).padStart(8)} | \u00a3${dash.toFixed(2).padStart(7)} | \u00a3${sh.toFixed(2).padStart(9)} | \u00a3${diff.toFixed(2).padStart(7)}`);
}
console.log('  ----------------------- | -------- | ------- | ---------- | --------- | ----------- | ----');
console.log(`     TOTAL                 |          |         |            | \u00a3${totalDash.toFixed(2).padStart(7)} | \u00a3${totalSheet.toFixed(2).padStart(9)} | \u00a3${(totalDash-totalSheet).toFixed(2).padStart(7)}`);
