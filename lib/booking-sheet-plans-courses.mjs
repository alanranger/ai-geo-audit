/**
 * Parse Booking Sheet "Plans" + "Courses-Classes" tabs.
 * Plans sheet may be absent until Alan adds it — parser returns empty, not error.
 */
import xlsx from 'xlsx';
import { toExcelDate as toDate } from './excel-date.mjs';

function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[£,%]/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function ynBool(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  if (/^(y|yes|true|1)$/.test(s)) return true;
  if (/^(n|no|false|0)$/.test(s)) return false;
  return null;
}

function normHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findCol(header, ...res) {
  for (const re of res) {
    const i = header.findIndex((h) => re.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

/** Map Courses-Classes Source col → strategy bucket. */
export function mapBeginnersSourceBucket(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 'Other';
  if (s === 'goolge' || s === 'google') return 'Google';
  if (s.includes('into the blue') || s.includes('gift voucher') || s === 'gift') return 'Gift';
  if (s === 'existing' || s === 'referral') return 'Existing & referral';
  if (s === 'jlr' || s === 'els') return 'JLR';
  return 'Other';
}

function findSheet(wb, exactRe, fuzzyRe) {
  const names = wb.SheetNames || [];
  return names.find((n) => exactRe.test(String(n).trim()))
    || names.find((n) => fuzzyRe.test(String(n).trim()))
    || null;
}

function gridFrom(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  return xlsx.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
}

/**
 * @returns {{ rows: object[], sheet: string|null }}
 */
export function parsePlansTab(wb, { propertyUrl, sourceFile = null } = {}) {
  const sheetName = findSheet(wb, /^plans$/i, /^plans?\b/i);
  if (!sheetName) return { rows: [], sheet: null };
  const grid = gridFrom(wb, sheetName);
  if (!grid.length) return { rows: [], sheet: sheetName };

  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, grid.length); i++) {
    const line = (grid[i] || []).map(normHeader).join('|');
    if (/plan id|client/.test(line) && /start|email|plan type|status/.test(line)) {
      headerIdx = i;
      break;
    }
  }
  const header = (grid[headerIdx] || []).map(normHeader);
  const c = {
    planId: findCol(header, /plan id|^id$/),
    client: findCol(header, /^client$/, /client name/),
    email: findCol(header, /^email/),
    start: findCol(header, /start date|^start$/),
    end: findCol(header, /end date|^end$/),
    type: findCol(header, /plan type|type/),
    value: findCol(header, /plan value|value £|value/),
    payment: findCol(header, /^payment/),
    discount: findCol(header, /^discount/),
    resDisc: findCol(header, /residential discount/),
    reviewLen: findCol(header, /review length/),
    academyY: findCol(header, /academy granted/),
    academyUntil: findCol(header, /academy until/),
    r1d: findCol(header, /review 1 due/),
    r1h: findCol(header, /review 1 held/),
    r2d: findCol(header, /review 2 due/),
    r2h: findCol(header, /review 2 held/),
    r3d: findCol(header, /review 3 due/),
    r3h: findCol(header, /review 3 held/),
    r4d: findCol(header, /review 4 due/),
    r4h: findCol(header, /review 4 held/),
    status: findCol(header, /^status$/),
    cameFrom: findCol(header, /came from/),
    course: findCol(header, /course attended/),
    notes: findCol(header, /^notes$/)
  };

  const importedAt = new Date().toISOString();
  const rows = [];
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    if (!row.some((x) => String(x || '').trim())) continue;
    const client_name = c.client >= 0 ? String(row[c.client] || '').trim() : '';
    const plan_id = c.planId >= 0 ? String(row[c.planId] || '').trim() : '';
    if (!client_name && !plan_id) continue;
    const get = (idx) => (idx >= 0 ? row[idx] : null);
    rows.push({
      property_url: propertyUrl,
      plan_id: plan_id || null,
      client_name: client_name || null,
      email: c.email >= 0 ? String(row[c.email] || '').trim().toLowerCase() || null : null,
      start_date: toDate(get(c.start)),
      end_date: toDate(get(c.end)),
      plan_type: c.type >= 0 ? String(row[c.type] || '').trim() || null : null,
      plan_value: toNum(get(c.value)),
      payment: toNum(get(c.payment)),
      discount_pct: toNum(get(c.discount)),
      residential_discount_pct: toNum(get(c.resDisc)),
      review_length_mins: toNum(get(c.reviewLen)),
      academy_granted: ynBool(get(c.academyY)),
      academy_until: toDate(get(c.academyUntil)),
      review_1_due: toDate(get(c.r1d)),
      review_1_held: toDate(get(c.r1h)),
      review_2_due: toDate(get(c.r2d)),
      review_2_held: toDate(get(c.r2h)),
      review_3_due: toDate(get(c.r3d)),
      review_3_held: toDate(get(c.r3h)),
      review_4_due: toDate(get(c.r4d)),
      review_4_held: toDate(get(c.r4h)),
      status: c.status >= 0 ? String(row[c.status] || '').trim() || null : null,
      came_from: c.cameFrom >= 0 ? String(row[c.cameFrom] || '').trim() || null : null,
      course_attended: c.course >= 0 ? String(row[c.course] || '').trim() || null : null,
      notes: c.notes >= 0 ? String(row[c.notes] || '').trim() || null : null,
      source_row: r + 1,
      imported_at: importedAt,
      source_file: sourceFile
    });
  }
  return { rows, sheet: sheetName };
}

/**
 * @returns {{ rows: object[], sheet: string|null, dateNullPct: number }}
 */
export function parseCoursesClassesTab(wb, { propertyUrl, sourceFile = null } = {}) {
  const sheetName = findSheet(wb, /^courses-classes$/i, /courses.?classes/i);
  if (!sheetName) return { rows: [], sheet: null, dateNullPct: 0 };
  const grid = gridFrom(wb, sheetName);
  if (!grid.length) return { rows: [], sheet: sheetName, dateNullPct: 0 };

  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, grid.length); i++) {
    const line = (grid[i] || []).map(normHeader).join('|');
    if (/from date|event/.test(line) && /first name|source|email/.test(line)) {
      headerIdx = i;
      break;
    }
  }
  const header = (grid[headerIdx] || []).map(normHeader);
  const cFrom = findCol(header, /from date/);
  const cTo = findCol(header, /to date/);
  const cBooked = findCol(header, /date booked/);
  const cEvent = findCol(header, /^event$/);
  const cLoc = findCol(header, /^location$/);
  const cDur = findCol(header, /^duration$/);
  const cPaid = findCol(header, /^paid$/);
  const cBal = findCol(header, /^balance$/);
  const cSource = findCol(header, /^source$/);
  const cRef = findCol(header, /booking ref|order/);
  const cPrefix = findCol(header, /^prefix$/);
  const cFirst = findCol(header, /first name/);
  const cLast = findCol(header, /last name/);
  const cEmail = findCol(header, /email/);

  const importedAt = new Date().toISOString();
  const rows = [];
  let dateNull = 0;
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r] || [];
    if (!row.some((x) => String(x || '').trim())) continue;
    const first = cFirst >= 0 ? String(row[cFirst] || '').trim() : '';
    const last = cLast >= 0 ? String(row[cLast] || '').trim() : '';
    const event_name = cEvent >= 0 ? String(row[cEvent] || '').trim() : '';
    const source_raw = cSource >= 0 ? String(row[cSource] || '').trim() : '';
    // Real booking = named client. Skip syllabus junk (Get Off Auto, Composition, …).
    const is_booking_row = Boolean(first || last);
    if (!is_booking_row) continue;

    const client_name = [first, last].filter(Boolean).join(' ').trim() || null;
    const is_beginners = /beginner/i.test(event_name);
    // Sheet layout: From Date is often notes; course start sits in To Date;
    // Date Booked is the booking date. Promote To→From when From has no date.
    let from_date = cFrom >= 0 ? toDate(row[cFrom]) : null;
    let to_date = cTo >= 0 ? toDate(row[cTo]) : null;
    const date_booked = cBooked >= 0 ? toDate(row[cBooked]) : null;
    if (!from_date && to_date) {
      from_date = to_date;
      to_date = null;
    }
    if (!from_date && !date_booked) continue;
    if (!from_date) dateNull += 1;
    rows.push({
      property_url: propertyUrl,
      from_date,
      to_date,
      date_booked,
      event_name: event_name || null,
      location: cLoc >= 0 ? String(row[cLoc] || '').trim() || null : null,
      duration_text: cDur >= 0 ? String(row[cDur] || '').trim() || null : null,
      paid: cPaid >= 0 ? toNum(row[cPaid]) : null,
      balance: cBal >= 0 ? toNum(row[cBal]) : null,
      source_raw: source_raw || null,
      source_bucket: mapBeginnersSourceBucket(source_raw),
      booking_ref: cRef >= 0 ? String(row[cRef] || '').trim() || null : null,
      prefix: cPrefix >= 0 ? String(row[cPrefix] || '').trim() || null : null,
      first_name: first || null,
      last_name: last || null,
      client_name,
      email: cEmail >= 0 ? String(row[cEmail] || '').trim().toLowerCase() || null : null,
      is_beginners,
      is_booking_row,
      source_row: r + 1,
      imported_at: importedAt,
      source_file: sourceFile
    });
  }
  const bookingRows = rows.filter((r) => r.is_booking_row);
  const dateNullPct = bookingRows.length
    ? Math.round((dateNull / bookingRows.length) * 1000) / 10
    : 0;
  return { rows, sheet: sheetName, dateNullPct };
}

async function replaceInsert(supabase, table, propertyUrl, rows) {
  await supabase.from(table).delete().eq('property_url', propertyUrl);
  if (!rows.length) return 0;
  let written = 0;
  const chunk = 200;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const { error } = await supabase.from(table).insert(slice);
    if (error) throw error;
    written += slice.length;
  }
  return written;
}

export async function persistPlans(supabase, propertyUrl, parsed) {
  if (!parsed?.sheet) return { written: 0, sheet: null };
  const written = await replaceInsert(supabase, 'booking_sheet_plans', propertyUrl, parsed.rows || []);
  return { written, sheet: parsed.sheet };
}

export async function persistCourseAttendees(supabase, propertyUrl, parsed) {
  if (!parsed?.sheet) return { written: 0, sheet: null, dateNullPct: 0 };
  const written = await replaceInsert(
    supabase,
    'booking_sheet_course_attendees',
    propertyUrl,
    parsed.rows || []
  );
  return { written, sheet: parsed.sheet, dateNullPct: parsed.dateNullPct || 0 };
}
