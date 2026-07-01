// One-off patch: remaps Column C/I/J on transaction rows in the live booking sheet.
// SOURCE (only): alan-shared-resources/csv/Booking_Sheet_2026_-_WITH_PRODUCT_MAPPING_3.xlsm
//
// IMPORTANT: use patch-booking-sheet-product-tags.py (openpyxl) for .xlsm writes.
// SheetJS write corrupts date cells in column A and drops rows on import.

import { readFileSync, writeFileSync } from 'node:fs';
import xlsx from 'xlsx';

const SOURCE =
  'G:/Dropbox/alan ranger photography/Website Code/alan-shared-resources/csv/Booking_Sheet_2026_-_WITH_PRODUCT_MAPPING_3.xlsm';

const SENSOR_LANDING = 'https://www.alanranger.com/photography-services-near-me/camera-sensor-clean/';
const GUEST_LANDING = 'https://www.alanranger.com/professional-commercial-photographer-coventry';
const PRINT_LANDING = 'https://www.alanranger.com/fine-art-prints';
const KASE_LANDING = 'https://www.alanranger.com/photography-workshops-near-me';
const ACADEMY_LANDING = 'https://www.alanranger.com/free-online-photography-course';

const SENSOR_EVENTS = new Set(['sensor clean', 'sensore clean', 'sensor clean x 3']);
const PRINT_EVENTS = new Set(['tripod', 'pocket guides']);
const KASE_EVENTS = new Set(['kase affiliates', 'kase royalties']);

function normEvent(v) {
  return String(v || '').trim().toLowerCase();
}

function patchRow(row, changes) {
  const ev = normEvent(row[5]);
  if (SENSOR_EVENTS.has(ev)) {
    row[2] = '11 Commissions';
    row[8] = 'Sensor Clean Service (historical)';
    row[9] = SENSOR_LANDING;
    changes.push(`sensor:${ev}`);
    return;
  }
  if (ev === 'guest blog') {
    row[2] = '11 Commissions';
    row[8] = 'Commission - Editorial / Guest Blog / Judging';
    row[9] = GUEST_LANDING;
    changes.push('guest blog');
    return;
  }
  if (PRINT_EVENTS.has(ev)) {
    row[2] = '10. Prints & Royalties';
    row[8] = 'Print Sale - Generic (historical)';
    row[9] = PRINT_LANDING;
    changes.push(`print-merch:${ev}`);
    return;
  }
  if (KASE_EVENTS.has(ev)) {
    row[2] = '10. Prints & Royalties';
    row[8] = 'Royalties & Affiliate Income';
    row[9] = KASE_LANDING;
    changes.push(`kase:${ev}`);
    return;
  }
  if (ev === 'e-book foundation') {
    row[2] = row[2] === '12. Other' ? '12. Other' : '12. Academy';
    row[8] = 'Academy - Membership & Income';
    row[9] = ACADEMY_LANDING;
    changes.push('e-book foundation');
  }
}

const wb = xlsx.read(readFileSync(SOURCE), { type: 'buffer', cellDates: true });
let total = 0;
const bySheet = {};

for (const name of wb.SheetNames) {
  const m = /^sales\s+(\d{4})$/i.exec(name);
  if (!m || Number(m[1]) < 2024) continue;
  const ws = wb.Sheets[name];
  const ref = ws['!ref'];
  if (!ref) continue;
  const range = xlsx.utils.decode_range(ref);
  let headerRow = -1;
  for (let r = 100; r <= 250; r++) {
    const cell = ws[xlsx.utils.encode_cell({ r, c: 0 })];
    if (cell && String(cell.v || '').trim().toLowerCase() === 'date') {
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0) continue;
  const changes = [];
  let blankRun = 0;
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const dateCell = ws[xlsx.utils.encode_cell({ r, c: 0 })];
    if (!dateCell || dateCell.v == null || dateCell.v === '') {
      blankRun += 1;
      if (blankRun >= 50) break;
      continue;
    }
    blankRun = 0;
    const row = [];
    for (let c = 0; c <= 9; c++) {
      const addr = xlsx.utils.encode_cell({ r, c });
      row[c] = ws[addr]?.v;
    }
    const before = JSON.stringify([row[2], row[8], row[9]]);
    patchRow(row, changes);
    const after = JSON.stringify([row[2], row[8], row[9]]);
    if (before === after) continue;
    for (let c = 0; c <= 9; c++) {
      const addr = xlsx.utils.encode_cell({ r, c });
      ws[addr] = { t: typeof row[c] === 'number' ? 'n' : 's', v: row[c] };
    }
    total++;
  }
  if (changes.length) bySheet[name] = changes.length;
}

writeFileSync(SOURCE, xlsx.write(wb, { type: 'buffer', bookType: 'xlsm', bookVBA: true }));
console.log('patched rows:', total, bySheet);
