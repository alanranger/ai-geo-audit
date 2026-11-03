/**
 * Monday brief · Section 1 Pipeline (batch 8 task 15c / 15g.1).
 * Every scheduled event 0–90 days (booked or not) + booked events 90+ days, by EVENT date.
 * £ taken = paid so far (what would be refunded if it didn't run); due = outstanding balance.
 * Sources: strategy diary (0–84d, Squarespace feed + product capacity), Squarespace feed (85–90d + links),
 * Booking Sheet Workshops / Courses-Classes tabs (who, £), schedule CSV (courses outside the
 * workshop feed, e.g. Lightroom) and sale-only course transactions (booked by JLR with no
 * Courses-Classes row) attached to the next scheduled run of that course.
 */
import { fuzzyPlace, norm, defaultCapacity, makeProductCapLookup, loadProductVariants } from '../strategy-diary.mjs';
import { loadSquarespaceEventFeeds } from '../squarespace-events-feed.mjs';
import { strategyShortName } from '../strategy-short-names.mjs';

const DAY_MS = 86400000;
export const WINDOWS = [
  { key: 'w0', label: '0–30 days', head: 'Next 30 days', min: 0, max: 30 },
  { key: 'w1', label: '31–60 days', head: '31–60 days', min: 31, max: 60 },
  { key: 'w2', label: '61–90 days', head: '61–90 days', min: 61, max: 90 },
  { key: 'w3', label: '90+ days', head: '90+ days', min: 91, max: Infinity }
];
const DIARY_HORIZON_DAYS = 84;
const SALE_LOOKBACK_DAYS = 120;
const SALE_MATCH_DAYS = 7;
const SALE_TO_EVENT_MAX_DAYS = 45;
const PLACE_KEYS = [
  'bluebell', 'fairy', 'dartmoor', 'devon', 'hartland', 'norfolk', 'kenilworth', 'padley', 'lake district',
  'crackley', 'hay woods', 'macro', 'batsford', 'vyrnwy', 'pistyll', 'anglesey', 'dorset', 'suffolk',
  'yorkshire', 'chesterton', 'burnham', 'lavender', 'heather', 'secret', 'snowdonia', 'glencoe'
];
const SHORT_NAMES = [
  [/fairy glen/i, 'Fairy Glen'],
  [/hartland|devon/i, 'Devon'],
  [/dartmoor/i, 'Dartmoor'],
  [/long exposure.*kenilworth|kenilworth.*long exposure/i, 'Long Exposure · Kenilworth'],
  [/blu(e)?bell/i, 'Bluebell Woodlands']
];

function daysBetween(fromYmd, toYmd) {
  return Math.round((Date.parse(`${toYmd}T12:00:00Z`) - Date.parse(`${fromYmd}T12:00:00Z`)) / DAY_MS);
}

function addDaysYmd(ymd, n) {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

function absUrl(url) {
  if (!url) return null;
  return /^https?:/i.test(url) ? url : `https://www.alanranger.com${url.startsWith('/') ? '' : '/'}${url}`;
}

function courseKind(text) {
  const t = String(text || '').toLowerCase();
  if (t.includes('lightroom') || t.includes('lightoom')) return 'lightroom';
  if (t.includes('beginner') || t.includes('camera course')) return 'beginners';
  return null;
}

/** Short pipeline name, as in the approved mockup. */
export function pipelineName(title, type) {
  const kind = courseKind(title);
  if (kind === 'beginners') return 'Beginners course (3 wks)';
  if (kind === 'lightroom') return 'Lightroom course';
  const hit = SHORT_NAMES.find(([re]) => re.test(title));
  const name = hit ? hit[1] : strategyShortName(title, {});
  return type === 'residential' && !/residential/i.test(name) ? `${name} residential` : name;
}

function placeKeys(text) {
  const t = norm(text);
  return PLACE_KEYS.filter((k) => t.includes(k));
}

/** Same event/theme: fuzzy words, or a shared place keyword (Devon ↔ Hartland Quay, Devon). */
function samePlace(a, b) {
  if (fuzzyPlace(a, b) || fuzzyPlace(b, a)) return true;
  const kb = new Set(placeKeys(b));
  return placeKeys(a).some((k) => kb.has(k));
}

/** Alan 2 Nov: booked ≥ places (even over-subscribed) is simply "Full" — not an issue. */
export function fillLabel(booked, cap) {
  if (!booked) return 'Empty';
  if (cap == null) return 'Booked';
  if (booked >= cap) return 'Full';
  return booked * 2 < cap ? 'Low' : 'OK';
}

function sheetNote(theme) {
  const m = String(theme || '').match(/\(([^)]*[a-z][^)]*)\)/i);
  return m ? m[1].trim().replace(/\s+/g, ' ') : null;
}

function attendeeFromWorkshop(r) {
  return {
    name: r.client_name,
    paid: Number(r.paid) || 0,
    due: Math.max(0, -(Number(r.balance) || 0)),
    note: sheetNote(r.theme_location)
  };
}

function attendeeFromCourse(r) {
  return { name: r.client_name, paid: Number(r.paid) || 0, due: Math.max(0, -(Number(r.balance) || 0)), note: null };
}

function workshopMatches(rows, date, title) {
  return (rows || []).filter((r) => r.client_name && r.event_start === date && samePlace(r.theme_location, title))
    .sort((a, b) => (a.id || 0) - (b.id || 0));
}

function courseMatches(rows, date, kind) {
  return (rows || []).filter((r) => r.client_name && (r.from_date || r.to_date) === date
    && courseKind(r.event_name) === kind);
}

function makeRow({ date, title, type, url, cap, attendees, today, source }) {
  const people = attendees.length;
  return {
    date,
    days: daysBetween(today, date),
    title,
    name: pipelineName(title, type),
    type,
    url: absUrl(url),
    cap: cap ?? null,
    booked: people,
    label: fillLabel(people, cap ?? null),
    who: attendees,
    taken: attendees.reduce((a, x) => a + x.paid, 0),
    due: attendees.reduce((a, x) => a + x.due, 0),
    source
  };
}

function diaryRows(diary, ctx) {
  return (diary || []).filter((e) => e.date >= ctx.today).map((e) => {
    const kind = e.kind === 'course' ? courseKind(e.title) || 'beginners' : null;
    const attendees = kind
      ? courseMatches(ctx.courses, e.date, kind).map(attendeeFromCourse)
      : workshopMatches(ctx.workshops, e.date, e.title).map(attendeeFromWorkshop);
    return makeRow({
      date: e.date, title: e.title, type: e.type, url: e.url,
      cap: kind === 'lightroom' ? null : e.cap, attendees, today: ctx.today, source: 'diary'
    });
  });
}

function sameEvent(r, title) {
  if (samePlace(r.title, title) || samePlace(r.name, title)) return true;
  const kind = courseKind(title);
  return !!kind && courseKind(r.name) === kind;
}

function isListed(rows, date, title) {
  return rows.some((r) => r.date === date && sameEvent(r, title));
}

function feedType(e) {
  const span = e.end && e.date ? daysBetween(e.date, e.end) + 1 : 1;
  return span >= 2 || /residential|night/i.test(e.title) ? 'residential' : 'day';
}

/** Feed events past the diary horizon: 85–90d always, 90+ only when booked. */
function feedRows(feeds, rows, ctx) {
  const out = [];
  const from = addDaysYmd(ctx.today, DIARY_HORIZON_DAYS + 1);
  for (const e of feeds?.workshops || []) {
    if (e.date < from || isListed(rows.concat(out), e.date, e.title)) continue;
    const attendees = workshopMatches(ctx.workshops, e.date, e.title).map(attendeeFromWorkshop);
    const days = daysBetween(ctx.today, e.date);
    if (days > 90 && !attendees.length) continue;
    const type = feedType(e);
    out.push(makeRow({
      date: e.date, title: e.title, type, url: e.url,
      cap: ctx.capFor(e.title, type), attendees, today: ctx.today, source: 'feed'
    }));
  }
  return out;
}

/** Booked sheet events not in the diary or feed (dedupe theme variants on the same date). */
function sheetOnlyRows(rows, ctx) {
  const out = [];
  for (const r of ctx.workshops || []) {
    if (!r.client_name || !r.event_start || r.event_start < ctx.today) continue;
    if (isListed(rows.concat(out), r.event_start, r.theme_location)) continue;
    const title = String(r.theme_location || '').replace(/\(.*$/, '').trim();
    const type = r.is_multi_day ? 'residential' : 'day';
    const attendees = workshopMatches(ctx.workshops, r.event_start, title).map(attendeeFromWorkshop);
    out.push(makeRow({
      date: r.event_start, title, type, url: null,
      cap: ctx.capFor(title, type), attendees, today: ctx.today, source: 'sheet'
    }));
  }
  return out;
}

function scheduleCourseRows(schedule, rows, ctx) {
  const out = [];
  for (const s of schedule || []) {
    const kind = courseKind(s.title);
    if (kind !== 'lightroom' || !/week\s*1\s*of/i.test(s.title) || s.start_date < ctx.today) continue;
    if (isListed(rows.concat(out), s.start_date, s.title)) continue;
    const attendees = courseMatches(ctx.courses, s.start_date, kind).map(attendeeFromCourse);
    out.push(makeRow({
      date: s.start_date, title: s.title, type: 'course', url: null,
      cap: null, attendees, today: ctx.today, source: 'schedule'
    }));
  }
  return out;
}

function onCoursesTab(courses, txn) {
  const who = norm(txn.client_name);
  return (courses || []).some((c) => c.date_booked && Math.abs(daysBetween(c.date_booked, txn.txn_date)) <= SALE_MATCH_DAYS
    && (!who || norm(c.client_name) === who));
}

function nextScheduledRun(rows, kind, txnDate) {
  return rows.filter((r) => r.source === 'schedule' && courseKind(r.name) === kind && r.date >= txnDate)
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}

/**
 * 15g.1: a course sale with no Courses-Classes row (e.g. Lightroom via JLR) joins the next scheduled
 * run of that course. Only courses outside the workshop feed (source 'schedule'), and only when the
 * run starts within 45 days of the sale — beginners courses are tracked on the Courses-Classes tab.
 */
export function attachSaleOnlyCourses(rows, txns, courses) {
  const attached = [];
  for (const t of txns || []) {
    const kind = courseKind(`${t.canonical_product || ''} ${t.event_label || ''}`);
    if (!kind || !(Number(t.amount) > 0) || onCoursesTab(courses, t)) continue;
    const target = nextScheduledRun(rows, kind, t.txn_date);
    if (!target || daysBetween(t.txn_date, target.date) > SALE_TO_EVENT_MAX_DAYS) continue;
    target.who.push({ name: t.is_jlr ? 'JLR delegate' : t.client_name, paid: Number(t.amount) || 0, due: 0, note: null, sale_only: true, jlr: !!t.is_jlr });
    target.booked = target.who.length;
    target.taken += Number(t.amount) || 0;
    target.label = fillLabel(target.booked, target.cap);
    target.sale_only = true;
    attached.push({ txn_date: t.txn_date, event_date: target.date, kind, jlr: !!t.is_jlr, amount: Number(t.amount) || 0 });
  }
  return attached;
}

function summarise(rows) {
  return {
    events: rows.length,
    people: rows.reduce((a, r) => a + r.booked, 0),
    taken: rows.reduce((a, r) => a + r.taken, 0),
    due: rows.reduce((a, r) => a + r.due, 0),
    empty: rows.filter((r) => !r.booked).length
  };
}

export function assemblePipeline({ diary, feeds, workshops, courses, schedule, saleTxns, today, capFor }) {
  const ctx = { today, workshops, courses, capFor: capFor || (() => null) };
  let rows = diaryRows(diary, ctx);
  rows = rows.concat(scheduleCourseRows(schedule, rows, ctx));
  rows = rows.concat(feedRows(feeds, rows, ctx));
  rows = rows.concat(sheetOnlyRows(rows, ctx));
  const saleOnly = attachSaleOnlyCourses(rows, saleTxns, courses);
  rows = rows.filter((r) => r.days <= 90 || r.booked > 0).sort((a, b) => a.date.localeCompare(b.date));
  // Alan's rule: totals add up — rows are whole pounds, so each band and the footer total are sums of what's shown.
  for (const r of rows) {
    r.taken = Math.round(r.taken);
    r.due = Math.round(r.due);
  }
  const windows = WINDOWS.map((w) => {
    const wr = rows.filter((r) => r.days >= w.min && r.days <= w.max);
    return { ...w, max: Number.isFinite(w.max) ? w.max : null, rows: wr, ...summarise(wr) };
  });
  const next90 = rows.filter((r) => r.days <= 90);
  return {
    as_of: today,
    windows,
    totals: summarise(rows),
    next90: { events: next90.length, people: next90.reduce((a, r) => a + r.booked, 0) },
    sale_only_attached: saleOnly,
    flags: rows.flatMap((r) => r.who.filter((w) => w.note).map((w) => ({ date: r.date, event: r.name, name: w.name, note: w.note })))
  };
}

function capLookupFrom(variants) {
  const lookup = makeProductCapLookup(variants || []);
  return (title, type) => lookup(title)?.max ?? defaultCapacity(type, title).cap;
}

/** Full pipeline for the brief. `diary` = strategy brief diary (already built this run). */
export async function buildPipeline(supabase, propertyUrl, { diary, today }) {
  const [inputs, feeds, variants] = await Promise.all([
    loadPipelineInputs(supabase, propertyUrl, today),
    loadSquarespaceEventFeeds().catch(() => ({ workshops: [], beginners: [] })),
    loadProductVariants().catch(() => [])
  ]);
  return assemblePipeline({ diary, feeds, today, capFor: capLookupFrom(variants), ...inputs });
}

/** Loads the sheet / schedule rows the pipeline needs (diary comes from the strategy brief). */
export async function loadPipelineInputs(supabase, propertyUrl, today) {
  const since = addDaysYmd(today, -SALE_LOOKBACK_DAYS);
  const [ws, cs, sched, tx] = await Promise.all([
    supabase.from('booking_sheet_workshop_attendees')
      .select('id, event_start, theme_location, client_name, paid, balance, is_multi_day')
      .eq('property_url', propertyUrl).gte('event_start', today).limit(2000),
    supabase.from('booking_sheet_course_attendees')
      .select('from_date, to_date, date_booked, event_name, client_name, paid, balance, is_booking_row, source_bucket')
      .eq('property_url', propertyUrl).eq('is_booking_row', true)
      .or(`from_date.gte.${today},date_booked.gte.${since}`).limit(3000),
    supabase.from('schedule_csv_snapshot').select('title, start_date, kind').gte('start_date', today).limit(1000),
    supabase.from('booking_sheet_transactions')
      .select('txn_date, client_name, category_order, amount, event_label, canonical_product, is_jlr')
      .eq('property_url', propertyUrl).eq('category_order', 1).gte('txn_date', since).limit(2000)
  ]);
  for (const r of [ws, cs, sched, tx]) if (r.error) throw new Error(`pipeline_inputs:${r.error.message}`);
  return { workshops: ws.data || [], courses: cs.data || [], schedule: sched.data || [], saleTxns: tx.data || [] };
}
