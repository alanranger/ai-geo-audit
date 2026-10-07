/**
 * Per-event GP from Workshop Costs components.
 * Two bases: time free (cash) and after Alan's time (£30/h).
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
  if (!best && /vyrnw/.test(t)) {
    best = (locations || []).find((l) => /vyrnw/i.test(l.name)) || null;
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

function timeNote(opts, days, hourly, timeCost) {
  if (opts.kind === 'residential') {
    return `time: ${days} days × 8 h × £${hourly} = £${round0(timeCost)}`;
  }
  const hrs = opts.rates?.day_hours != null ? Number(opts.rates.day_hours) : 2.5;
  return `time: ${hrs} h × £${hourly} = £${round0(timeCost)}`;
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
  const petrolDay = rates.petrol_per_day != null ? Number(rates.petrol_per_day) : 50;
  const foodDay = rates.food_per_day != null ? Number(rates.food_per_day) : 50;
  const carDay = rates.car_hire_per_day != null ? Number(rates.car_hire_per_day) : 175;

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
  let petrol = 0;
  let food = 0;
  let admin = 0;
  let timeCost = 0;
  let days = 1;
  let label = 'day';

  if (opts.kind === 'residential') {
    days = Math.max(1, Number(opts.days) || 2);
    const nights = Math.max(0, Number(opts.nights) || days - 1);
    rooms = (Number(opts.roomRate) || 0) * (clients + 1) * nights;
    car = clients > 4 ? carDay * days : 0;
    petrol = petrolDay * days;
    food = foodDay * days;
    admin = adminFull;
    timeCost = days * 8 * hourly;
    label = 'residential';
  } else {
    petrol = rates.day_petrol != null ? Number(rates.day_petrol) : 56.25;
    food = rates.day_food != null ? Number(rates.day_food) : 10;
    admin = rates.day_admin != null ? Number(rates.day_admin) : adminFull / 2;
    timeCost = (rates.day_hours != null ? Number(rates.day_hours) : 2.5) * hourly;
  }

  const gpFree = netRev - (card + rooms + car + petrol + food + admin);
  const gpAfter = gpFree - timeCost;
  const cashBits = [
    rooms ? `rooms £${round0(rooms)}` : null,
    car ? `car £${round0(car)}` : null,
    (food + petrol) ? `food/petrol £${round0(food + petrol)}` : null,
    `admin £${round0(admin)}`,
    `card £${round0(card)}`
  ].filter(Boolean);
  const tNote = timeNote(opts, days, hourly, timeCost);
  const tip = [
    `Time free: Revenue £${round0(netRev)} − ${cashBits.join(' − ')} = £${round0(gpFree)}`,
    `After time: £${round0(gpFree)} − ${tNote} = £${round0(gpAfter)} (${label})`
  ].join(' · ');

  return {
    gp_free: round0(gpFree),
    gp_after: round0(gpAfter),
    gp: round0(gpAfter),
    tooltip: tip,
    time_note: tNote,
    parts: {
      revenue: round0(netRev), rooms: round0(rooms), car: round0(car), petrol: round0(petrol),
      food: round0(food), admin: round0(admin), card: round0(card), time: round0(timeCost),
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
    gp_full_free: null, gp_full_after: null, gp_est: false, gp_tooltip: ''
  });
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
    if (e.is_parent) { blankParentGp(e); continue; }
    if (e.type === 'walk' || e.type === 'course' || !model?.rates) {
      Object.assign(e, estimateGp(e, gpRates));
      continue;
    }

    const { days, nights } = eventDuration(e);
    const loc = e.type === 'residential' ? matchLocation(e.title, locations) : null;
    if (e.type === 'residential' && !loc) unmatched.push(`${e.date} ${e.title}`);

    const price = (e.onSale && e.salePrice != null) ? Number(e.salePrice) : Number(e.price) || 0;
    const base = {
      price, rates, discount: 0.05,
      kind: e.type === 'residential' ? 'residential' : 'day',
      days, nights, roomRate: loc?.roomRate || 0,
      unmatched: e.type === 'residential' && !loc
    };

    const now = computeComponentGp({ ...base, clients: e.booked });
    const fullN = Math.min(MAX, Math.max(1, e.cap || MAX));
    const full = computeComponentGp({ ...base, clients: fullN });
    const beFree = breakEvenFromGp((n) => computeComponentGp({ ...base, clients: n }).gp_free);
    const beAfter = breakEvenFromGp((n) => computeComponentGp({ ...base, clients: n }).gp_after);

    e.gp_now_free = now.gp_free;
    e.gp_now_after = now.gp_after;
    e.gp_full_free = full.gp_free;
    e.gp_full_after = full.gp_after;
    e.gp_now = now.gp_after;
    e.gp_full = full.gp_after;
    e.gp_est = false;
    e.gp_tooltip = now.tooltip + (base.unmatched ? ' · location unmatched — room £0' : '');
    e.days = days;
    e.nights = nights;
    e.location_match = loc?.name || null;
    attachBe(e, beFree, beAfter);
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
