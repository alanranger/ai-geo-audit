/**
 * Strategy diary GP columns (GP now / GP if full).
 * Primary: Workshop Costs net-by-occupancy model (day + residential curves).
 * Fallback (walks, courses, or no model): category GP rate x £ booked, flagged gp_est.
 */
import { netAt } from './booking-sheet-workshop-costs.mjs';

const MAX_CLIENTS = 6;
const CATEGORY_BY_TYPE = { course: 1, day: 2, walk: 2, residential: 3 };

function curveFor(model, type) {
  if (!model) return null;
  if (type === 'residential') return model.resNetByClients || null;
  if (type === 'day') return model.dayNetByClients || null;
  return null;
}

function rateFor(gpRates, type, date) {
  const order = CATEGORY_BY_TYPE[type] || 2;
  const year = Number(String(date || '').slice(0, 4));
  const rows = (gpRates || []).filter((g) => Number(g.category_order) === order);
  const exact = rows.find((g) => Number(g.year) === year);
  const latest = rows.slice().sort((a, b) => Number(b.year) - Number(a.year))[0];
  const hit = exact || latest;
  return hit ? Number(hit.gp_rate) || 0 : 0;
}

function round0(n) {
  return Math.round(n);
}

function modelGp(e, curve) {
  const now = e.booked > 0 ? netAt(curve, e.booked) : 0;
  const fullClients = Math.min(MAX_CLIENTS, Math.max(1, e.cap || MAX_CLIENTS));
  const full = netAt(curve, fullClients);
  if (now == null || full == null) return null;
  return { gp_now: round0(now), gp_full: round0(full), gp_est: false };
}

function estimateGp(e, gpRates) {
  const rate = rateFor(gpRates, e.type, e.date);
  return {
    gp_now: round0((e.booked_gbp || 0) * rate),
    gp_full: round0((e.cap || 0) * (e.price || 0) * rate),
    gp_est: true
  };
}

/** Mutates diary rows in place; parent rows get no GP (sub-rows carry it). */
export function applyDiaryGp(diary, model, gpRates) {
  for (const e of diary || []) {
    if (e.is_parent) {
      Object.assign(e, { gp_now: null, gp_full: null, gp_est: false });
      continue;
    }
    const curve = curveFor(model, e.type);
    Object.assign(e, (curve && modelGp(e, curve)) || estimateGp(e, gpRates));
  }
  return diary;
}

export function gpTotals(diary) {
  const rows = (diary || []).filter((e) => !e.is_parent && e.gp_now != null);
  return {
    now: rows.reduce((a, e) => a + e.gp_now, 0),
    full: rows.reduce((a, e) => a + (e.gp_full || 0), 0),
    est_rows: rows.filter((e) => e.gp_est).length,
    rows: rows.length
  };
}
