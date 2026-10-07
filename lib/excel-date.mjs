/**
 * Shared Excel / sheet date coercion (serials, Date, ISO, UK strings).
 */
import xlsx from 'xlsx';

function validIso(y, m, d) {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) return null;
  return iso;
}

export function toExcelDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return validIso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v < 30000 || v > 80000) return null; // reject non-date serials / blanks
    const d = xlsx.SSF.parse_date_code(v);
    if (d) return validIso(d.y, d.m, d.d);
  }
  const s = String(v).trim();
  if (!s) return null;
  // Notes in From Date column (e.g. "cancelled 3rd Nov") are not dates
  if (/[a-z]{3,}/i.test(s) && !/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(s)) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split('-').map(Number);
    return validIso(y, m, d);
  }
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    let yy = Number(m[3]);
    if (yy < 100) yy += 2000;
    return validIso(yy, mm, dd);
  }
  return null;
}
