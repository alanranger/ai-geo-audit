import XLSX from 'xlsx';
import { existsSync } from 'fs';

const paths = [
  'G:/Dropbox/1. Bookings/Booking_Sheet_2026_-_WITH_PRODUCT_MAPPING_3.xlsm',
  'G:/Dropbox/alan ranger photography/Website Code/AI GEO Audit/Docs/Booking Sheet 2026 - Alan Ranger Photography.xlsm',
  'G:/Dropbox/1. Bookings/Booking Sheet 2025 - Alan Ranger Photography.xlsm'
];

for (const p of paths) {
  if (!existsSync(p)) {
    console.log('MISSING', p);
    continue;
  }
  const wb = XLSX.readFile(p, { cellDates: true });
  console.log('\nFILE', p);
  console.log('SHEETS', wb.SheetNames);
  const name = wb.SheetNames.find((n) => /cost/i.test(n));
  if (!name) {
    console.log('No costs tab');
    continue;
  }
  const sheet = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  console.log('COSTS TAB', name, 'rows', rows.length);
  for (let i = 0; i < Math.min(12, rows.length); i++) {
    console.log('R' + (i + 1), JSON.stringify((rows[i] || []).slice(0, 18)));
  }
}
