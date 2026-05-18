// Inspect Workshop Residential vs Non-Residential events in the Booking Sheet
import { existsSync, readFileSync } from 'node:fs';
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

for (const tab of ['Sales 2026', 'Sales 2025']) {
  const ws = wb.Sheets[tab];
  if (!ws) continue;
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  let hdr = -1;
  for (let i = 0; i < rows.length; i++) {
    const c = (rows[i] || []).map(x => String(x || '').trim().toLowerCase());
    if (c.includes('date') && c.includes('category') && c.includes('funding')) { hdr = i; break; }
  }
  const cols = (rows[hdr] || []).map(c => String(c || '').trim());
  const dataRows = rows.slice(hdr + 1).map(r => {
    const o = {};
    for (let j = 0; j < cols.length; j++) if (cols[j]) o[cols[j]] = r[j];
    return o;
  });
  console.log('\n=== ' + tab + ' ===  header row ' + (hdr + 1) + '  cols: ' + (cols||[]).filter(Boolean).join(' | '));
  console.log('  data rows after header:', dataRows.length);
  if (dataRows.length) console.log('  first row sample:', JSON.stringify(dataRows[0]).slice(0,200));
  const events = new Map();
  for (const r of dataRows) {
    const cat = String(r.Category || '').trim();
    if (!cat.toLowerCase().includes('workshop')) continue;
    const key = cat + ' || ' + String(r.Event || '').trim();
    const ev = events.get(key) || { count: 0, total: 0 };
    ev.count += 1;
    ev.total += Number(String(r.Amount || '0').replace(/[£,\s]/g, '')) || 0;
    events.set(key, ev);
  }
  for (const [k, v] of [...events.entries()].sort()) {
    console.log('  £' + v.total.toFixed(0).padStart(6), '(' + v.count + ')', k);
  }
}
