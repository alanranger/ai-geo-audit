/**
 * Strategy & KPIs summary for dashboard + Monday brief.
 * Complexity kept low: small helpers, no invented sample rows.
 */
import { loadBusinessTargets } from './business-targets.mjs';
import { ROADMAP_MILESTONES, STRATEGY_QUARTERS, ensureStrategyActions } from './strategy-action-seed.mjs';
import { loadSquarespaceEventFeeds, themeMatchesTitle } from './squarespace-events-feed.mjs';

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

function gpByMonth(cats, gpRates) {
  const rate = new Map();
  for (const g of gpRates) rate.set(`${g.year}|${g.category_order}`, Number(g.gp_rate) || 0);
  const by = new Map();
  for (const r of cats) {
    // D2C + B2B only (orders 1-3,6-7,10-12) — Pick n Mix Out never hits GP
    const order = Number(r.category_order);
    if ([4, 5, 8, 9].includes(order)) continue;
    const key = `${r.year}-${String(r.month).padStart(2, '0')}`;
    const gp = Number(r.revenue_amount || 0) * (rate.get(`${r.year}|${order}`) || 0);
    by.set(key, (by.get(key) || 0) + gp);
  }
  return [...by.entries()]
    .map(([period, gp]) => ({ period, gp: Math.round(gp * 100) / 100 }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

function trailingAvg(series, n = 3) {
  const closed = series.filter((s) => s.period < isoDate(new Date()).slice(0, 7));
  const last = closed.slice(-n);
  if (!last.length) return null;
  return Math.round((last.reduce((a, s) => a + s.gp, 0) / last.length) * 100) / 100;
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

function beginnersStats(courses, now, feedBeginners) {
  const bookings = courses.filter((r) => r.is_booking_row && r.is_beginners);
  const buckets = { Google: 0, Gift: 0, 'Existing & referral': 0, JLR: 0, Other: 0 };
  for (const r of bookings) {
    const b = r.source_bucket || 'Other';
    buckets[b] = (buckets[b] || 0) + 1;
  }

  const week1 = (feedBeginners || []).filter((e) => e.is_week1);
  const start = addDays(now, -365);
  const startIso = isoDate(start);
  const today = isoDate(now);
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
    fill_r12_pct: seats ? Math.round((booked / seats) * 1000) / 10 : null,
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
  if (!plans.length) {
    return {
      rows: [...byCourse.values()].map((c) => ({
        dates: c.dates,
        event: c.event,
        attendees: c.attendees.length,
        jlr: c.attendees.filter((a) => a.source_bucket === 'JLR').length,
        plans_60d: null,
        conversion_pct: null
      })).sort((a, b) => String(b.dates).localeCompare(String(a.dates))),
      empty_note: plansConnected
        ? 'Plans tab connected · 0 plans yet (attendee counts shown from Courses-Classes).'
        : 'Plan conversion % awaiting Plans tab upload (attendee counts shown from Courses-Classes).'
    };
  }
  const rows = [...byCourse.values()].map((c) => {
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
  return { rows: rows.sort((a, b) => String(b.dates).localeCompare(String(a.dates))), empty_note: null };
}

function workshopSignals(workshops, now) {
  const byEvent = new Map();
  for (const r of workshops) {
    if (!r.is_multi_day || !r.event_start) continue;
    const key = `${r.event_start}|${r.theme_location || ''}`;
    if (!byEvent.has(key)) byEvent.set(key, { start: r.event_start, name: r.theme_location, booked: 0 });
    if (r.client_name) byEvent.get(key).booked += 1;
  }
  const past = [...byEvent.values()].filter((e) => e.start < isoDate(now));
  const avg = past.length ? past.reduce((a, e) => a + e.booked, 0) / past.length : null;
  const end60 = addDays(now, 60);
  const atRisk = [...byEvent.values()].filter((e) => {
    const d = new Date(`${e.start}T12:00:00Z`);
    return d >= now && d <= end60 && e.booked <= 2;
  }).length;
  return {
    residential_avg: avg != null ? Math.round(avg * 10) / 10 : null,
    residentials_at_risk_60d: atRisk
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function buildStrategySummary(supabase, propertyUrl = PROP) {
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
  try {
    feeds = await loadSquarespaceEventFeeds();
  } catch (_e) {
    feeds = { workshops: [], beginners: [] };
  }
  const gpSeries = gpByMonth(cats, gpRates);
  const gpT3 = trailingAvg(gpSeries, 3);
  const survival = Number(targets?.survival_gp_monthly || 3700);
  const beg = beginnersStats(courses, now, feeds.beginners);
  const returning = returningRevenue(txns, now);
  const plansActive = plans.filter((p) => String(p.status || '').toLowerCase() === 'active' || !p.status).length;
  const planCredit = planClients(plans, txns, plansConnected);
  const conversion = beginnersConversion(courses, plans, plansConnected);
  const ws = workshopSignals(workshops, now);
  const upcoming = upcomingEvents(workshops, courses, now, feeds);

  // Plan KPI aggregates when plans exist
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
  const kpis = [
    { id: 1, label: 'Gross profit / month (T3)', actual: gpT3, target: survival, unit: 'gbp', status: gpT3 == null ? 'n/a' : (gpT3 >= survival ? 'ok' : 'below') },
    { id: 2, label: 'Beginners seats filled', actual: beg.fill_r12_pct, target: 60, unit: 'pct', status: beg.fill_r12_pct == null ? 'n/a' : (beg.fill_r12_pct >= 60 ? 'ok' : 'watch') },
    { id: 3, label: 'Beginners by source (non-JLR)', actual: 'see panel', target: 'growing', unit: 'text', status: 'ok' },
    { id: 4, label: 'Plan conversion ≤60d', actual: planConversionPct, target: 20, unit: 'pct', status: planConversionPct == null ? 'needs_plans' : (planConversionPct >= 20 ? 'ok' : 'watch'), reason: planConversionPct == null ? needsPlansReason : null },
    { id: 5, label: 'Plans (active / committed £)', actual: plans.length ? plansActive : null, target: 12, unit: 'count', status: plans.length ? 'ok' : 'needs_plans', reason: plans.length ? null : needsPlansReason, meta: { active: plansActive, committed: plans.reduce((a, p) => a + (Number(p.plan_value) || 0), 0) } },
    { id: 6, label: 'Plan credit used vs pace', actual: creditPace, target: 20, unit: 'pct_band', status: creditPace == null ? 'needs_plans' : (Math.abs(creditPace) <= 20 ? 'ok' : 'watch'), reason: creditPace == null ? needsPlansReason : null },
    { id: 7, label: 'Plan reviews held vs due', actual: reviewsHeldDue ? `${reviewsHeldDue.held}/${reviewsHeldDue.due}` : null, target: '100%', unit: 'text', status: reviewsHeldDue == null ? 'needs_plans' : (reviewsHeldDue.held >= reviewsHeldDue.due ? 'ok' : 'watch'), reason: reviewsHeldDue == null ? needsPlansReason : null },
    { id: 8, label: 'Plan discount cost', actual: discountPct, target: 15, unit: 'pct_max', status: discountPct == null ? 'needs_plans' : (discountPct < 15 ? 'ok' : 'watch'), reason: discountPct == null ? needsPlansReason : null },
    { id: 9, label: 'Returning-client revenue R12', actual: returning, target: 23000, unit: 'gbp', status: returning >= 23000 ? 'ok' : 'watch' },
    { id: 10, label: 'Workshop fill (residential avg)', actual: ws.residential_avg, target: 3, unit: 'avg', status: ws.residential_avg == null ? 'n/a' : (ws.residential_avg >= 3 ? 'ok' : 'watch'), reason: ws.residential_avg == null ? 'No residential workshop history' : null },
    { id: 11, label: 'Plan renewals (from m10)', actual: null, target: 50, unit: 'pct', status: 'n/a', reason: plans.length ? 'No renewals window yet / needs Plans Status=Renewed' : needsPlansReason }
  ];

  const overdueActions = actions.filter((a) => !a.is_ticked && a.due_week_start < weekStart);
  const currentQuarter = 'q1-2026';

  const actionNeeded = [];
  for (const a of overdueActions) {
    actionNeeded.push({
      key: `action-${a.action_key}`,
      title: a.label,
      detail: `Due week ${a.due_week_start} — not ticked`,
      why: 'Overdue quarter action'
    });
  }
  for (const e of upcoming) {
    const d = new Date(`${e.date}T12:00:00Z`);
    const days = Math.round((d - now) / 86400000);
    if (e.type === 'beginners' && e.booked < 3 && days <= 14) {
      actionNeeded.push({
        key: `beg-${e.date}-${e.name}`,
        title: `Beginners course — ${e.date}`,
        detail: `${e.booked} booked (need 3+)`,
        why: 'Starts within 14 days — fill or consolidate'
      });
    }
    if (e.type === 'residential' && e.booked <= 2 && days <= 60) {
      actionNeeded.push({
        key: `res-${e.date}-${e.name}`,
        title: `Residential — ${e.name}`,
        detail: `${e.booked} booked · ${e.date}`,
        why: '≤2 within 60 days — offer to plan clients first'
      });
    }
  }
  for (const r of planCredit.rows || []) {
    if ((r.flags || []).includes('review_due') && r.next_review_due) {
      actionNeeded.push({
        key: `rev-${r.client}-${r.next_review_due}`,
        title: `Plan review due — ${r.client}`,
        detail: `Review due ${r.next_review_due}, not held`,
        why: 'Due within 14 days'
      });
    }
  }

  const dateHealth = await supabase.from('booking_sheet_sheet_presence')
    .select('present, sheet_name, row_count')
    .eq('property_url', propertyUrl)
    .eq('sheet_key', 'attendee_date_health')
    .maybeSingle()
    .then((r) => r.data || null);
  if (dateHealth && dateHealth.present === false && dateHealth.sheet_name) {
    actionNeeded.push({
      key: 'attendee-date-health',
      title: 'Booking Sheet attendee dates incomplete',
      detail: dateHealth.sheet_name,
      why: 'Last upload had >10% NULL dates on Workshops or Courses-Classes — re-upload after fix'
    });
  }

  return {
    as_of: today,
    week_start: weekStart,
    survival_gp: survival,
    stretch: {
      stretch1: Number(targets?.stretch1_gp_monthly || 4000),
      stretch2: Number(targets?.stretch2_gp_monthly || 4700)
    },
    quarters: STRATEGY_QUARTERS,
    current_quarter: currentQuarter,
    actions,
    overdue_actions: overdueActions,
    gp_series: gpSeries.slice(-18),
    gp_t3: gpT3,
    roadmap: ROADMAP_MILESTONES,
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
    kpis,
    beginners_sources: beg.buckets,
    workshop_signals: ws,
    upcoming_events: upcoming,
    plan_clients: planCredit,
    beginners_conversion: conversion,
    plans_connected: plansConnected,
    scorecard: {
      gp: { mtd: null, t3: gpT3, survival },
      plans: { sold_week: null, active: plans.length ? plansActive : null, target: 12 },
      beginners: { next_8w_booked: beg.next_8w_booked, next_8w_seats: beg.next_8w_seats, non_jlr_ytd: beg.non_jlr_ytd, dec_target: 8 },
      returning: { r12: returning, target: 23000, dec_target: 16000 }
    },
    action_needed: actionNeeded
  };
}
