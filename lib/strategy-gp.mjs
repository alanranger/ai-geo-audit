/**
 * Per-event GP from Workshop Costs + travel mileage/time.
 * Two bases: time free (cash) and after Alan's time (£30/h).
 */
import { costPerMile, mergeTravelIntoCostModel } from './workshop-travel-defaults.mjs';

const MAX = 6;
const CATEGORY_BY_TYPE = { course: 1, day: 2, walk: 2, residential: 3 };

function round0(n) {
  return Math.round(Number(n) || 0);
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
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

/** Match title / location_name → locations[] via keywords (longest win). */
export function matchLocation(title, locations, locationName = '') {
  const blob = `${String(title || '')} ${String(locationName || '')}`.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const loc of locations || []) {
    const keys = [...(loc.keywords || []), loc.name].filter(Boolean);
    for (const k of keys) {
      const n = String(k).toLowerCase();
      if (n.length < 3 || !blob.includes(n)) continue;
      if (n.length > bestScore) {
        best = loc;
        bestScore = n.length;
      }
    }
  }
  return best;
}

export function eventDuration(e) {
  if (e.type === 'residential') {
    const days = e.days != null ? Number(e.days)
      : (e.end && e.date
        ? Math.max(1, Math.round((new Date(`${e.end}T12:00:00Z`) - new Date(`${e.date}T12:00:00Z`)) / 86400000) + 1)
        : 2);
    const nights = e.nights != null ? Number(e.nights) : Math.max(0, days - 1);
    return { days, nights };
  }
  return { days: 1, nights: 0 };
}

/** Hours between HH:MM[:SS] start/end; null if missing. */
export function sessionHoursFromTimes(startTime, endTime) {
  if (!startTime || !endTime) return null;
  const toMin = (t) => {
    const p = String(t).split(':').map(Number);
    return (p[0] || 0) * 60 + (p[1] || 0);
  };
  const d = toMin(endTime) - toMin(startTime);
  return d > 0 ? d / 60 : null;
}

function isSessionProduct(e) {
  if (e.session) return true;
  return /batsford|bluebell|\bAM\b|\bPM\b|all\s*day/i.test(String(e.title || ''));
}

/**
 * Component GP at `clients`.
 * gp_free = Net (ex time); gp_after = Net Profit (incl time).
 */
export function computeComponentGp(opts) {
  const clients = Math.max(0, Math.round(Number(opts.clients) || 0));
  const price = Number(opts.price) || 0;
  const rates = opts.rates || {};
  const cardFee = rates.card_fee != null ? Number(rates.card_fee) : 0.025;
  const discount = opts.discount != null ? Number(opts.discount) : 0.05;
  const adminFull = rates.admin != null ? Number(rates.admin) : 75;
  const hourly = rates.hourly != null ? Number(rates.hourly) : 30;
  const foodDay = rates.food_per_day != null ? Number(rates.food_per_day) : 50;
  const carDay = rates.car_hire_per_day != null ? Number(rates.car_hire_per_day) : 175;
  const cpm = costPerMile(rates);
  const tripShare = opts.tripShare != null ? Number(opts.tripShare) : 1;

  if (clients <= 0) {
    return {
      gp_free: 0, gp_after: 0, gp: 0, tooltip: 'No bookings',
      parts: {}, time_note: '', unmatched: !!opts.unmatched
    };
  }

  const netRev = price * clients * (1 - discount);
  const card = netRev * cardFee;
  let rooms = 0;
  let car = 0;
  let food = 0;
  let admin = 0;
  let days = 1;
  let label = 'day';
  let sessionH = 0;
  let driveH = 0;
  let miles = 0;

  const oneWayMi = Number(opts.one_way_miles) || 0;
  const oneWayH = Number(opts.one_way_drive_h) || 0;
  const localMi = Number(opts.local_miles_per_day) || 0;

  if (opts.kind === 'residential') {
    days = Math.max(1, Number(opts.days) || 2);
    const nights = Math.max(0, Number(opts.nights) || days - 1);
    rooms = (Number(opts.roomRate) || 0) * (clients + 1) * nights;
    car = clients > 4 ? carDay * days : 0;
    food = foodDay * days;
    admin = adminFull;
    sessionH = days * 8;
    driveH = 2 * oneWayH;
    miles = 2 * oneWayMi + localMi * days;
    label = 'residential';
  } else {
    const dayFood = rates.day_food != null ? Number(rates.day_food) : 10;
    const dayAdmin = rates.day_admin != null ? Number(rates.day_admin) : adminFull / 2;
    sessionH = Number(opts.session_hours) || 0;
    // Session products (AM/PM): share food + admin once per day, same as the trip
    food = dayFood * tripShare;
    admin = dayAdmin * tripShare;
    driveH = (2 * oneWayH) * tripShare;
    miles = (2 * oneWayMi) * tripShare;
    label = 'day';
  }

  // Home (CV4): no food, no mileage, no travel time — admin + card only
  if (opts.is_home) {
    food = 0;
    driveH = 0;
    miles = 0;
  }

  const timeCost = (sessionH + driveH) * hourly;
  const petrol = miles * cpm;
  const gpFree = netRev - (card + rooms + car + petrol + food + admin);
  const gpAfter = gpFree - timeCost;

  const pence = Math.round(cpm * 1000) / 10;
  const timeNote = opts.is_home
    ? `Time: ${round1(sessionH)} h × £${hourly} = £${round0(timeCost)}`
    : `Time: ${round1(sessionH)} h + ${round1(driveH)} h travel × £${hourly} = £${round0(timeCost)}`;
  const mileNote = opts.is_home
    ? 'no travel / mileage / food (home)'
    : `Mileage: ${round0(miles)} mi × ${pence}p = £${round0(petrol)}`;
  const cashBits = [
    rooms ? `rooms £${round0(rooms)}` : null,
    car ? `car £${round0(car)}` : null,
    food ? `food £${round0(food)}` : null,
    petrol ? `mileage £${round0(petrol)}` : null,
    `admin £${round0(admin)}`,
    `card £${round0(card)}`
  ].filter(Boolean);
  const tip = [
    `Time free: Revenue £${round0(netRev)} − ${cashBits.join(' − ')} = £${round0(gpFree)}`,
    `After time: £${round0(gpFree)} − ${timeNote} = £${round0(gpAfter)} (${label})`,
    `${timeNote} · ${mileNote}`
  ].join(' · ');

  return {
    gp_free: round0(gpFree),
    gp_after: round0(gpAfter),
    gp: round0(gpAfter),
    tooltip: tip,
    time_note: timeNote,
    parts: {
      revenue: round0(netRev), rooms: round0(rooms), car: round0(car), petrol: round0(petrol),
      food: round0(food), admin: round0(admin), card: round0(card), time: round0(timeCost),
      miles: round0(miles), session_h: round1(sessionH), drive_h: round1(driveH),
      net: round0(gpFree)
    },
    unmatched: !!opts.unmatched
  };
}

export function breakEvenFromGp(calcAt) {
  for (let n = 1; n <= MAX; n += 1) {
    if (calcAt(n) > 0) return n;
  }
  return MAX;
}

function estimateGp(e, gpRates) {
  const rate = rateFor(gpRates, e.type, e.date);
  const freeNow = round0((e.booked_gbp || 0) * rate);
  const freeFull = round0((e.cap || 0) * (e.price || 0) * rate);
  return {
    gp_now_free: freeNow,
    gp_now_after: null,
    gp_full_free: freeFull,
    gp_full_after: null,
    gp_now: freeNow,
    gp_full: freeFull,
    gp_est: true,
    gp_tooltip: 'Estimated from category GP rate (no Costs-tab row for walks/courses). After time: —',
    be_free: e.be,
    be_after: null,
    be: e.be,
    be_label: null
  };
}

/** RAG / status from B/E time free (losing cash). */
function attachBe(e, beFree, beAfter) {
  e.be_free = beFree;
  e.be_after = beAfter;
  e.be = beFree;
  const short = Math.max(0, beFree - (e.booked || 0));
  e.be_label = e.booked < beFree ? `${beFree} needed / ${short} short (time free)` : null;
  if (e.over) e.status = 'Over cap';
  else if (e.booked >= e.cap) { e.status = 'Full'; e.rag = 'green'; e.full = true; }
  else if (e.booked <= 0) { e.status = 'No bookings'; e.rag = 'red'; e.full = false; }
  else if (e.booked < beFree) { e.status = 'Below break-even'; e.rag = 'amber'; e.full = false; }
  else {
    const fill = e.cap > 0 ? e.booked / e.cap : 0;
    e.status = 'OK';
    e.rag = fill >= 0.5 ? 'green' : 'amber';
    e.full = false;
  }
}

function blankParentGp(e) {
  Object.assign(e, {
    gp_now: null, gp_full: null, gp_now_free: null, gp_now_after: null,
    gp_full_free: null, gp_full_after: null, gp_est: false, gp_tooltip: '',
    no_location: false
  });
}

function findSchedule(e, schedule) {
  const date = e.date;
  const nt = String(e.title || '').toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const s of schedule || []) {
    if (String(s.start_date).slice(0, 10) !== date) continue;
    const st = String(s.title || '').toLowerCase();
    let score = 0;
    if (st.includes('padley') && nt.includes('padley')) score += 20;
    if (st.includes('batsford') && nt.includes('batsford')) score += 20;
    if (st.includes('vyrnw') && /vyrnw|pistyll/.test(nt)) score += 20;
    if (st.includes('norfolk') && nt.includes('norfolk')) score += 20;
    if (st.includes('lake district') && nt.includes('lake district')) score += 20;
    const words = nt.split(/\s+/).filter((w) => w.length >= 4);
    score += words.filter((w) => st.includes(w)).length;
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return bestScore >= 2 ? best : null;
}

function tripGroupKey(e, loc) {
  const locKey = loc?.name || 'none';
  if (isSessionProduct(e)) return `${e.date}|session|${locKey}`;
  return `${e.date}|solo|${e.eventKey || e.title}`;
}

/**
 * Mutates diary rows; parents skipped.
 * @param {object[]} [schedule] csv_metadata workshop_events rows
 * @returns {{ diary, unmatched: string[] }}
 */
export function applyDiaryGp(diary, model, gpRates, schedule = []) {
  const unmatched = [];
  const merged = mergeTravelIntoCostModel(model || {});
  const rates = {
    ...merged.rates,
    day_food: merged.rates?.day_food ?? 10,
    day_admin: merged.rates?.day_admin ?? ((merged.rates?.admin || 75) / 2)
  };
  const locations = merged.locations || [];

  // Enrich + match first
  const workRows = [];
  for (const e of diary || []) {
    if (e.is_parent) { blankParentGp(e); continue; }
    if (e.type === 'course' || !merged?.rates) {
      Object.assign(e, estimateGp(e, gpRates));
      e.no_location = false;
      continue;
    }

    const { days, nights } = eventDuration(e);
    const sched = findSchedule(e, schedule);
    e.start_time = sched?.start_time || e.start_time || null;
    e.end_time = sched?.end_time || e.end_time || null;
    e.location_name = sched?.location_name || e.location_name || null;

    const loc = matchLocation(e.title, locations, e.location_name);
    const noLoc = !loc || (loc.one_way_miles == null && loc.name !== 'Home');
    // Home has miles 0 — counts as matched
    const unmatchedLoc = !loc;
    if (unmatchedLoc) unmatched.push(`${e.date} ${e.title}`);

    let sessionHours = e.type === 'residential'
      ? days * 8
      : sessionHoursFromTimes(e.start_time, e.end_time);
    if (sessionHours == null && e.type !== 'residential') sessionHours = 0;
    // Single all-day schedule row shared by AM/PM → each session gets half the block
    if (e.type !== 'residential' && sessionHours > 0 && (e.session === 'AM' || e.session === 'PM')) {
      sessionHours = sessionHours / 2;
    }

    e._gpMeta = {
      days, nights, loc, unmatchedLoc, sessionHours,
      kind: e.type === 'residential' ? 'residential' : 'day'
    };
    e.days = days;
    e.nights = nights;
    e.location_match = loc?.name || null;
    e.no_location = unmatchedLoc;
    workRows.push(e);
  }

  // Session trip groups (day products only)
  const groups = new Map();
  for (const e of workRows) {
    if (e._gpMeta.kind === 'residential') continue;
    const key = tripGroupKey(e, e._gpMeta.loc);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  function shareFor(e, clients) {
    if (e._gpMeta.kind === 'residential' || !isSessionProduct(e)) return 1;
    const key = tripGroupKey(e, e._gpMeta.loc);
    const group = groups.get(key) || [e];
    const others = group.filter((x) => x !== e && (x.booked || 0) > 0);
    const self = clients > 0 ? 1 : 0;
    const n = others.length + self;
    return n > 0 ? 1 / n : 1;
  }

  for (const e of workRows) {
    const m = e._gpMeta;
    const price = (e.onSale && e.salePrice != null) ? Number(e.salePrice) : Number(e.price) || 0;
    const isHome = String(m.loc?.name || '') === 'Home';
    const base = {
      price, rates, discount: 0.05,
      kind: m.kind,
      days: m.days, nights: m.nights,
      roomRate: m.loc?.roomRate || 0,
      one_way_miles: isHome ? 0 : (m.loc?.one_way_miles ?? 0),
      one_way_drive_h: isHome ? 0 : (m.loc?.one_way_drive_h ?? 0),
      local_miles_per_day: isHome ? 0 : (m.loc?.local_miles_per_day ?? 0),
      session_hours: m.sessionHours,
      is_home: isHome,
      unmatched: m.unmatchedLoc
    };

    const now = computeComponentGp({ ...base, clients: e.booked, tripShare: shareFor(e, e.booked) });
    const fullN = Math.min(MAX, Math.max(1, e.cap || MAX));
    const full = computeComponentGp({ ...base, clients: fullN, tripShare: shareFor(e, fullN) });
    const beFree = breakEvenFromGp((n) => computeComponentGp({ ...base, clients: n, tripShare: shareFor(e, n) }).gp_free);
    const beAfter = breakEvenFromGp((n) => computeComponentGp({ ...base, clients: n, tripShare: shareFor(e, n) }).gp_after);

    e.gp_now_free = now.gp_free;
    e.gp_now_after = now.gp_after;
    e.gp_full_free = full.gp_free;
    e.gp_full_after = full.gp_after;
    e.gp_now = now.gp_after;
    e.gp_full = full.gp_after;
    e.gp_est = false;
    e.gp_tooltip = now.tooltip + (m.unmatchedLoc ? ' · no location matched' : '');
    attachBe(e, beFree, beAfter);
    delete e._gpMeta;
  }

  return { diary, unmatched: [...new Set(unmatched)] };
}

export function gpTotals(diary) {
  const rows = (diary || []).filter((e) => !e.is_parent);
  const sum = (key) => rows.reduce((a, e) => a + (e[key] != null ? Number(e[key]) : 0), 0);
  const withFree = rows.filter((e) => e.gp_now_free != null);
  return {
    now_free: sum('gp_now_free'),
    now_after: sum('gp_now_after'),
    full_free: sum('gp_full_free'),
    full_after: sum('gp_full_after'),
    now: sum('gp_now_after') || sum('gp_now_free'),
    full: sum('gp_full_after') || sum('gp_full_free'),
    est_rows: rows.filter((e) => e.gp_est).length,
    rows: withFree.length
  };
}
