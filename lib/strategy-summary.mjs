/**
 * Strategy & KPIs summary for dashboard + Monday brief.
 * Complexity kept low: small helpers, no invented sample rows.
 */
import { loadBusinessTargets, resolveCostRiseByYear, GP_TARGET_BASE_YEAR } from './business-targets.mjs';
import { ROADMAP_MILESTONES, STRATEGY_QUARTERS, ensureStrategyActions } from './strategy-action-seed.mjs';
import { loadSquarespaceEventFeeds, themeMatchesTitle } from './squarespace-events-feed.mjs';
import { buildStrategyDiary, buildPushList, buildActionNeeded, loadProductVariants, makeProductCapLookup } from './strategy-diary.mjs';
import { staleSalesKeys, runStrategyEventSnapshots, londonYmd, londonHour } from './strategy-snapshots.mjs';
import { loadWorkshopCostModel } from './booking-sheet-workshop-costs.mjs';
import { applyDiaryGp, gpTotals } from './strategy-gp.mjs';

const SNAPSHOT_EPOCH = '2026-10-07';

const PROP = 'https://www.alanranger.com';
const BEG_CAP = 4;
const DAY_CAP = 4;
const RES_CAP = 4;
const EXCEPTIONAL = 3000;

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function mondayOf(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay() || 7;
  if (day !== 1) x.setUTCDate(x.getUTCDate() - (day - 1));
  return x;
}

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

async function pageAll(supabase, table, select, eqCol, eqVal) {
  const pageSize = 1000;
  const out = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .eq(eqCol, eqVal)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

/** D2C + B2B category orders that contribute to Strategy GP (excl. Pick n Mix / ADJUSTMENT). */
const GP_CATEGORY_ORDERS = [1, 2, 3, 6, 7, 10, 11, 12];

const GP_CATEGORY_LABELS = [
  { id: 1, name: 'Courses' },
  { id: 2, name: 'Workshops (day)' },
  { id: 3, name: 'Residentials' },
  { id: 7, name: '1-2-1' },
  { id: 6, name: 'Mentoring' },
  { id: 11, name: 'Commissions' },
  { id: 12, name: 'Academy' },
  { id: 10, name: 'Prints & royalties' }
];

/** Per-category rows since Jan 2024: { period, category_order, gp, revenue }. */
function gpByMonthByCategory(cats, gpRates) {
  const rate = new Map();
  for (const g of gpRates) rate.set(`${g.year}|${g.category_order}`, Number(g.gp_rate) || 0);
  const by = new Map();
  for (const r of cats) {
    const order = Number(r.category_order);
    if (!GP_CATEGORY_ORDERS.includes(order)) continue;
    const period = `${r.year}-${String(r.month).padStart(2, '0')}`;
    if (period < '2024-01') continue;
    const revenue = Number(r.revenue_amount || 0);
    const gp = revenue * (rate.get(`${r.year}|${order}`) || 0);
    const key = `${period}|${order}`;
    const cur = by.get(key) || { gp: 0, revenue: 0 };
    cur.gp += gp;
    cur.revenue += revenue;
    by.set(key, cur);
  }
  return [...by.entries()]
    .map(([key, v]) => {
      const [period, orderStr] = key.split('|');
      return {
        period,
        category_order: Number(orderStr),
        gp: Math.round(v.gp),
        revenue: Math.round(v.revenue)
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period) || a.category_order - b.category_order);
}

function gpByMonthTotals(byCat) {
  const by = new Map();
  for (const r of byCat || []) {
    by.set(r.period, (by.get(r.period) || 0) + Number(r.gp || 0));
  }
  return [...by.entries()]
    .map(([period, gp]) => ({ period, gp: Math.round(gp * 100) / 100 }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

function trailingAvg(series, n = 3, asOfPeriod = null) {
  const cutoff = asOfPeriod || isoDate(new Date()).slice(0, 7);
  const closed = series.filter((s) => s.period < cutoff);
  const last = closed.slice(-n);
  if (!last.length) return null;
  return Math.round((last.reduce((a, s) => a + s.gp, 0) / last.length) * 100) / 100;
}

function avgInWindow(series, startPeriod, endPeriod) {
  const rows = series.filter((s) => s.period >= startPeriod && s.period <= endPeriod);
  if (!rows.length) return null;
  return Math.round((rows.reduce((a, s) => a + s.gp, 0) / rows.length) * 100) / 100;
}

function changePct(cur, prior) {
  if (cur == null || prior == null || !Number.isFinite(Number(cur)) || !Number.isFinite(Number(prior))) return null;
  if (Number(prior) === 0) return null;
  return Math.round(((Number(cur) - Number(prior)) / Math.abs(Number(prior))) * 1000) / 10;
}

function fillPct(booked, cap) {
  if (!cap) return null;
  return Math.min(100, Math.round((booked / cap) * 1000) / 10);
}

function returningRevenue(txns, now) {
  const start = addDays(now, -365);
  let sum = 0;
  for (const t of txns) {
    if (!t.txn_date) continue;
    const d = new Date(`${t.txn_date}T12:00:00Z`);
    if (d < start || d > now) continue;
    if (t.is_jlr) continue;
    if (Number(t.amount) >= EXCEPTIONAL) continue;
    if ([4, 5, 8, 9].includes(Number(t.category_order))) continue;
    if (t.client_type !== 'Existing') continue;
    sum += Number(t.amount) || 0;
  }
  return Math.round(sum * 100) / 100;
}

function avgBookedPerRun(rows, start, end, predicate) {
  const map = new Map();
  for (const r of rows || []) {
    const d = r.event_start || r.from_date || r.to_date;
    if (!d || d < start || d > end || !r.client_name) continue;
    if (isExcludedWorkshopRow(r)) continue;
    if (predicate && !predicate(r)) continue;
    const key = `${d}|${String(r.theme_location || r.event_name || '').slice(0, 40)}`;
    map.set(key, (map.get(key) || 0) + 1);
  }
  const vals = [...map.values()];
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

/** Skip cancel / refund / did-not-run rows (theme or source). */
function isExcludedWorkshopRow(r) {
  const theme = String(r?.theme_location || r?.event_name || '');
  const source = String(r?.source || '');
  const blob = `${theme} ${source}`;
  return /^cancel/i.test(theme)
    || /\b(cancelled|canceled|refunded|refund)\b/i.test(blob)
    || /\bdid\s*not\s*run\b/i.test(blob);
}

/** @deprecated use isExcludedWorkshopRow */
function isNoteTheme(theme) {
  return isExcludedWorkshopRow({ theme_location: theme });
}

/** Strip admin suffixes (+ Tripod, etc.) so rows join the real product. */
function cleanTheme(theme) {
  return String(theme || '')
    .replace(/\s*\+\s*tripod\b.*$/i, '')
    .replace(/\s*-\s*combined package\s*$/i, '')
    .trim();
}

function isDualSessionDay(theme) {
  return /batsford|bluebell|blubebell/i.test(String(theme || ''));
}

/** Half-day session vs full/combined day (uses both AM and PM). */
function isFullDayDuration(durationText) {
  const t = String(durationText || '');
  if (/\b(6|7|8)\s*hrs?\b/i.test(t)) return true;
  if (/full\s*day|all\s*day|combined/i.test(t)) return true;
  return false;
}

/**
 * Fill = attendees ÷ capacity per session.
 * Capacity from website product listing (max 3/4/6), else type default.
 * Batsford/Bluebell: AM + PM sessions (each at product max); full-day counts in both.
 */
function fillByType(rows, start, end, type, capForTheme = null) {
  const map = new Map(); // key → { booked, cap }
  const dual = new Map(); // date|base → { full, half, cap }

  for (const r of rows || []) {
    const d = r.event_start || r.from_date || r.to_date;
    if (!d || d < start || d > end || !r.client_name) continue;
    const rawTheme = r.theme_location || r.event_name || '';
    if (type === 'day' && isExcludedWorkshopRow(r)) continue;
    const theme = type === 'day' ? cleanTheme(rawTheme) : rawTheme;
    const isRes = !!r.is_multi_day;
    const isWalk = /walk/i.test(theme);
    const isCourse = !!r.from_date || !!r.event_name;
    if (type === 'residential' && !isRes) continue;
    if (type === 'day' && (isRes || isWalk)) continue;
    if (type === 'walk' && !isWalk) continue;
    if (type === 'course' && !isCourse) continue;

    const matched = capForTheme ? capForTheme(theme) : null;
    const cap = matched?.max != null
      ? matched.max
      : (type === 'course' || type === 'residential') ? 4 : (/secret/i.test(theme) ? 3 : /garden|macro|fairy/i.test(theme) ? 4 : 6);
    const productKey = matched?.key || String(theme).slice(0, 40);

    if (type === 'day' && isDualSessionDay(theme)) {
      const base = /batsford/i.test(theme) ? 'Batsford' : 'Bluebell';
      const key = `${d}|${base}`;
      const slot = dual.get(key) || { full: 0, half: 0, cap };
      if (isFullDayDuration(r.duration_text)) slot.full += 1;
      else slot.half += 1;
      dual.set(key, slot);
      continue;
    }

    const key = `${d}|${productKey}`;
    const slot = map.get(key) || { booked: 0, cap };
    slot.booked += 1;
    map.set(key, slot);
  }

  for (const [key, slot] of dual) {
    let am = slot.full;
    let pm = slot.full;
    let half = slot.half;
    while (half > 0) {
      if (am < slot.cap) am += 1;
      else pm += 1;
      half -= 1;
    }
    if (am > 0) map.set(`${key}|AM`, { booked: am, cap: slot.cap });
    if (pm > 0) map.set(`${key}|PM`, { booked: pm, cap: slot.cap });
  }

  const vals = [...map.values()];
  if (!vals.length) return null;
  const booked = vals.reduce((a, s) => a + s.booked, 0);
  const seats = vals.reduce((a, s) => a + s.cap, 0);
  return { pct: fillPct(booked, seats), booked, seats };
}

/** Day / res / course fill + average; pct line + booked/seats counts. */
function buildFillTriplet(workshops, courses, start, end, capForTheme) {
  const d = fillByType(workshops, start, end, 'day', capForTheme);
  const r = fillByType(workshops, start, end, 'residential', capForTheme);
  const c = fillByType(courses, start, end, 'course', capForTheme);
  const parts = [d, r, c];
  const nums = parts.filter((x) => x?.pct != null).map((x) => x.pct);
  const avgPct = nums.length
    ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10
    : null;
  const avgBooked = parts.reduce((a, x) => a + (x?.booked || 0), 0);
  const avgSeats = parts.reduce((a, x) => a + (x?.seats || 0), 0);
  const avg = avgPct != null ? { pct: avgPct, booked: avgBooked, seats: avgSeats } : null;
  const all = [...parts, avg];
  return {
    pctLine: all.map((x) => (x?.pct == null ? '—' : `${x.pct}%`)).join(' / '),
    // Pipe separator — fractions use "/" so must not split on slash
    countLine: all.map((x) => (x ? `${x.booked}/${x.seats}` : '—')).join(' | '),
    parts: all
  };
}

function courseDate(r) {
  return r.from_date || r.to_date || null;
}

function countSheetThemeBooked(rows, eventDate, title) {
  let n = 0;
  for (const r of rows || []) {
    if (!r.client_name) continue;
    const theme = r.theme_location || r.event_name || '';
    if (!themeMatchesTitle(theme, title)) continue;
    if (!r.event_start && !courseDate(r)) {
      n += 1;
      continue;
    }
    const d = r.event_start || courseDate(r);
    if (d === eventDate) n += 1;
    else {
      const dd = Math.abs((new Date(`${d}T12:00:00Z`) - new Date(`${eventDate}T12:00:00Z`)) / 86400000);
      if (dd <= 3) n += 1;
    }
  }
  return n;
}

/** Beginners seats by source bucket for course dates in [startIso, endIso]. */
function sourceBuckets(bookings, startIso, endIso) {
  const buckets = { Google: 0, Gift: 0, 'Existing & referral': 0, JLR: 0, Other: 0 };
  for (const r of bookings) {
    const raw = courseDate(r);
    if (!raw || raw < startIso || raw > endIso) continue;
    const b = r.source_bucket || 'Other';
    buckets[b] = (buckets[b] || 0) + 1;
  }
  return buckets;
}

function beginnersStats(courses, now, feedBeginners, qStartIso = null) {
  const bookings = courses.filter((r) => r.is_booking_row && r.is_beginners);
  const week1 = (feedBeginners || []).filter((e) => e.is_week1);
  const start = addDays(now, -365);
  const startIso = isoDate(start);
  const today = isoDate(now);
  const buckets = sourceBuckets(bookings, startIso, today);
  const bucketsQtd = qStartIso ? sourceBuckets(bookings, qStartIso, today) : null;
  const week1R12 = week1.filter((e) => e.date >= startIso && e.date <= today);
  let booked = 0;
  for (const r of bookings) {
    const raw = courseDate(r);
    if (!raw || raw < startIso || raw > today) continue;
    booked += 1;
  }
  let seats;
  if (week1R12.length) {
    // Website calendar includes zero-booked courses
    seats = week1R12.length * BEG_CAP;
  } else {
    // Fallback: sheet course dates only (under-counts zeros)
    const byCourse = new Map();
    for (const r of bookings) {
      const raw = courseDate(r);
      if (!raw || raw < startIso || raw > today) continue;
      const key = `${raw}|${r.event_name || ''}`;
      byCourse.set(key, (byCourse.get(key) || 0) + 1);
    }
    seats = byCourse.size * BEG_CAP;
  }

  const next8 = isoDate(addDays(now, 56));
  const week1Next = week1.filter((e) => e.date >= today && e.date <= next8);
  let nextBooked = 0;
  for (const r of bookings) {
    const raw = courseDate(r);
    if (!raw || raw < today || raw > next8) continue;
    nextBooked += 1;
  }
  let nextSeats;
  if (week1Next.length) {
    nextSeats = week1Next.length * BEG_CAP;
  } else {
    const future = new Map();
    for (const r of bookings) {
      const raw = courseDate(r);
      if (!raw || raw < today || raw > next8) continue;
      future.set(`${raw}|${r.event_name || ''}`, (future.get(`${raw}|${r.event_name || ''}`) || 0) + 1);
    }
    nextSeats = future.size * BEG_CAP;
  }

  // Roadmap "now": non-JLR beginners from FY start 2026-10-01
  const fyStart = '2026-10-01';
  const nonJlrYtd = bookings.filter((r) => {
    if (r.source_bucket === 'JLR') return false;
    const raw = courseDate(r);
    return raw && raw >= fyStart && raw <= today;
  }).length;

  return {
    buckets,
    buckets_qtd: bucketsQtd,
    fill_r12_pct: seats ? fillPct(booked, seats) : null,
    booked_r12: booked,
    seats_r12: seats,
    next_8w_booked: nextBooked,
    next_8w_seats: nextSeats,
    non_jlr_ytd: nonJlrYtd
  };
}

function upcomingEvents(workshops, courses, now, feeds) {
  const end = addDays(now, 90);
  const today = isoDate(now);
  const endIso = isoDate(end);
  const out = [];

  for (const e of feeds?.workshops || []) {
    if (e.date < today || e.date > endIso) continue;
    const span = e.end && e.date
      ? Math.round((new Date(`${e.end}T12:00:00Z`) - new Date(`${e.date}T12:00:00Z`)) / 86400000) + 1
      : 1;
    const type = span >= 2 || /residential|night/i.test(e.title) ? 'residential' : 'day';
    const booked = countSheetThemeBooked(workshops, e.date, e.title);
    const leftFeed = e.places_left;
    const capacity = leftFeed != null
      ? Math.max(booked + leftFeed, type === 'residential' ? RES_CAP : DAY_CAP)
      : (type === 'residential' ? RES_CAP : DAY_CAP);
    const places_left = leftFeed != null ? leftFeed : Math.max(0, capacity - booked);
    out.push({ date: e.date, name: e.title, type, booked, capacity, places_left });
  }

  for (const e of feeds?.beginners || []) {
    if (!e.is_week1) continue;
    if (e.date < today || e.date > endIso) continue;
    const booked = courses.filter((r) => {
      if (!r.is_booking_row || !r.is_beginners || !r.client_name) return false;
      const raw = courseDate(r);
      return raw === e.date;
    }).length;
    const capacity = BEG_CAP;
    const places_left = e.places_left != null ? e.places_left : Math.max(0, capacity - booked);
    out.push({
      date: e.date,
      name: e.title,
      type: 'beginners',
      booked,
      capacity,
      places_left
    });
  }

  return out
    .map((e) => {
      const d = new Date(`${e.date}T12:00:00Z`);
      const days = Math.round((d - now) / 86400000);
      let status = 'OK';
      if (e.booked >= e.capacity || e.places_left === 0) status = 'Full';
      else if (e.type === 'residential' && e.booked <= 2 && days <= 60) status = 'At risk';
      else if (e.type !== 'residential' && e.booked <= 2 && days <= 21) status = 'At risk';
      return { ...e, status };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function plansEmptyCopy(plansConnected) {
  return plansConnected
    ? 'Plans tab connected · 0 plans yet'
    : 'Awaiting Plans tab upload';
}

function planClients(plans, txns, plansConnected) {
  if (!plans.length) {
    return { rows: [], empty_reason: plansEmptyCopy(plansConnected), plans_connected: !!plansConnected };
  }
  const outRows = [];
  for (const p of plans) {
    const email = String(p.email || '').toLowerCase().trim();
    const name = normName(p.client_name);
    let credit = 0;
    let matched = false;
    for (const t of txns) {
      if (Number(t.category_order) !== 5) continue;
      if (String(t.category_label || '').indexOf('Pick n Mix Out') < 0 && Number(t.category_order) !== 5) continue;
      const td = t.txn_date;
      if (p.start_date && td < p.start_date) continue;
      if (p.end_date && td > p.end_date) continue;
      // Match: no email on txns — use normalised client_name
      const tn = normName(t.client_name);
      const emailMatch = email && tn.includes(email.split('@')[0]);
      const nameMatch = name && tn && (tn === name || tn.includes(name.split(' ').pop()) || name.includes(tn.split(' ').pop()));
      if (!emailMatch && !nameMatch) continue;
      matched = true;
      credit += Math.abs(Number(t.amount) || 0);
    }
    const start = p.start_date ? new Date(`${p.start_date}T12:00:00Z`) : null;
    const end = p.end_date ? new Date(`${p.end_date}T12:00:00Z`) : null;
    const now = new Date();
    let pacePct = null;
    if (start && end && p.plan_value) {
      const totalMs = end - start;
      const elapsedMs = Math.min(Math.max(now - start, 0), totalMs);
      const expected = totalMs > 0 ? (elapsedMs / totalMs) * Number(p.plan_value) : 0;
      pacePct = expected > 0 ? Math.round(((credit - expected) / expected) * 1000) / 10 : null;
    }
    const reviews = [
      [p.review_1_due, p.review_1_held],
      [p.review_2_due, p.review_2_held],
      [p.review_3_due, p.review_3_held],
      [p.review_4_due, p.review_4_held]
    ];
    const held = reviews.filter(([, h]) => h).length;
    const nextDue = reviews.find(([d, h]) => d && !h)?.[0] || null;
    const flags = [];
    if (!matched && credit === 0) flags.push('unmatched_name');
    if (pacePct != null && pacePct < -20) flags.push('behind_pace');
    if (nextDue && nextDue <= isoDate(addDays(now, 14))) flags.push('review_due');
    outRows.push({
      client: p.client_name,
      email: p.email,
      plan_type: p.plan_type,
      plan_value: p.plan_value != null ? Number(p.plan_value) : null,
      start_date: p.start_date,
      credit_used: Math.round(credit * 100) / 100,
      pace_pct: pacePct,
      next_review_due: nextDue,
      reviews_held: held,
      status: p.status,
      flags
    });
  }
  return { rows: outRows, empty_reason: null };
}

function beginnersConversion(courses, plans, plansConnected) {
  const today = isoDate(new Date());
  const bookings = courses.filter((r) => r.is_booking_row && r.is_beginners);
  const byCourse = new Map();
  for (const r of bookings) {
    const raw = r.from_date || r.to_date;
    if (!raw) continue;
    const key = `${raw}|${r.event_name || ''}`;
    if (!byCourse.has(key)) {
      byCourse.set(key, { dates: raw, event: r.event_name, attendees: [], end: r.to_date || raw });
    }
    byCourse.get(key).attendees.push(r);
  }
  // Last 6 completed courses only (end date before today)
  const completed = [...byCourse.values()]
    .filter((c) => c.end && c.end < today)
    .sort((a, b) => String(b.end).localeCompare(String(a.end)))
    .slice(0, 6);
  if (!plans.length) {
    return {
      rows: completed.map((c) => ({
        dates: c.dates,
        event: c.event,
        attendees: c.attendees.length,
        jlr: c.attendees.filter((a) => a.source_bucket === 'JLR').length,
        plans_60d: null,
        conversion_pct: null
      })),
      empty_note: plansConnected
        ? 'Plans tab connected · 0 plans yet (attendee counts shown from Courses-Classes).'
        : 'Plan conversion % awaiting Plans tab upload (attendee counts shown from Courses-Classes).'
    };
  }
  const rows = completed.map((c) => {
    const end = new Date(`${c.end}T12:00:00Z`);
    const windowEnd = addDays(end, 60);
    let plans60 = 0;
    for (const a of c.attendees) {
      if (a.source_bucket === 'JLR') continue;
      const an = normName(a.client_name);
      const ae = String(a.email || '').toLowerCase();
      const hit = plans.some((p) => {
        if (!p.start_date) return false;
        const ps = new Date(`${p.start_date}T12:00:00Z`);
        if (ps < end || ps > windowEnd) return false;
        const pe = String(p.email || '').toLowerCase();
        if (ae && pe && ae === pe) return true;
        return an && normName(p.client_name) === an;
      });
      if (hit) plans60 += 1;
    }
    const nonJlr = c.attendees.filter((a) => a.source_bucket !== 'JLR').length;
    return {
      dates: c.dates,
      event: c.event,
      attendees: c.attendees.length,
      jlr: c.attendees.filter((a) => a.source_bucket === 'JLR').length,
      plans_60d: plans60,
      conversion_pct: nonJlr ? Math.round((plans60 / nonJlr) * 1000) / 10 : null
    };
  });
  return { rows, empty_note: null };
}

function workshopSignals(workshops, now) {
  const today = isoDate(now);
  const l12 = isoDate(addDays(now, -365));
  const byEvent = new Map();
  for (const r of workshops) {
    if (!r.is_multi_day || !r.event_start) continue;
    const key = `${r.event_start}|${r.theme_location || ''}`;
    if (!byEvent.has(key)) byEvent.set(key, { start: r.event_start, name: r.theme_location, booked: 0 });
    if (r.client_name) byEvent.get(key).booked += 1;
  }
  const past = [...byEvent.values()].filter((e) => e.start >= l12 && e.start < today);
  const avg = past.length ? past.reduce((a, e) => a + e.booked, 0) / past.length : null;
  const end60 = addDays(now, 60);
  const atRisk = [...byEvent.values()].filter((e) => {
    const d = new Date(`${e.start}T12:00:00Z`);
    return d >= now && d <= end60 && e.booked <= 2;
  }).length;
  return {
    residential_avg: avg != null ? Math.round(avg * 10) / 10 : null,
    residential_avg_window: 'last 12 months',
    residentials_at_risk_60d: atRisk
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function buildStrategySummary(supabase, propertyUrl = PROP, opts = {}) {
  await ensureStrategyActions(supabase, propertyUrl);
  const now = new Date();
  const today = isoDate(now);
  const weekStart = isoDate(mondayOf(now));

  const [cats, gpRates, txns, courses, workshops, plans, actions, targets, plansPresence] = await Promise.all([
    pageAll(supabase, 'booking_sheet_monthly_category', 'year, month, category_order, category_label, revenue_amount', 'property_url', propertyUrl),
    pageAll(supabase, 'booking_sheet_category_gp', 'year, category_order, category_label, gp_rate', 'property_url', propertyUrl),
    pageAll(supabase, 'booking_sheet_transactions', 'txn_date, category_order, category_label, funding, amount, client_name, client_type, is_jlr', 'property_url', propertyUrl),
    pageAll(supabase, 'booking_sheet_course_attendees', '*', 'property_url', propertyUrl),
    pageAll(supabase, 'booking_sheet_workshop_attendees', '*', 'property_url', propertyUrl),
    pageAll(supabase, 'booking_sheet_plans', '*', 'property_url', propertyUrl),
    supabase.from('strategy_quarter_actions').select('*').eq('property_url', propertyUrl).order('quarter_key').order('sort_order')
      .then((r) => { if (r.error) throw r.error; return r.data || []; }),
    loadBusinessTargets(supabase, propertyUrl),
    supabase.from('booking_sheet_sheet_presence').select('present, row_count, sheet_name')
      .eq('property_url', propertyUrl).eq('sheet_key', 'plans').maybeSingle()
      .then((r) => r.data || null)
  ]);

  const plansConnected = !!(plansPresence && plansPresence.present);
  const plansNeedCopy = plansEmptyCopy(plansConnected);
  let feeds = { workshops: [], beginners: [] };
  let productVariants = [];
  try {
    [feeds, productVariants] = await Promise.all([
      loadSquarespaceEventFeeds(),
      loadProductVariants()
    ]);
  } catch (_e) {
    feeds = { workshops: [], beginners: [] };
    try { productVariants = await loadProductVariants(); } catch (_e2) { productVariants = []; }
  }
  const capForTheme = makeProductCapLookup(productVariants);

  let snapsRes = await supabase.from('strategy_event_snapshots')
    .select('snapshot_date, event_key, sheet_booked, places_left, event_date')
    .eq('property_url', propertyUrl)
    .gte('snapshot_date', isoDate(addDays(now, -21)))
    .limit(5000);
  let snapshots = snapsRes.data || [];
  let snapshotBackfill = null;
  const londonToday = londonYmd(now);
  const snapDates = [...new Set(snapshots.map((s) => s.snapshot_date))].sort();
  if (!opts.noBackfill && londonHour(now) >= 7 && !snapDates.includes(londonToday)) {
    try {
      snapshotBackfill = await runStrategyEventSnapshots(supabase, propertyUrl);
      snapsRes = await supabase.from('strategy_event_snapshots')
        .select('snapshot_date, event_key, sheet_booked, places_left, event_date')
        .eq('property_url', propertyUrl)
        .gte('snapshot_date', isoDate(addDays(now, -21)))
        .limit(5000);
      snapshots = snapsRes.data || [];
    } catch (e) {
      snapshotBackfill = { error: e?.message || String(e) };
    }
  }

  const { diary } = await buildStrategyDiary({ workshops, courses, actions, snapshots });
  const costModel = await loadWorkshopCostModel(supabase, propertyUrl);
  const schedRes = await supabase.from('csv_metadata')
    .select('title, start_date, end_date, start_time, end_time, location_name')
    .eq('csv_type', 'workshop_events')
    .gte('start_date', isoDate(addDays(now, -14)))
    .lte('start_date', isoDate(addDays(now, 120)))
    .limit(500);
  const eventSchedule = schedRes.data || [];
  const gpApply = applyDiaryGp(diary, costModel, gpRates, eventSchedule);
  const diaryGp = {
    ...gpTotals(diary),
    model_loaded: !!costModel,
    unmatched: gpApply.unmatched || [],
    short_events: gpApply.short_events || []
  };
  const push = buildPushList(diary);

  const gpByCat = gpByMonthByCategory(cats, gpRates);
  const gpSeries = gpByMonthTotals(gpByCat);
  const gpT3 = trailingAvg(gpSeries, 3);
  const priorAsOf = isoDate(addDays(now, -365)).slice(0, 7);
  const gpT3Prior = trailingAvg(gpSeries, 3, priorAsOf);
  const l12Start = isoDate(addDays(now, -365)).slice(0, 7);
  const l12End = isoDate(addDays(now, -1)).slice(0, 7);
  const p12Start = isoDate(addDays(now, -730)).slice(0, 7);
  const p12End = isoDate(addDays(now, -366)).slice(0, 7);
  const gpL12 = avgInWindow(gpSeries, l12Start, l12End);
  const gpPriorL12 = avgInWindow(gpSeries, p12Start, p12End);

  const survival = Number(targets?.survival_gp_monthly || 3700);
  const qStart = '2026-10-01';
  const beg = beginnersStats(courses, now, feeds.beginners, qStart);
  const begPrior = beginnersStats(courses, addDays(now, -365), feeds.beginners);
  const returning = returningRevenue(txns, now);
  const returningPrior = returningRevenue(txns, addDays(now, -365));
  const plansActive = plans.filter((p) => String(p.status || '').toLowerCase() === 'active' || !p.status).length;
  const planCredit = planClients(plans, txns, plansConnected);
  const conversion = beginnersConversion(courses, plans, plansConnected);
  const ws = workshopSignals(workshops, now);
  // Keep pre-v4 11-KPI rows available for mockup / dual view (live tab uses kpi_scorecard)
  let creditPace = null;
  let reviewsHeldDue = null;
  let discountPct = null;
  let planConversionPct = null;
  if (planCredit.rows.length) {
    const paces = planCredit.rows.map((r) => r.pace_pct).filter((x) => x != null);
    creditPace = paces.length ? Math.round((paces.reduce((a, b) => a + b, 0) / paces.length) * 10) / 10 : null;
    const held = planCredit.rows.reduce((a, r) => a + (r.reviews_held || 0), 0);
    reviewsHeldDue = { held, due: planCredit.rows.length * 4 };
    const disc = plans.map((p) => Number(p.discount_pct)).filter((n) => Number.isFinite(n));
    discountPct = disc.length ? Math.round((disc.reduce((a, b) => a + b, 0) / disc.length) * 10) / 10 : null;
  }
  if (conversion.rows.some((r) => r.conversion_pct != null)) {
    const vals = conversion.rows.map((r) => r.conversion_pct).filter((x) => x != null);
    planConversionPct = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  }
  const needsPlansReason = plansNeedCopy;
  const l12Iso = isoDate(addDays(now, -365));
  const p12Iso = isoDate(addDays(now, -730));
  const p12EndIso = isoDate(addDays(now, -366));
  const dayPred = (r) => !r.is_multi_day && !/walk/i.test(r.theme_location || '') && !isExcludedWorkshopRow(r);
  const resPred = (r) => !!r.is_multi_day;
  const walkPred = (r) => !r.is_multi_day && /walk/i.test(r.theme_location || '');

  const f1 = {
    qtd: avgBookedPerRun(workshops, qStart, today, dayPred),
    l12: avgBookedPerRun(workshops, l12Iso, today, dayPred),
    prior: avgBookedPerRun(workshops, p12Iso, p12EndIso, dayPred)
  };
  const f2 = {
    qtd: avgBookedPerRun(workshops, qStart, today, resPred),
    l12: avgBookedPerRun(workshops, l12Iso, today, resPred) ?? ws.residential_avg,
    prior: avgBookedPerRun(workshops, p12Iso, p12EndIso, resPred)
  };
  // Keep panel B + KPI 10 + scorecard F2 on the same L12 figure
  ws.residential_avg = f2.l12;
  const f3 = {
    qtd: avgBookedPerRun(courses, qStart, today, null),
    l12: avgBookedPerRun(courses, l12Iso, today, null),
    prior: avgBookedPerRun(courses, p12Iso, p12EndIso, null)
  };
  const kpis = [
    { id: 1, label: 'Gross profit / month (T3)', actual: gpT3, target: survival, unit: 'gbp', status: gpT3 == null ? 'n/a' : (gpT3 >= survival ? 'ok' : 'below') },
    { id: 2, label: 'Beginners seats filled', actual: beg.fill_r12_pct, target: 60, unit: 'pct', status: beg.fill_r12_pct == null ? 'n/a' : (beg.fill_r12_pct >= 60 ? 'ok' : 'watch') },
    { id: 3, label: 'Beginners by source (non-JLR)', actual: 'see panel', target: 'growing', unit: 'text', status: 'ok' },
    { id: 4, label: 'Plan conversion ≤60d', actual: planConversionPct, target: 20, unit: 'pct', status: planConversionPct == null ? 'needs_plans' : (planConversionPct >= 20 ? 'ok' : 'watch'), reason: planConversionPct == null ? needsPlansReason : null },
    { id: 5, label: 'Plans (active / committed £)', actual: plans.length ? plansActive : null, target: 12, unit: 'count', status: plans.length ? 'ok' : 'needs_plans', reason: plans.length ? null : needsPlansReason },
    { id: 6, label: 'Plan credit used vs pace', actual: creditPace, target: 20, unit: 'pct_band', status: creditPace == null ? 'needs_plans' : (Math.abs(creditPace) <= 20 ? 'ok' : 'watch'), reason: creditPace == null ? needsPlansReason : null },
    { id: 7, label: 'Plan reviews held vs due', actual: reviewsHeldDue ? `${reviewsHeldDue.held}/${reviewsHeldDue.due}` : null, target: '100%', unit: 'text', status: reviewsHeldDue == null ? 'needs_plans' : 'watch', reason: reviewsHeldDue == null ? needsPlansReason : null },
    { id: 8, label: 'Plan discount cost', actual: discountPct, target: 15, unit: 'pct_max', status: discountPct == null ? 'needs_plans' : (discountPct < 15 ? 'ok' : 'watch'), reason: discountPct == null ? needsPlansReason : null },
    { id: 9, label: 'Returning-client revenue R12', actual: returning, target: 'Q1 £16k · year-end £23k', unit: 'text', status: returning >= 23000 ? 'ok' : (returning >= 16000 ? 'watch' : 'below') },
    { id: 10, label: 'Workshop fill (residential avg, last 12 months)', actual: f2.l12, target: 3, unit: 'avg', status: f2.l12 == null ? 'n/a' : (f2.l12 >= 3 ? 'ok' : 'watch') },
    { id: 11, label: 'Plan renewals (from m10)', actual: null, target: 50, unit: 'pct', status: 'n/a', reason: plans.length ? 'No renewals window yet' : needsPlansReason }
  ];
  // Fill window: last 12 months + next 6 months (includes future dates with ≥1 booking)
  const fillEndIso = isoDate(addDays(now, 180));
  const fillQtd = buildFillTriplet(workshops, courses, qStart, fillEndIso, capForTheme);
  const fillL12 = buildFillTriplet(workshops, courses, l12Iso, fillEndIso, capForTheme);
  const fillPrior = buildFillTriplet(workshops, courses, p12Iso, p12EndIso, capForTheme);

  const courseDates = (courses || []).map((r) => r.from_date || r.to_date).filter(Boolean).sort();
  const coursePriorNote = courseDates.length
    ? `prior: Feb 2025 partial (${courseDates[0].slice(0, 7)}…)`
    : 'prior: n/a';

  const kpiScorecard = [
    { key: 'F1', name: 'Avg booked / run — day', qtd: f1.qtd, l12: f1.l12, prior: f1.prior, change: changePct(f1.l12, f1.prior), target: '—', status: (f1.l12 ?? 0) >= 2 ? 'ok' : 'watch', def: 'Booked ÷ day-workshop runs' },
    { key: 'F2', name: 'Avg booked / run — residential', qtd: f2.qtd, l12: f2.l12, prior: f2.prior, change: changePct(f2.l12, f2.prior), target: '≥3', status: (f2.l12 ?? 0) >= 3 ? 'ok' : 'watch', def: 'Multi-day · KPI 10' },
    { key: 'F3', name: 'Avg booked / run — beginners', qtd: f3.qtd, l12: f3.l12, prior: f3.prior, change: changePct(f3.l12, f3.prior), target: '—', status: 'watch', def: 'Courses-Classes', note: coursePriorNote },
    { key: 'F4', name: 'Fill % day / res / course / avg', qtd: fillQtd.pctLine, l12: fillL12.pctLine, prior: fillPrior.pctLine, qtd_counts: fillQtd.countLine, l12_counts: fillL12.countLine, prior_counts: fillPrior.countLine, change: null, target: '—', status: 'watch', def: 'Attendees ÷ product max (3/4/6 from listing) per session; L12+6m; 4th = avg of three', note: 'dual-session = AM+PM each at product max; future dates with ≥1 booking included' },
    { key: 'F5', name: 'Run rate %', qtd: 'building', l12: 'building', prior: '—', change: null, target: '—', status: 'watch', def: 'Ran ÷ scheduled', note: 'building since 7 Oct 2026' },
    { key: 'F6', name: 'Revenue / run (day · res L12)', qtd: '—', l12: `${gbpOrDash(revPerRun(workshops, l12Iso, today, dayPred))} · ${gbpOrDash(revPerRun(workshops, l12Iso, today, resPred))}`, prior: `${gbpOrDash(revPerRun(workshops, p12Iso, p12EndIso, dayPred))} · ${gbpOrDash(revPerRun(workshops, p12Iso, p12EndIso, resPred))}`, change: null, target: '—', status: 'ok', def: '£ paid ÷ runs' },
    { key: 'F7', name: 'Forward 12w places sold vs LY', qtd: 'n/a', l12: 'n/a', prior: 'n/a', change: null, target: '—', status: 'watch', def: 'Needs booking-date cohort', note: 'not available yet' },
    { key: '1', name: 'GP / month (T3)', qtd: gpT3, l12: gpL12, prior: gpT3Prior ?? gpPriorL12, change: changePct(gpT3, gpT3Prior ?? gpPriorL12), target: survival, status: gpT3 >= survival ? 'ok' : 'below', unit: 'gbp', def: 'T3 vs survival; prior = T3 same point LY', note: `L12 avg ${gbpOrDash(gpL12)} vs prior L12 ${gbpOrDash(gpPriorL12)}` },
    { key: '2', name: 'Beginners seats filled %', qtd: beg.fill_r12_pct, l12: beg.fill_r12_pct, prior: begPrior.fill_r12_pct, change: changePct(beg.fill_r12_pct, begPrior.fill_r12_pct), target: 60, unit: 'pct', status: (beg.fill_r12_pct ?? 0) >= 60 ? 'ok' : 'below', def: 'Fill incl. zeros where known', note: coursePriorNote },
    { key: '3', name: 'Non-JLR beginners by source', qtd: srcLine(beg.buckets_qtd || {}, false), l12: srcLine(beg.buckets, false), prior: srcLine(begPrior.buckets, false), change: null, target: 'growing', unit: 'text', status: 'ok', def: 'Google / Gift / Existing; JLR separate', note: `QTD from ${qStart} · JLR QTD ${beg.buckets_qtd?.JLR || 0} / L12 ${beg.buckets.JLR || 0}` },
    { key: '9', name: 'Returning-client revenue L12', qtd: returning, l12: returning, prior: returningPrior, change: changePct(returning, returningPrior), target: 'Q1 £16k · year-end £23k', unit: 'gbp', status: returning >= 23000 ? 'ok' : (returning >= 16000 ? 'watch' : 'below'), def: 'Excl JLR & ≥£3k' },
    { key: '10', name: 'Residential avg (= F2, last 12 months)', qtd: f2.qtd, l12: f2.l12, prior: f2.prior, change: changePct(f2.l12, f2.prior), target: 3, status: (f2.l12 ?? 0) >= 3 ? 'ok' : 'watch', def: 'Same as F2' },
    { key: 'plans', name: '4–8 + 11 Plan KPIs', qtd: '—', l12: '—', prior: '—', change: null, target: '12 / 50%', status: 'needs_plans', def: 'Collapsed until first plan', note: plans.length ? null : plansNeedCopy }
  ];

  const overdueActions = actions.filter((a) => !a.is_ticked && a.due_week_start < weekStart);
  const currentQuarter = 'q1-2026';
  const mismatchTotal = diary.filter((e) => e.mismatch).length;
  const dateHealth = await supabase.from('booking_sheet_sheet_presence')
    .select('present, sheet_name, row_count')
    .eq('property_url', propertyUrl)
    .eq('sheet_key', 'attendee_date_health')
    .maybeSingle()
    .then((r) => r.data || null);

  const stale14 = staleSalesKeys(snapshots, diary);
  for (const e of diary) {
    if (stale14.has(e.eventKey)) e.stale14 = true;
  }
  const actionNeeded = buildActionNeeded(diary, actions, weekStart, {
    stale14,
    mismatchTotal,
    dateHealthFail: dateHealth && dateHealth.present === false ? dateHealth.sheet_name : null
  });

  const dayAtt = (start, end) => workshops.filter((r) => r.client_name && r.event_start >= start && r.event_start <= end && dayPred(r)).length;
  const resAtt = (start, end) => workshops.filter((r) => r.client_name && r.event_start >= start && r.event_start <= end && resPred(r)).length;

  return {
    ok: true,
    layout: 'v5',
    as_of: today,
    week_start: weekStart,
    survival_gp: survival,
    stretch: {
      stretch1: Number(targets?.stretch1_gp_monthly || 4000),
      stretch2: Number(targets?.stretch2_gp_monthly || 4700)
    },
    cost_rise_by_year: resolveCostRiseByYear(targets),
    gp_target_base_year: GP_TARGET_BASE_YEAR,
    quarters: STRATEGY_QUARTERS,
    current_quarter: currentQuarter,
    actions,
    overdue_actions: overdueActions,
    gp_series: gpSeries,
    gp_by_category: gpByCat,
    gp_category_labels: GP_CATEGORY_LABELS,
    gp_t3: gpT3,
    roadmap_now: {
      plans_sold: plans.length,
      beginners_non_jlr: beg.non_jlr_ytd,
      returning_r12: returning,
      gp_t3: gpT3
    },
    headline: {
      gp_t3: gpT3,
      beginners_fill_pct: beg.fill_r12_pct,
      beginners_next_8w: { booked: beg.next_8w_booked, seats: beg.next_8w_seats },
      plans_active: plans.length ? plansActive : null,
      plans_connected: plansConnected,
      plans_meta: plans.length ? `→ 12 by Sep 27` : plansNeedCopy,
      returning_r12: returning
    },
    diary,
    diary_gp: diaryGp,
    push,
    trends: {
      gp_t3: gpT3,
      gp_t3_prior: gpT3Prior,
      beginners_fill: beg.fill_r12_pct,
      beginners_fill_prior: begPrior.fill_r12_pct,
      day_attendees_l12: dayAtt(l12Iso, today),
      day_attendees_prior: dayAtt(p12Iso, p12EndIso),
      res_attendees_l12: resAtt(l12Iso, today),
      res_attendees_prior: resAtt(p12Iso, p12EndIso),
      day_avg_l12: f1.l12,
      day_avg_prior: f1.prior,
      res_avg_l12: f2.l12,
      res_avg_prior: f2.prior,
      notes: { empty_runs: 'empty runs tracked from 7 Oct 2026', courses_prior: coursePriorNote }
    },
    kpi_scorecard: kpiScorecard,
    kpis,
    roadmap: ROADMAP_MILESTONES,
    beginners_conversion: conversion,
    plan_clients: planCredit,
    plans_connected: plansConnected,
    workshop_signals: ws,
    beginners_sources: beg.buckets,
    beginners_sources_prior: begPrior.buckets,
    scorecard: {
      gp: { mtd: null, t3: gpT3, t3_prior: gpT3Prior, l12_avg: gpL12, prior_l12_avg: gpPriorL12, survival },
      plans: { sold_week: null, active: plans.length ? plansActive : null, target: 12 },
      beginners: { next_8w_booked: beg.next_8w_booked, next_8w_seats: beg.next_8w_seats, non_jlr_ytd: beg.non_jlr_ytd, fill_l12: beg.fill_r12_pct, fill_prior: begPrior.fill_r12_pct, dec_target: 8 },
      returning: { r12: returning, prior: returningPrior, target: 23000, dec_target: 16000 },
      f: { f1: f1.l12, f2: f2.l12, f3: f3.l12 }
    },
    action_needed: actionNeeded,
    snapshot_meta: buildSnapshotMeta(snapshots, stale14.size, snapshotBackfill, now)
  };
}

function addYmd(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function buildSnapshotMeta(snapshots, stale14, backfill, now = new Date()) {
  const dates = [...new Set((snapshots || []).map((s) => s.snapshot_date))].sort();
  const today = londonYmd(now);
  const missing = [];
  for (let i = 0; i < 7; i++) {
    const d = addYmd(today, -i);
    if (d >= SNAPSHOT_EPOCH && !dates.includes(d)) missing.push(d);
  }
  return {
    rows_loaded: snapshots.length,
    stale14,
    dates,
    earliest: dates[0] || null,
    today,
    today_missing: !dates.includes(today),
    missing_last_7: missing,
    warn_after_7uk: londonHour(now) >= 7 && !dates.includes(today),
    backfill
  };
}

function gbpOrDash(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return '£' + Math.round(Number(n)).toLocaleString('en-GB');
}

function srcLine(buckets, withJlr) {
  const g = buckets.Google || 0;
  const gift = buckets.Gift || 0;
  const ex = buckets['Existing & referral'] || 0;
  return withJlr ? `G ${g} / Gift ${gift} / Ex ${ex} / JLR ${buckets.JLR || 0}` : `G ${g} / Gift ${gift} / Ex ${ex}`;
}

function revPerRun(rows, start, end, predicate) {
  const map = new Map();
  for (const r of rows || []) {
    if (!r.client_name || !r.event_start || r.event_start < start || r.event_start > end) continue;
    if (predicate && !predicate(r)) continue;
    const key = `${r.event_start}|${String(r.theme_location || '').slice(0, 40)}`;
    map.set(key, (map.get(key) || 0) + Number(r.paid || 0));
  }
  const vals = [...map.values()];
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
