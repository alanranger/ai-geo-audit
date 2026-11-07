import xlsx from 'xlsx';
import { readFileSync } from 'fs';

const wb = xlsx.read(readFileSync('Docs/Booking Sheet 2026 - Alan Ranger Photography.xlsm'), {
  type: 'buffer',
  cellDates: false
});
const ws = wb.Sheets['Courses-Classes'];
const grid = xlsx.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
console.log('header', grid[0]);
// find Janice / 2027 / Get Off Auto
for (let i = 1; i < grid.length; i++) {
  const r = grid[i];
  const blob = r.join('|');
  if (/Janice|Karin|Nigel|Get Off Auto|Composition|2027|Apr/i.test(blob)) {
    console.log('R' + i, r.slice(0, 16));
  }
}
// count rows with first/last and dates
let n = 0;
let withA = 0;
let withB = 0;
let future = 0;
for (let i = 1; i < grid.length; i++) {
  const r = grid[i];
  const first = String(r[11] || '');
  const last = String(r[12] || '');
  if (!first && !last) continue;
  n++;
  if (r[0] !== '') withA++;
  if (r[1] !== '') withB++;
  if (typeof r[1] === 'number' && r[1] > 46000) future++;
}
console.log({ personRows: n, withFromCol: withA, withToCol: withB, futureSerialInTo: future, totalGrid: grid.length });

// Workshops null date row
const w = xlsx.utils.sheet_to_json(wb.Sheets['Workshops'], { header: 1, raw: true, defval: '' });
for (let i = 1; i < w.length; i++) {
  const theme = String(w[i][2] || '');
  if (/Hay Woods|Solihull/i.test(theme)) {
    console.log('W' + i, { eventDate: w[i][1], theme, first: w[i][11], last: w[i][12], dur: w[i][4] });
  }
}
console.log('workshop data rows', w.filter((r, i) => i && (r[1] || r[11] || r[12])).length);
