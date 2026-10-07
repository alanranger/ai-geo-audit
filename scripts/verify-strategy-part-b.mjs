// Local verify: live Squarespace feeds + product variants, MOCKED Supabase (legacy keys disabled locally).
// Sheet attendee counts + GP rates copied from production via read-only SQL; cost model parsed from Docs/*.xlsm.
import xlsx from 'xlsx';
import { parseWorkshopCosts } from '../lib/booking-sheet-workshop-costs.mjs';

const wsCounts = [
  ['2026-10-05', 'CHESTERTON WINDMILL', false, 1], ['2026-10-10', 'Lake Vyrnwey', true, 2],
  ['2026-10-17', 'Peak District Photography Workshops Padley Gorge', false, 5],
  ['2026-10-18', 'Secret Woodlands', false, 1], ['2026-10-18', 'The Secret of WOODLAND PHOTOGRAPHY-', false, 2],
  ['2026-10-23', 'Batsford', false, 4], ['2026-10-24', 'Batsford', false, 3], ['2026-10-25', 'Batsford', false, 1],
  ['2026-11-01', 'Peak District Photography Workshops Padley Gorge', false, 3], ['2026-11-06', 'Woodland Walk', false, 1],
  ['2026-11-07', 'Peak District Photography Workshops Padley Gorge', false, 1], ['2026-11-20', 'Norfolk', true, 2],
  ['2027-01-22', 'Lake District', true, 2]
];
const workshops = [];
for (const [d, t, m, n] of wsCounts) for (let i = 0; i < n; i += 1) workshops.push({ event_start: d, theme_location: t, is_multi_day: m, client_name: `c${i}`, paid: 100 });
const gpRates = [[1, 0.9], [2, 0.75], [3, 0.35], [4, 0.5], [5, 0.45], [6, 0.95], [7, 0.95], [8, 0.6], [9, 0.5], [10, 0.99], [11, 0.9], [12, 0.99]]
  .map(([o, r]) => ({ year: 2026, category_order: o, gp_rate: r }));
const model = parseWorkshopCosts(xlsx.readFile('Docs/Booking Sheet 2026 - Alan Ranger Photography.xlsm'));

const tables = {
  booking_sheet_workshop_attendees: workshops,
  booking_sheet_category_gp: gpRates
};
function chain(table) {
  const rows = tables[table] || [];
  const c = {
    select: () => c, eq: () => c, order: () => c, range: () => c, gte: () => c, limit: () => c,
    maybeSingle: () => Promise.resolve({ data: table === 'booking_sheet_workshop_cost_model' ? { model } : null, error: null }),
    insert: () => Promise.resolve({ error: null }),
    then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej)
  };
  return c;
}
const sb = { from: chain };
// ensureStrategyActions must see "no missing" -> returns stub; use the real module but stub actions
const { buildStrategySummary } = await import('../lib/strategy-summary.mjs');
const s = await buildStrategySummary(sb);

console.log('--- Batsford rows ---');
for (const e of s.diary.filter((x) => /batsford/i.test(x.title))) {
  console.log(JSON.stringify({
    date: e.date, kind: e.is_parent ? 'PARENT' : e.session, cap: e.cap, booked: e.booked, left: e.left, fill: e.fill_pct,
    be: e.be, rag: e.rag, status: e.status, gbp_booked: e.booked_gbp, gbp_unsold: e.unsold_gbp,
    mismatch: e.mismatch, excludePush: e.excludePush, gp_now: e.gp_now, gp_full: e.gp_full, gp_est: e.gp_est
  }));
}
console.log('--- push ---');
for (const p of s.push) console.log(p.date, p.title, p.rag, '|', p.gap);
console.log('--- action_needed ---');
for (const a of s.action_needed) console.log(`${a.title}${a.sep || ' — '}${a.detail}`);
console.log('--- christmas/evening/walk rows ---');
for (const e of s.diary.filter((x) => /christmas|evening|walk/i.test(x.title))) console.log(e.date, e.title, e.from_product_only ? '(product-only)' : '');
console.log('--- gp ---', JSON.stringify(s.diary_gp));
for (const e of s.diary.slice(0, 22)) {
  if (e.is_parent) continue;
  console.log(e.date, e.type, (e.session || '  '), String(e.booked).padStart(2) + '/' + e.cap, 'gp_now', e.gp_now, 'gp_full', e.gp_full, e.gp_est ? 'est' : '');
}
console.log('--- scorecard ---');
for (const k of s.kpi_scorecard.filter((x) => ['1', '2', '3'].includes(x.key))) console.log(JSON.stringify(k));
import fs from 'node:fs'; fs.writeFileSync('.tmp-summary.json', JSON.stringify(s));
const { productOnlyRows } = await import('../lib/strategy-diary.mjs');
const fake = [
 { productTitle: 'CHRISTMAS Evening Photography Walk', optText: 'Thu 10 Dec - 6pm', date: '2026-12-10', price: 25, qty: 4, url: '/x', productMax: null },
 { productTitle: 'Christmas Lights Walk', optText: 'Tue 29 Dec', date: '2026-12-29', price: 25, qty: 6, url: '/y', productMax: null },
 { productTitle: 'WARWICKSHIRE Woodland PHOTOGRAPHY WALKS - Monthly - 2hrs', optText: 'Fri Dec 4 - Hay Wood - Lapworth', date: '2026-12-04', price: 15, qty: 6 }
];
const out = productOnlyRows(s.diary, fake, { workshops: [], paceByKey: new Map(), today: '2026-10-07', end12: '2026-12-30' });
console.log('--- product-only synthetic ---'); for (const e of out) console.log(e.date, e.title, e.type, e.booked+'/'+e.cap, 'left', e.left);

