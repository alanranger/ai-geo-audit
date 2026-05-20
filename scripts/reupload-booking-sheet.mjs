// Re-upload the local Booking Sheet to the production
// /api/aigeo/booking-sheet-upload endpoint. The handler runs the same
// lib/booking-sheet-parser.mjs we just patched, so this is how we get
// the de-duped per-tier figures into Supabase.

import { readFileSync } from 'node:fs';

const SHEET = 'G:\\Dropbox\\1. Bookings\\Booking Sheet 2026 - Alan Ranger Photography.xlsm';
const URL   = 'https://ai-geo-audit.vercel.app/api/aigeo/booking-sheet-upload';

const buffer = readFileSync(SHEET);
const body = {
  filename: 'Booking Sheet 2026 - Alan Ranger Photography.xlsm',
  contentBase64: buffer.toString('base64'),
  years: [2026],
  propertyUrl: 'https://www.alanranger.com'
};
console.log(`Uploading ${(buffer.length / 1024).toFixed(0)} KB to ${URL} ...`);

const r = await fetch(URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});
const t = await r.text();
console.log(`HTTP ${r.status}`);
try {
  const j = JSON.parse(t);
  console.log('ok=', j.ok);
  console.log('tabs_read=', j.tabs_read);
  console.log('records_kept=', j.records_kept);
  console.log('records_skipped=', j.records_skipped);
  console.log('months_upserted=', j.months_upserted);
  console.log('by_funding=', j.by_funding);
  if (j.by_month) {
    console.log('\nMonths upserted:');
    for (const m of j.by_month) {
      const t26 = m.tier_revenue || {};
      console.log(`  ${m.period_start} -> ${m.period_end}  total=\u00a3${m.revenue_amount}  tiers=${JSON.stringify(t26)}`);
    }
  }
} catch (e) {
  console.log('parse err:', e.message, 'body=', t.slice(0, 800));
}
