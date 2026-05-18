import { existsSync } from 'node:fs';
import xlsx from 'xlsx';

function findBookingSheet() {
  const now = new Date();
  for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y -= 1) {
    const p = `G:\\Dropbox\\1. Bookings\\Booking Sheet ${y} - Alan Ranger Photography.xlsm`;
    if (existsSync(p)) return p;
  }
  return null;
}

const path = findBookingSheet();
const wb = xlsx.readFile(path, { cellDates: true });

for (const tabName of ['Sales 2026', 'Sales 2025']) {
  const ws = wb.Sheets[tabName];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', dateNF: 'yyyy-mm-dd' });
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i += 1) {
    const cells = (rows[i] || []).map(c => String(c || '').trim().toLowerCase());
    if (cells.includes('date') && cells.includes('client') && cells.includes('category') && cells.includes('funding')) {
      headerIdx = i; break;
    }
  }
  if (headerIdx < 0) { console.log(`${tabName}: header not found`); continue; }
  const headers = rows[headerIdx].map(h => String(h || '').trim());
  console.log(`\n=== ${tabName} ===  header at row ${headerIdx + 1}: ${headers.filter(Boolean).join(' | ')}`);

  const data = rows.slice(headerIdx + 1).map(r => {
    const obj = {};
    for (let j = 0; j < headers.length; j += 1) if (headers[j]) obj[headers[j]] = r[j];
    return obj;
  });
  const usable = data.filter(r => r.Date && r.Category && (r.Amount !== '' && r.Amount != null));
  console.log(`  Total body rows: ${data.length}  Usable (have Date+Category+Amount): ${usable.length}`);

  if (usable.length) console.log(`  First sample:`, usable[0]);
  if (usable.length > 5) console.log(`  Last sample:`, usable[usable.length - 1]);

  const fundings = new Map();
  const categories = new Map();
  let totalAll = 0;
  let totalBank = 0;
  let totalPayPal = 0;
  let totalStripe = 0;
  for (const r of usable) {
    const f = String(r.Funding || '').trim();
    const c = String(r.Category || '').trim();
    const amt = Number(String(r.Amount).replace(/[£,\s]/g, '')) || 0;
    fundings.set(f || '<empty>', (fundings.get(f || '<empty>') || 0) + 1);
    categories.set(c || '<empty>', (categories.get(c || '<empty>') || 0) + 1);
    totalAll += amt;
    const fl = f.toLowerCase();
    if (fl === 'bank') totalBank += amt;
    else if (fl === 'paypal') totalPayPal += amt;
    else if (fl === 'stripe') totalStripe += amt;
  }
  console.log(`  Funding distribution:`);
  for (const [k, v] of [...fundings.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(25)} ${v}`);
  }
  console.log(`  Category distribution:`);
  for (const [k, v] of [...categories.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(40)} ${v}`);
  }
  console.log(`  £ Totals: All=£${totalAll.toFixed(2)}  Bank=£${totalBank.toFixed(2)}  PayPal=£${totalPayPal.toFixed(2)}  Stripe=£${totalStripe.toFixed(2)}`);
}
