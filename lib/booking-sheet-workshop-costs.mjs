/**
 * Parse Booking Sheet "Workshop Costs" tab -> GP-by-occupancy model for Strategy diary.
 *
 * Layout (verified against 2026 sheet):
 *   rows 1-6   global rates (label col B, value col C)
 *   row 10     "Clients:" headers; residential nets in cols D-I, day (2.5hr-1Day) nets in cols N-S
 *   row 33     "Net" row (GP £ after card, discount, B&B, petrol, food, admin)
 *   rows 47+   location room rates (name col A, room rate PN col E)
 */
import xlsx from 'xlsx';

export const WORKSHOP_COSTS_RATE_KEYS = {
  'card fees': 'card_fee',
  'petrol per day': 'petrol_per_day', // retired for GP (mileage model); kept if sheet still has it
  'my food per day': 'food_per_day',
  'car hire per day': 'car_hire_per_day',
  'central admin cost': 'admin',
  'hourly rate': 'hourly',
  'fuel price per litre': 'fuel_price_per_litre',
  'mpg': 'mpg',
  'wear per mile': 'wear_per_mile',
  'day food': 'day_food',
  'short event hours': 'short_event_hours',
  'short event admin': 'short_event_admin'
};

const MAX_CLIENTS = 6;

function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[£,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function cellStr(row, i) {
  return String((row && row[i]) ?? '').trim();
}

export function findWorkshopCostsSheet(wb) {
  return (wb.SheetNames || []).find((n) => /^workshop\s*costs?$/i.test(String(n).trim())) || null;
}

/** Rows 1-6 style "label | value" pairs (label col B, value col C). */
export function parseRates(grid) {
  const rates = {};
  for (const row of grid.slice(0, 12)) {
    const key = WORKSHOP_COSTS_RATE_KEYS[cellStr(row, 1).toLowerCase()];
    const val = toNum(row?.[2]);
    if (key && val != null) rates[key] = val;
  }
  return rates;
}

/** First row index whose label cell (col `labelCol`) equals "Net". */
function findNetRow(grid, labelCol) {
  return grid.findIndex((row) => cellStr(row, labelCol).toLowerCase() === 'net');
}

/** Read clients 1..6 from `firstCol` on the Net row; index 0 unused (null). */
function readNetCurve(grid, labelCol, firstCol) {
  const idx = findNetRow(grid, labelCol);
  const out = new Array(MAX_CLIENTS + 1).fill(null);
  if (idx < 0) return out;
  for (let c = 1; c <= MAX_CLIENTS; c += 1) {
    const n = toNum(grid[idx]?.[firstCol + c - 1]);
    out[c] = n == null ? null : round2(n);
  }
  return out;
}

/** Locate first col of the "1..6" client headers on the "Clients:" row. */
function findClientsCol(grid, afterCol) {
  for (const row of grid.slice(0, 15)) {
    for (let c = afterCol; c < (row || []).length; c += 1) {
      if (/^clients:?$/i.test(cellStr(row, c)) && toNum(row[c + 1]) === 1) return c + 1;
    }
  }
  return null;
}

export function parseLocations(grid) {
  const seen = new Map();
  for (const row of grid.slice(40)) {
    const name = cellStr(row, 0);
    const rate = toNum(row?.[4]);
    if (!name || rate == null || rate <= 0 || /^\d+$/.test(name)) continue;
    if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), { name, roomRate: rate });
  }
  return [...seen.values()];
}

/**
 * @returns {{ dayNetByClients:(number|null)[], resNetByClients:(number|null)[], locations:object[], rates:object, sheet:string|null }}
 */
export function parseWorkshopCosts(wb) {
  const sheet = findWorkshopCostsSheet(wb);
  const empty = { dayNetByClients: new Array(MAX_CLIENTS + 1).fill(null), resNetByClients: new Array(MAX_CLIENTS + 1).fill(null), locations: [], rates: {}, sheet: null };
  if (!sheet) return empty;
  const grid = xlsx.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: '' });
  const resCol = findClientsCol(grid, 0);
  const dayCol = findClientsCol(grid, (resCol ?? 0) + MAX_CLIENTS);
  return {
    sheet,
    rates: parseRates(grid),
    resNetByClients: resCol == null ? empty.resNetByClients : readNetCurve(grid, 1, resCol),
    dayNetByClients: dayCol == null ? empty.dayNetByClients : readNetCurve(grid, 11, dayCol),
    locations: parseLocations(grid)
  };
}

export function hasCostModel(model) {
  return !!model && [...(model.dayNetByClients || []), ...(model.resNetByClients || [])].some((n) => n != null);
}

export async function persistWorkshopCostModel(supabase, propertyUrl, model) {
  if (!hasCostModel(model)) return { written: 0, error: null };
  const { error } = await supabase.from('booking_sheet_workshop_cost_model').upsert({
    property_url: propertyUrl,
    model,
    updated_at: new Date().toISOString()
  });
  return { written: error ? 0 : 1, error: error ? error.message : null };
}

export async function loadWorkshopCostModel(supabase, propertyUrl) {
  try {
    const { data } = await supabase.from('booking_sheet_workshop_cost_model')
      .select('model').eq('property_url', propertyUrl).maybeSingle();
    if (!data?.model) return null;
    const { mergeTravelIntoCostModel } = await import('./workshop-travel-defaults.mjs');
    return mergeTravelIntoCostModel(data.model);
  } catch (_e) {
    return null;
  }
}

/** Net GP £ at `clients` occupancy (clamped 0..6); null when curve unknown. */
export function netAt(curve, clients) {
  if (!curve) return null;
  const n = Math.max(0, Math.min(MAX_CLIENTS, Math.round(Number(clients) || 0)));
  if (n === 0) return null;
  return curve[n] ?? null;
}
