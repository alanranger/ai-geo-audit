/**
 * Per-event GP from Workshop Costs components (mirrors sheet formulas).
 * Uses Net Profit (= Net − Alan's time) so B/E matches the sheet's lived break-even.
 */
const MAX = 6;
const CATEGORY_BY_TYPE = { course: 1, day: 2, walk: 2, residential: 3 };

function round0(n) {
  return Math.round(Number(n) || 0);
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

/** Match product title → locations[].name (fuzzy contains). */
export function matchLocation(title, locations) {
  const t = String(title || '').toLowerCase();
  let best = null;
  for (const loc of locations || []) {
    const n = String(loc.name || '').toLowerCase();
    if (!n || n.length < 3) continue;
    if (t.includes(n) || n.split(/\s+/).every((w) => w.length < 3 || t.includes(w))) {
      if (!best || n.length > String(best.name).length) best = loc;
    }
  }
  // Lake Vyrnwy / Vyrnwy / Vyrnwey
  if (!best && /vyrnw/.test(t)) {
    best = (locations || []).find((l) => /vyrnw/i.test(l.name)) || null;
  }
  return best;
}

/**
 * Days/nights from event span or title ("3 Days", "Fri 13–15 Nov").
 * Residential default: nights = days - 1. Day/walk/course: days=1, nights=0.
 */
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

/**
 * Sheet Net Profit at `clients` for one event.
 * Residential: discount 5%, B&B = roomRate×(clients+1)×nights, car if clients>4,
 *   petrol/food = rate×days, admin full, time = days×8×hourly.
 * Day/session: discount 5% (sheet uses $C16), petrol 56.25, food 10, admin half,
 *   time = 2.5×hourly. No rooms/car.
 */
export function computeComponentGp(opts) {
  const clients = Math.max(0, Math.round(Number(opts.clients) || 0));
  const price = Number(opts.price) || 0;
  const rates = opts.rates || {};
  const cardFee = rates.card_fee != null ? Number(rates.card_fee) : 0.025;
  const discount = opts.discount != null ? Number(opts.discount) : 0.05;
  const adminFull = rates.admin != null ? Number(rates.admin) : 75;
  const hourly = rates.hourly != null ? Number(rates.hourly) : 30;
  const petrolDay = rates.petrol_per_day != null ? Number(rates.petrol_per_day) : 50;
  const foodDay = rates.food_per_day != null ? Number(rates.food_per_day) : 50;
  const carDay = rates.car_hire_per_day != null ? Number(rates.car_hire_per_day) : 175;

  if (clients <= 0) {
    return { gp: 0, tooltip: 'No bookings', parts: {} };
  }

  const revenue = price * clients;
  const discAmt = revenue * discount;
  const netRev = revenue - discAmt;
  const card = netRev * cardFee;

  let rooms = 0;
  let car = 0;
  let petrol = 0;
  let food = 0;
  let admin = 0;
  let timeCost = 0;
  let label = '';

  if (opts.kind === 'residential') {
    const days = Math.max(1, Number(opts.days) || 2);
    const nights = Math.max(0, Number(opts.nights) || days - 1);
    const roomRate = Number(opts.roomRate) || 0;
    rooms = roomRate * (clients + 1) * nights;
    car = clients > 4 ? carDay * days : 0;
    petrol = petrolDay * days;
    food = foodDay * days;
    admin = adminFull;
    timeCost = days * 8 * hourly;
    label = 'residential';
  } else {
    // Day / half-day / session — mirror day block constants
    petrol = rates.day_petrol != null ? Number(rates.day_petrol) : 56.25;
    food = rates.day_food != null ? Number(rates.day_food) : 10;
    admin = rates.day_admin != null ? Number(rates.day_admin) : adminFull / 2;
    timeCost = (rates.day_hours != null ? Number(rates.day_hours) : 2.5) * hourly;
    label = 'day';
  }

  const costsExTime = card + rooms + car + petrol + food + admin;
  const net = netRev - costsExTime;
  const gp = net - timeCost;
  const costBits = [
    rooms ? `rooms £${round0(rooms)}` : null,
    car ? `car £${round0(car)}` : null,
    (food + petrol) ? `food/petrol £${round0(food + petrol)}` : null,
    `admin £${round0(admin)}`,
    `card £${round0(card)}`,
    `time £${round0(timeCost)}`
  ].filter(Boolean);

  return {
    gp: round0(gp),
    tooltip: `Revenue £${round0(netRev)} − ${costBits.join(' − ')} = £${round0(gp)} (${label})`,
    parts: {
      revenue: round0(netRev), rooms: round0(rooms), car: round0(car), petrol: round0(petrol),
      food: round0(food), admin: round0(admin), card: round0(card), time: round0(timeCost), net: round0(net)
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
  return {
    gp_now: round0((e.booked_gbp || 0) * rate),
    gp_full: round0((e.cap || 0) * (e.price || 0) * rate),
    gp_est: true,
    gp_tooltip: 'Estimated from category GP rate (no Costs-tab row for walks/courses)',
    be: e.be,
    be_label: null
  };
}

function attachBe(e, be) {
  const short = Math.max(0, be - (e.booked || 0));
  e.be = be;
  e.be_label = e.booked < be ? `${be} needed / ${short} short` : null;
  // Recompute status/rag from booked vs new be
  if (e.over) e.status = 'Over cap';
  else if (e.booked >= e.cap) { e.status = 'Full'; e.rag = 'green'; e.full = true; }
  else if (e.booked <= 0) { e.status = 'No bookings'; e.rag = 'red'; e.full = false; }
  else if (e.booked < be) { e.status = 'Below break-even'; e.rag = 'amber'; e.full = false; }
  else {
    const fill = e.cap > 0 ? e.booked / e.cap : 0;
    e.status = 'OK';
    e.rag = fill >= 0.5 ? 'green' : 'amber';
    e.full = false;
  }
}

/** Mutates diary rows; parents skipped. Returns unmatched location titles. */
export function applyDiaryGp(diary, model, gpRates) {
  const unmatched = [];
  const rates = {
    ...(model?.rates || {}),
    day_petrol: model?.rates?.day_petrol ?? 56.25,
    day_food: model?.rates?.day_food ?? 10,
    day_admin: model?.rates?.day_admin ?? ((model?.rates?.admin || 75) / 2),
    day_hours: model?.rates?.day_hours ?? 2.5
  };
  const locations = model?.locations || [];

  for (const e of diary || []) {
    if (e.is_parent) {
      Object.assign(e, { gp_now: null, gp_full: null, gp_est: false, gp_tooltip: '' });
      continue;
    }
    if (e.type === 'walk' || e.type === 'course') {
      Object.assign(e, estimateGp(e, gpRates));
      continue;
    }
    if (!model?.rates) {
      Object.assign(e, estimateGp(e, gpRates));
      continue;
    }

    const { days, nights } = eventDuration(e);
    const loc = e.type === 'residential' ? matchLocation(e.title, locations) : null;
    if (e.type === 'residential' && !loc) unmatched.push(`${e.date} ${e.title}`);

    const price = (e.onSale && e.salePrice != null) ? Number(e.salePrice) : Number(e.price) || 0;
    const base = {
      price,
      rates,
      discount: 0.05,
      kind: e.type === 'residential' ? 'residential' : 'day',
      days,
      nights,
      roomRate: loc?.roomRate || 0,
      unmatched: e.type === 'residential' && !loc
    };

    const now = computeComponentGp({ ...base, clients: e.booked });
    const fullN = Math.min(MAX, Math.max(1, e.cap || MAX));
    const full = computeComponentGp({ ...base, clients: fullN });
    const be = breakEvenFromGp((n) => computeComponentGp({ ...base, clients: n }).gp);

    e.gp_now = now.gp;
    e.gp_full = full.gp;
    e.gp_est = false;
    e.gp_tooltip = now.tooltip + (base.unmatched ? ' · location unmatched — room £0' : '');
    e.days = days;
    e.nights = nights;
    e.location_match = loc?.name || null;
    attachBe(e, be);
  }
  return { diary, unmatched: [...new Set(unmatched)] };
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
