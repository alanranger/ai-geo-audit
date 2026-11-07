/**
 * Inspect Workshop Costs formulas / values for Vyrnwy-like residential at 2 clients
 * and day at £150 / 5 clients — to mirror sheet logic.
 */
import xlsx from 'xlsx';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = resolve(root, 'Docs/Booking Sheet 2026 - Alan Ranger Photography.xlsm');
const wb = xlsx.readFile(p, { cellDates: true, cellFormula: true });
const sh = wb.Sheets['Workshop Costs'];

function dump(r0, c0, r1, c1, label) {
  console.log('\n==', label, '==');
  for (let r = r0; r <= r1; r++) {
    const parts = [];
    for (let c = c0; c <= c1; c++) {
      const addr = xlsx.utils.encode_cell({ r, c });
      const cell = sh[addr];
      if (!cell) continue;
      const v = cell.v;
      const f = cell.f;
      parts.push(`${addr}=${f ? `F(${f})` : ''}${v != null ? `v=${JSON.stringify(v)}` : ''}`);
    }
    if (parts.length) console.log('R' + (r + 1), parts.join(' | '));
  }
}

// Rates + residential block cols A-I (0-8), day block K-S (10-18)
dump(0, 0, 40, 18, 'rates + curves');
dump(44, 0, 81, 8, 'locations');
