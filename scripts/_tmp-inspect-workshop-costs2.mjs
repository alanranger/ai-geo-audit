import XLSX from 'xlsx';

const p = 'G:/Dropbox/1. Bookings/Booking_Sheet_2026_-_WITH_PRODUCT_MAPPING_3.xlsm';
const wb = XLSX.readFile(p, { cellDates: true });
const sheet = wb.Sheets['Workshop Costs'];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
for (let i = 9; i < Math.min(82, rows.length); i++) {
  const r = rows[i] || [];
  // print non-empty cells with col index
  const parts = [];
  for (let c = 0; c < Math.min(20, r.length); c++) {
    if (r[c] !== '' && r[c] != null) parts.push(`${c}:${JSON.stringify(r[c])}`);
  }
  if (parts.length) console.log('R' + (i + 1), parts.join(' | '));
}
