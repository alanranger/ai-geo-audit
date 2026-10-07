/**
 * DESIGN mockup only — Strategy tab v4 from live Squarespace products + events + sheet.
 * node scripts/render-strategy-v4-mockup.mjs
 */
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { loadSquarespaceEventFeeds } from '../lib/squarespace-events-feed.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['.env.vercel.prod', '.env.local']) {
  try {
    for (const line of readFileSync(resolve(root, name), 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      const val = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '');
      if (!process.env[m[1]] || (name === '.env.vercel.prod' && val.startsWith('sb_'))) process.env[m[1]] = val;
    }
  } catch { /* optional */ }
}

const OUT = resolve('C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude');
mkdirSync(OUT, { recursive: true });
const PROP = 'https://www.alanranger.com';
const PRODUCTS_URL = 'https://www.alanranger.com/photo-workshops-uk?format=json';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function gbp(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return '£' + Math.round(Number(n)).toLocaleString('en-GB');
}
function pct(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `${Number(n).toFixed(1)}%`;
}
function dayName(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/vyrnwey/g, 'vyrnwy')
    .replace(/blubebell/g, 'bluebell')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function tokens(s) {
  return norm(s).split(' ').filter((w) => w.length >= 4);
}
function fuzzyPlace(a, b) {
  const ta = tokens(a);
  const tb = new Set(tokens(b));
  if (!ta.length || !tb.size) return false;
  const hits = ta.filter((t) => tb.has(t) || [...tb].some((x) => x.includes(t) || t.includes(x))).length;
  return hits >= Math.min(2, ta.length);
}
function parseDayMonthYear(text) {
  const m = String(text || '').match(/\b(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–]\s*\d{1,2})?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(20\d{2})?/i)
    || String(text || '').match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\s*(20\d{2})?/i)
    || String(text || '').match(/\b(?:mon|tue|wed|thu|fri|sat|sun)\s+(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(20\d{2})?/i);
  if (!m) return null;
  const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  let day; let mon; let year;
  if (/^\d/.test(m[1])) {
    day = Number(m[1]); mon = months[m[2].slice(0, 3).toLowerCase()]; year = m[3] ? Number(m[3]) : null;
  } else if (months[m[1].slice(0, 3).toLowerCase()] != null) {
    mon = months[m[1].slice(0, 3).toLowerCase()]; day = Number(m[2]); year = m[3] ? Number(m[3]) : null;
  } else {
    day = Number(m[1]); mon = months[m[2].slice(0, 3).toLowerCase()]; year = m[3] ? Number(m[3]) : null;
  }
  if (year == null) year = day >= 1 && mon >= 9 ? 2026 : 2026;
  const d = new Date(Date.UTC(year, mon, day));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function sessionTag(text) {
  const t = String(text || '');
  if (/\ball\s*day\b/i.test(t)) return 'All Day';
  if (/\bAM\b|\b8am\b/i.test(t) && !/\bPM\b/i.test(t)) return 'AM';
  if (/\bPM\b|\b12pm\b/i.test(t)) return 'PM';
  return null;
}
function moneyFromVariant(v) {
  const pence = v.onSale && v.salePrice != null ? v.salePrice : v.price;
  return pence == null ? null : pence / 100;
}
function breakEven(type) {
  return type === 'residential' ? 3 : 2;
}
function statusFor(booked, cap, be) {
  if (booked > cap) return 'Over cap';
  if (booked >= cap) return 'Full';
  if (booked === 0) return 'No bookings';
  if (booked < be) return 'Below break-even';
  return 'OK';
}
function statusClass(s) {
  if (s === 'OK') return 'ok';
  if (s === 'Full') return 'full';
  return 'bad';
}
function avg(nums) {
  const a = nums.filter((n) => n != null && !Number.isNaN(n));
  if (!a.length) return null;
  return a.reduce((x, y) => x + y, 0) / a.length;
}
function changePct(cur, prior) {
  if (cur == null || prior == null || prior === 0) return null;
  return ((cur - prior) / Math.abs(prior)) * 100;
}
function inRange(iso, a, b) {
  return iso && iso >= a && iso <= b;
}

const [feeds, productsJson, summaryRes] = await Promise.all([
  loadSquarespaceEventFeeds(),
  fetch(PRODUCTS_URL).then((r) => r.json()),
  fetch(`https://ai-geo-audit.vercel.app/api/aigeo/strategy-summary?propertyUrl=${encodeURIComponent(PROP)}`).then((r) => r.json())
]);
const summary = summaryRes;
const { data: workshops } = await sb.from('booking_sheet_workshop_attendees')
  .select('event_start, theme_location, client_name, is_multi_day, paid')
  .eq('property_url', PROP);
const { data: courses } = await sb.from('booking_sheet_course_attendees')
  .select('from_date, to_date, event_name, client_name, is_beginners, is_booking_row, source_bucket, paid')
  .eq('property_url', PROP);
const { data: actions } = await sb.from('strategy_quarter_actions')
  .select('*').eq('property_url', PROP).eq('quarter_key', 'q1-2026').order('sort_order');

const variants = [];
for (const it of productsJson.items || []) {
  for (const v of it.variants || []) {
    const optText = Object.values(v.attributes || {}).join(' | ');
    const date = parseDayMonthYear(optText) || parseDayMonthYear(it.title);
    variants.push({
      productTitle: it.title || '',
      url: it.url || it.fullUrl || null,
      optText,
      date,
      session: sessionTag(optText),
      price: moneyFromVariant(v),
      qty: v.qtyInStock,
      onSale: !!v.onSale,
      sku: v.sku
    });
  }
}

const PLACE_KEYS = ['batsford', 'padley', 'vyrnwy', 'pistyll', 'norfolk', 'cromer', 'lake district', 'christmas', 'woodland', 'macro', 'abstract', 'secrets', 'hay woods', 'piles', 'crackley'];

function scoreVariant(title, date, v) {
  const blob = norm(`${v.productTitle} ${v.optText}`);
  const nt = norm(title);
  let score = 0;
  if (v.date) {
    if (v.date !== date) return -1;
    score += 8;
  }
  for (const key of PLACE_KEYS) {
    if (nt.includes(key) && blob.includes(key)) score += 10;
  }
  const tt = tokens(title);
  const bt = tokens(blob);
  score += tt.filter((t) => bt.includes(t)).length;
  // Prefer product title overlap over generic "photography workshop"
  if (fuzzyPlace(v.productTitle, title)) score += 5;
  return score;
}

function findVariantsForEvent(title, date) {
  const scored = variants
    .map((v) => ({ v, score: scoreVariant(title, date, v) }))
    .filter((x) => x.score >= 10)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const top = scored[0].score;
  const best = scored.filter((x) => x.score >= top - 2).map((x) => x.v);
  // Same product / same date sessions (Batsford)
  const product = best[0].productTitle;
  return variants.filter((v) => v.productTitle === product && (!v.date || v.date === date) && scoreVariant(title, date, v) >= 8);
}

function countSheetBookedExact(title, date, session = null) {
  let n = 0;
  for (const r of workshops || []) {
    if (!r.client_name || !r.event_start) continue;
    if (r.event_start !== date) continue;
    const theme = r.theme_location || '';
    if (!fuzzyPlace(theme, title) && !fuzzyPlace(title, theme)) continue;
    if (session) {
      const th = norm(theme);
      if (session === 'AM' && !/\bam\b|morning/.test(th)) continue;
      if (session === 'PM' && !/\bpm\b|afternoon/.test(th)) continue;
      if (session === 'All Day' && !/all\s*day|full\s*day/.test(th) && (/\bam\b|\bpm\b/.test(th))) continue;
    }
    n += 1;
  }
  return n;
}

function countCourseBooked(date) {
  return (courses || []).filter((r) => r.is_booking_row !== false && r.client_name && (r.from_date || r.to_date) === date).length;
}

const removeDates = new Set();
for (const a of actions || []) {
  if (a.is_ticked) continue;
  if (!/remove/i.test(a.label || '')) continue;
  for (const m of String(a.label).matchAll(/(\d{1,2})\s*(&|and|,)?\s*(\d{1,2})?\s*(oct|nov|dec|jan|feb|mar|apr|may|jun|jul|aug|sep)/gi)) {
    const mon = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' }[m[4].slice(0, 3).toLowerCase()];
    const y = Number(mon) >= 10 ? '2026' : '2027';
    removeDates.add(`${y}-${mon}-${String(m[1]).padStart(2, '0')}`);
    if (m[3]) removeDates.add(`${y}-${mon}-${String(m[3]).padStart(2, '0')}`);
  }
}
// Explicit: beginners 12 & 14 Oct open remove action
removeDates.add('2026-10-12');
removeDates.add('2026-10-14');

const today = new Date().toISOString().slice(0, 10);
const end12 = new Date(Date.now() + 84 * 86400000).toISOString().slice(0, 10);
const end8 = new Date(Date.now() + 56 * 86400000).toISOString().slice(0, 10);
const end4 = new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10);
const end60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);

const diary = [];
for (const e of feeds.workshops) {
  if (e.date < today || e.date > end12) continue;
  const span = e.end ? Math.round((new Date(e.end) - new Date(e.date)) / 86400000) + 1 : 1;
  const type = span >= 2 ? 'residential' : (/walk/i.test(e.title) ? 'walk' : 'day');
  const vs = findVariantsForEvent(e.title, e.date);
  const isBatsford = /batsford/i.test(e.title);

  if (isBatsford && vs.length) {
    const bySession = { AM: null, PM: null, 'All Day': null };
    for (const v of vs) {
      if (v.session && bySession[v.session] === null) bySession[v.session] = v;
    }
    const parts = Object.entries(bySession).filter(([, v]) => v);
    const bookedTotal = countSheetBookedExact(e.title, e.date);
    const caps = parts.map(([, v]) => ({
      session: v.session, left: v.qty ?? 0, price: v.price,
      booked: countSheetBookedExact(e.title, e.date, v.session)
    }));
    const price = parts.find(([, v]) => v.session === 'AM')?.[1]?.price ?? 99;
    const capDate = 6;
    const booked = bookedTotal;
    const left = e.places_left != null ? e.places_left : Math.min(...caps.map((c) => c.left));
    const be = 2;
    const status = statusFor(booked, capDate, be);
    const split = caps.map((c) => `${c.session}:${c.left}left`).join(' · ');
    const mismatch = (booked > 0 && caps.every((c) => c.left >= 5)) || booked > capDate;
    diary.push({
      date: e.date, title: e.title, kind: 'workshop', type: 'day', url: e.url,
      price, cap: capDate, booked, left, be, status: booked > capDate ? 'Over cap' : status,
      bookedGbp: booked * price, unsoldGbp: left * price,
      mismatch,
      sessionNote: `${split} · sheet ${booked}`,
      pace: '—', excludePush: false, day: dayName(e.date)
    });
    continue;
  }

  const v = vs[0] || null;
  const booked = countSheetBookedExact(e.title, e.date);
  let price = v?.price ?? null;
  if (price == null) price = type === 'residential' ? 1075 : (/walk/i.test(e.title) ? 35 : 125);
  let left = v?.qty != null ? v.qty : (e.places_left != null ? e.places_left : null);
  let cap = type === 'residential' ? 4 : (/walk/i.test(e.title) ? 6 : 4);
  if (/christmas/i.test(e.title) && /evening/i.test(e.title)) cap = 6;
  if (/christmas/i.test(e.title) && /walk/i.test(e.title)) cap = 4;
  if (left == null) left = Math.max(0, cap - booked);
  // Cap = stated max; if stock+booked disagrees, keep stated max and flag
  const be = breakEven(type);
  let status = statusFor(booked, cap, be);
  const webSold = v?.qty != null ? Math.max(0, (booked + left) - left) : null;
  // website implied sold ≈ cap - qty when cap known; prefer qty vs sheet
  const impliedSold = v?.qty != null ? null : null;
  void impliedSold;
  const mismatch = (v?.qty != null && Math.abs(booked - Math.max(0, cap - v.qty)) >= 1 && !(booked === 0 && v.qty === cap))
    || booked > cap
    || (v?.qty != null && booked + v.qty !== cap && Math.abs(booked + v.qty - cap) >= 1);
  // Vyrnwy-style: sheet booked vs (unknown cap - qty) — flag when sheet≠0 and qty suggests different sold
  if (v?.qty != null && type === 'residential' && booked !== Math.max(0, 4 - v.qty)) {
    // keep mismatch from above
  }
  if (booked > cap) status = 'Over cap';
  diary.push({
    date: e.date, title: e.title, kind: 'workshop', type, url: e.url || v?.url,
    price, cap, booked, left, be, status,
    bookedGbp: booked * price, unsoldGbp: left * price,
    mismatch: !!mismatch || (type === 'residential' && v?.qty != null && booked !== Math.max(0, 4 - v.qty)),
    sessionNote: [v?.onSale ? 'sale price' : '', v ? `sku stock ${v.qty}` : ''].filter(Boolean).join(' · '),
    pace: '—', excludePush: false, day: dayName(e.date)
  });
}

// Courses: group Week 1/2/3
const courseGroups = new Map();
for (const e of feeds.beginners) {
  if (!/week\s*(\d)\s*of\s*3/i.test(e.title) && !/beginner|lightroom/i.test(e.title)) continue;
  const m = e.title.match(/week\s*(\d)\s*of\s*3/i);
  const week = m ? Number(m[1]) : 1;
  const base = e.title.replace(/week\s*\d\s*of\s*3/ig, 'Week 1 of 3').replace(/\s*-\s*\d{1,2}-\d{1,2}\s*$/, '').trim();
  let key = week === 1 ? `${e.date}|${base}` : [...courseGroups.keys()].reverse().find((k) => k.includes(base.slice(0, 40))) || `${e.date}|${base}`;
  if (!courseGroups.has(key)) {
    courseGroups.set(key, {
      date: e.date,
      title: base.replace(/Week 1 of 3/i, '3-week beginners').slice(0, 80),
      url: e.url
    });
  }
  if (week === 1) courseGroups.get(key).date = e.date;
}
for (const g of courseGroups.values()) {
  if (g.date < today || g.date > end12) continue;
  const booked = countCourseBooked(g.date);
  const cap = 4;
  const left = Math.max(0, cap - booked);
  const be = 2;
  const status = statusFor(booked, cap, be);
  diary.push({
    date: g.date, title: g.title, kind: 'course', type: 'course', url: g.url,
    price: 150, cap, booked, left, be, status,
    bookedGbp: booked * 150, unsoldGbp: left * 150,
    mismatch: false, sessionNote: 'left = cap − sheet (ignore Sold Out text)',
    pace: '—', excludePush: removeDates.has(g.date), day: dayName(g.date)
  });
}
diary.sort((a, b) => a.date.localeCompare(b.date));

// KPIs from sheet (L12 / prior / QTD)
const qStart = '2026-10-01';
const l12Start = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
const priorStart = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
const priorEnd = new Date(Date.now() - 365 * 86400000 - 86400000).toISOString().slice(0, 10);

function workshopRuns(start, end, predicate) {
  const map = new Map();
  for (const r of workshops || []) {
    if (!r.client_name || !r.event_start || !inRange(r.event_start, start, end)) continue;
    if (predicate && !predicate(r)) continue;
    const k = `${r.event_start}|${norm(r.theme_location).slice(0, 40)}`;
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.values()];
}
function courseRuns(start, end) {
  const map = new Map();
  for (const r of courses || []) {
    if (!r.client_name || !(r.is_booking_row !== false)) continue;
    const d = r.from_date || r.to_date;
    if (!inRange(d, start, end)) continue;
    map.set(d, (map.get(d) || 0) + 1);
  }
  return [...map.values()];
}

const dayPred = (r) => !r.is_multi_day;
const resPred = (r) => !!r.is_multi_day;

const f1_l12 = avg(workshopRuns(l12Start, today, dayPred));
const f1_prior = avg(workshopRuns(priorStart, priorEnd, dayPred));
const f1_q = avg(workshopRuns(qStart, today, dayPred));
const f2_l12 = avg(workshopRuns(l12Start, today, resPred));
const f2_prior = avg(workshopRuns(priorStart, priorEnd, resPred));
const f2_q = avg(workshopRuns(qStart, today, resPred));
const f3_l12 = avg(courseRuns(l12Start, today));
const f3_prior = avg(courseRuns(priorStart, priorEnd));
const f3_q = avg(courseRuns(qStart, today));

const courseDates = (courses || []).map((r) => r.from_date || r.to_date).filter(Boolean).sort();
const courseCoveragePrior = courseDates.length
  ? `prior: ${courseDates[0].slice(0, 7)}…${priorEnd.slice(0, 7)} (partial)`
  : 'prior: n/a';

function fillRate(type, start, end) {
  const caps = { day: 4, residential: 4, course: 4, walk: 6 };
  let booked = 0; let cap = 0; let runs = 0;
  if (type === 'course') {
    const rs = courseRuns(start, end);
    booked = rs.reduce((a, b) => a + b, 0);
    runs = rs.length;
    cap = runs * 4;
  } else {
    const pred = type === 'residential' ? resPred : type === 'walk'
      ? (r) => /walk/i.test(r.theme_location || '') && !r.is_multi_day
      : (r) => !r.is_multi_day && !/walk/i.test(r.theme_location || '');
    const rs = workshopRuns(start, end, pred);
    booked = rs.reduce((a, b) => a + b, 0);
    runs = rs.length;
    cap = runs * (caps[type] || 4);
  }
  if (!runs) return null;
  return (booked / cap) * 100;
}

const revPerRun = (start, end, pred) => {
  const map = new Map();
  for (const r of workshops || []) {
    if (!r.client_name || !r.event_start || !inRange(r.event_start, start, end)) continue;
    if (pred && !pred(r)) continue;
    const k = `${r.event_start}|${norm(r.theme_location).slice(0, 40)}`;
    map.set(k, (map.get(k) || 0) + Number(r.paid || 0));
  }
  const vals = [...map.values()];
  return avg(vals);
};

const sourceSplit = () => {
  const buckets = { Google: 0, Gift: 0, Existing: 0, JLR: 0, Other: 0 };
  for (const r of courses || []) {
    if (!r.client_name || !r.is_beginners) continue;
    const d = r.from_date || r.to_date;
    if (!inRange(d, l12Start, today)) continue;
    const b = String(r.source_bucket || r.source_raw || 'Other');
    if (/jlr/i.test(b)) buckets.JLR += 1;
    else if (/google/i.test(b)) buckets.Google += 1;
    else if (/gift/i.test(b)) buckets.Gift += 1;
    else if (/exist|refer/i.test(b)) buckets.Existing += 1;
    else buckets.Other += 1;
  }
  return buckets;
};
const src = sourceSplit();

const kpiRows = [];
function addKpi(name, qtd, l12, prior, target, status, def, note = '') {
  kpiRows.push({ name, qtd, l12, prior, change: changePct(l12, prior), target, status, def, note });
}

addKpi('F1 Avg booked / run — day', f1_q?.toFixed(1), f1_l12?.toFixed(1), f1_prior?.toFixed(1), '—', f1_l12 != null && f1_l12 >= 2 ? 'ok' : 'watch', 'Booked attendees ÷ day-workshop runs (sheet)');
addKpi('F2 Avg booked / run — residential', f2_q?.toFixed(1), f2_l12?.toFixed(1) ?? summary.workshop_signals?.residential_avg, f2_prior?.toFixed(1), '≥3', (f2_l12 ?? summary.workshop_signals?.residential_avg) >= 3 ? 'ok' : 'watch', 'Multi-day only · original KPI 10');
addKpi('F3 Avg booked / run — beginners', f3_q?.toFixed(1), f3_l12?.toFixed(1), f3_prior?.toFixed(1), '—', 'watch', 'Courses-Classes booking rows ÷ course start dates', courseCoveragePrior);
addKpi('F4 Fill % day / res / course / walk',
  [fillRate('day', qStart, today), fillRate('residential', qStart, today), fillRate('course', qStart, today), fillRate('walk', qStart, today)].map((x) => (x == null ? '—' : x.toFixed(0) + '%')).join(' / '),
  [fillRate('day', l12Start, today), fillRate('residential', l12Start, today), fillRate('course', l12Start, today), fillRate('walk', l12Start, today)].map((x) => (x == null ? '—' : x.toFixed(0) + '%')).join(' / '),
  [fillRate('day', priorStart, priorEnd), fillRate('residential', priorStart, priorEnd), fillRate('course', priorStart, priorEnd), fillRate('walk', priorStart, priorEnd)].map((x) => (x == null ? '—' : x.toFixed(0) + '%')).join(' / '),
  '—', 'watch', 'Booked ÷ capacity · empty runs tracked from 7 Oct 2026', 'empty runs tracked from 7 Oct 2026');
addKpi('F5 Run rate %', 'building', 'building', '—', '—', 'watch', 'Ran ÷ scheduled from strategy_event_snapshots', 'building since 7 Oct 2026');
addKpi('F6 Revenue / run (day / res)',
  [revPerRun(qStart, today, dayPred), revPerRun(qStart, today, resPred)].map((x) => gbp(x)).join(' / '),
  [revPerRun(l12Start, today, dayPred), revPerRun(l12Start, today, resPred)].map((x) => gbp(x)).join(' / '),
  [revPerRun(priorStart, priorEnd, dayPred), revPerRun(priorStart, priorEnd, resPred)].map((x) => gbp(x)).join(' / '),
  '—', 'ok', '£ booked (paid) ÷ runs');
addKpi('F7 Forward 12w places sold vs LY', 'n/a', 'n/a', 'n/a', '—', 'watch', 'Needs booking-date cohort vs same point LY', 'not available yet — no snapshot pace / LY cohort');

addKpi('1 GP / month (T3)', gbp(summary.gp_t3), gbp(summary.gp_t3), '—', '£3,700 (stretch £4k / £4.7k)', summary.gp_t3 >= 3700 ? 'ok' : 'below', 'Trailing 3-month GP vs survival');
addKpi('2 Beginners seats filled %', pct(summary.headline?.beginners_fill_pct), pct(summary.headline?.beginners_fill_pct), '—', '≥60%', (summary.headline?.beginners_fill_pct ?? 0) >= 60 ? 'ok' : 'below', 'Fill incl. zero-booked courses where known', 'empty runs tracked from 7 Oct 2026');
addKpi('3 Non-JLR beginners by source (L12)', `G ${src.Google} / Gift ${src.Gift} / Ex ${src.Existing}`, `JLR ${src.JLR} separate`, '—', 'growing', 'ok', 'Google / Gift / Existing & referral; JLR separate');
addKpi('9 Returning-client revenue L12', gbp(summary.headline?.returning_r12), gbp(summary.headline?.returning_r12), '—', '£16k → £23k', (summary.headline?.returning_r12 ?? 0) >= 16000 ? 'watch' : 'below', 'Excl. JLR and ≥£3k one-offs');
addKpi('10 = F2 (residential avg)', f2_q?.toFixed(1), String(f2_l12?.toFixed(1) ?? summary.workshop_signals?.residential_avg ?? '—'), f2_prior?.toFixed(1), '≥3', 'watch', 'Same as F2 — not duplicated in live UI');
addKpi('4–8 + 11 Plan KPIs', '—', '—', '—', '12 plans / 50% renewals', 'needs_plans', 'Conversion, plans £, credit pace, reviews, discount, renewals', '6 plan KPIs activate when the first plan is added');

// Trends with real L12 vs prior
const dayAttL12 = workshopRuns(l12Start, today, dayPred).reduce((a, b) => a + b, 0);
const dayAttPrior = workshopRuns(priorStart, priorEnd, dayPred).reduce((a, b) => a + b, 0);
const resAttL12 = workshopRuns(l12Start, today, resPred).reduce((a, b) => a + b, 0);
const resAttPrior = workshopRuns(priorStart, priorEnd, resPred).reduce((a, b) => a + b, 0);
const begFill = summary.headline?.beginners_fill_pct;
const dayAvgL12 = f1_l12;
const resAvgL12 = f2_l12 ?? summary.workshop_signals?.residential_avg;

const push = diary
  .filter((e) => !e.excludePush && e.date <= end8 && (e.status === 'Below break-even' || e.status === 'No bookings' || e.left >= 2))
  .map((e) => ({ ...e, score: e.unsoldGbp / Math.max(1, (new Date(`${e.date}T12:00:00Z`) - Date.now()) / 86400000) }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 5);

const actionNeeded = [];
for (const e of diary) {
  if (e.excludePush) continue;
  if (e.date <= end8 && (e.status === 'Below break-even' || e.status === 'No bookings')) {
    actionNeeded.push({ kind: 'gap', text: `${e.day}: ${e.title.slice(0, 48)} — ${e.status}` });
  }
  if (e.type === 'residential' && e.date <= end60 && e.booked <= 2) {
    actionNeeded.push({ kind: 'residential', text: `${e.day}: residential ≤2 booked (${e.booked})` });
  }
}
const mismatchN = diary.filter((e) => e.mismatch).length;
if (mismatchN > 0) actionNeeded.push({ kind: 'data', text: `MISMATCH count ${mismatchN} in next 12 weeks` });
actionNeeded.push({ kind: 'pace', text: '0 sales in last 14 days — needs strategy_event_snapshots (from 7 Oct)' });
for (const a of actions || []) {
  if (!a.is_ticked && a.due_week && String(a.due_week) <= '2026-W41') {
    actionNeeded.push({ kind: 'quarter', text: `Quarter action due: ${a.label}` });
  }
}
const actionUnique = [];
const seen = new Set();
for (const a of actionNeeded) {
  if (seen.has(a.text)) continue;
  seen.add(a.text);
  actionUnique.push(a);
}

const done = (actions || []).filter((a) => a.is_ticked).length;
const gpT3 = summary.gp_t3;
const surv = summary.survival_gp || 3700;

const tableRows = diary.map((e) => `<tr>
  <td>${esc(e.day)}</td>
  <td class="left">${esc(e.title.slice(0, 58))}<div class="muted">${esc(e.type)}${e.sessionNote ? ' · ' + esc(e.sessionNote) : ''}</div></td>
  <td>${gbp(e.price)}</td>
  <td>${e.cap}</td>
  <td>${e.booked}</td>
  <td>${e.left}</td>
  <td class="muted">${esc(e.pace)}</td>
  <td>${e.be}</td>
  <td><span class="pill ${statusClass(e.status)}">${esc(e.status)}</span></td>
  <td>${gbp(e.bookedGbp)}</td>
  <td>${gbp(e.unsoldGbp)}</td>
  <td>${e.mismatch ? '<span class="pill bad">MISMATCH</span>' : '—'}</td>
  <td class="left">${e.url ? `<a href="https://www.alanranger.com${esc(e.url)}" target="_blank">open</a>` : '—'}</td>
</tr>`).join('\n');

const pushRows = push.map((e) => `<tr>
  <td>${esc(e.day)}</td>
  <td class="left">${esc(e.title.slice(0, 56))}</td>
  <td class="left">${e.booked < e.be ? `needs ${e.be - e.booked} more to run` : `${e.left} places, ${gbp(e.unsoldGbp)} unsold`}</td>
  <td class="muted">PROPOSED</td>
  <td>${e.url ? `<a href="https://www.alanranger.com${esc(e.url)}">open</a>` : '—'}</td>
</tr>`).join('\n');

const actionRows = actionUnique.slice(0, 12).map((a) => `<li><span class="pill bad">${esc(a.kind)}</span> ${esc(a.text)}</li>`).join('\n');

const kpiTable = kpiRows.map((k) => `<tr title="${esc(k.def)}">
  <td class="left">${esc(k.name)}${k.note ? `<div class="muted">${esc(k.note)}</div>` : ''}</td>
  <td>${esc(k.qtd)}</td>
  <td>${esc(k.l12)}</td>
  <td>${esc(k.prior)}</td>
  <td>${k.change == null ? '—' : (k.change >= 0 ? '+' : '') + Number(k.change).toFixed(0) + '%'}</td>
  <td>${esc(k.target)}</td>
  <td><span class="pill ${k.status === 'ok' ? 'ok' : k.status === 'needs_plans' ? 'full' : 'bad'}">${esc(k.status)}</span></td>
</tr>`).join('\n');

const css = `
:root { --bg:#0b1118; --panel:#121a24; --border:#1f2937; --text:#e5e7eb; --muted:#94a3b8; --brand:#f59e0b; }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.45 Figtree,Segoe UI,sans-serif; }
.wrap { max-width:1240px; margin:0 auto; padding:1.25rem 1.5rem 3rem; }
h1 { color:var(--brand); margin:0 0 .25rem; font-size:1.55rem; }
.sub { color:var(--muted); margin:0 0 1rem; }
.sec { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:1rem 1.1rem; margin-bottom:1rem; }
.sec h2 { margin:0 0 .65rem; font-size:1.02rem; }
.muted { color:var(--muted); font-size:.76rem; }
table { width:100%; border-collapse:collapse; font-size:.8rem; }
th,td { padding:.38rem .4rem; border-bottom:1px solid #1f2937; text-align:center; vertical-align:top; }
th { color:var(--muted); text-transform:uppercase; font-size:.66rem; letter-spacing:.04em; }
td.left, th.left { text-align:left; }
.pill { display:inline-block; padding:.1rem .4rem; border-radius:4px; font-size:.66rem; font-weight:700; }
.pill.ok { background:#14532d; color:#bbf7d0; }
.pill.full { background:#1e3a8a; color:#bfdbfe; }
.pill.bad { background:#7f1d1d; color:#fecaca; }
.filters { display:flex; gap:.6rem; flex-wrap:wrap; margin-bottom:.7rem; color:var(--muted); font-size:.8rem; }
.filters label { background:#0b1118; border:1px solid var(--border); padding:.3rem .55rem; border-radius:6px; }
.trends { display:grid; grid-template-columns:repeat(4,1fr); gap:.7rem; }
.trend { background:#0b1118; border:1px solid var(--border); border-radius:8px; padding:.7rem; min-height:120px; }
.trend h3 { margin:0 0 .35rem; font-size:.76rem; color:var(--muted); }
.trend .big { font-size:1.15rem; font-weight:800; color:var(--brand); }
.trend svg { width:100%; height:44px; display:block; margin-top:.3rem; }
.q { display:flex; gap:1rem; flex-wrap:wrap; }
.qcard { flex:1; min-width:16rem; background:#0b1118; border:1px solid var(--brand); border-radius:8px; padding:.75rem; }
.banner { background:#1f2937; color:#fde68a; padding:.5rem .75rem; border-radius:6px; margin-bottom:1rem; font-size:.85rem; }
.note { background:#0b1118; border-left:3px solid var(--brand); padding:.55rem .7rem; margin:.5rem 0 .8rem; font-size:.8rem; color:#e2e8f0; }
ul.actions { margin:.3rem 0 0; padding-left:0; list-style:none; font-size:.8rem; }
ul.actions li { margin:.35rem 0; }
a { color:#93c5fd; }
.pagebreak { page-break-before: always; margin-top:2rem; }
`;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Strategy mockup v4</title><style>${css}</style></head>
<body><div class="wrap" id="shot">
  <div class="banner">MOCKUP v4 — real live data · not built yet · awaiting Alan approval</div>
  <h1>Strategy &amp; KPIs</h1>
  <p class="sub">Current position, gaps to fill, and the KPI scorecard · next 12 weeks · <a href="#">plan document ↗</a></p>

  <div class="sec">
    <h2>0 · Data coverage &amp; daily snapshots <span class="muted">(planned)</span></h2>
    <div class="note">
      <b>New table (to build after approval):</b> <code>strategy_event_snapshots</code> — daily capture of every upcoming event
      from both collections + each product variant price / salePrice / qtyInStock.
      Enables empty-run tracking, true fill, run rate, and “+N this week” sales pace from <b>7 Oct 2026</b>.
      Until then F4/F5 past periods use runs with ≥1 booking only — label: <i>empty runs tracked from 7 Oct 2026</i>.
      Course history from Feb 2025 — prior-12 for courses is partial (${esc(courseCoveragePrior)}).
      Importer OK: workshops 411/413 dated · courses 79/79 dated.
    </div>
  </div>

  <div class="sec">
    <h2>A · Next 12 weeks — diary &amp; gaps</h2>
    <div class="filters">
      <label><input type="checkbox" checked disabled> All types</label>
      <label><input type="checkbox" disabled> Needs action only</label>
      <span class="muted">${diary.length} events · left from product qtyInStock · Batsford = AM/PM/All Day split · pace col needs snapshots</span>
    </div>
    <div style="overflow-x:auto">
    <table>
      <thead><tr>
        <th>Date</th><th class="left">Event</th><th>Price</th><th>Cap</th><th>Booked</th><th>Left</th><th>+wk</th><th>B/E</th><th>Status</th><th>£ booked</th><th>£ unsold</th><th>Flag</th><th class="left">Link</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    </div>
  </div>

  <div class="sec">
    <h2>B · Where to push + Action needed</h2>
    <h3 style="margin:.2rem 0 .4rem;font-size:.9rem">Push this week <span class="muted">(max 5 · excludes open “remove” actions e.g. 12 &amp; 14 Oct beginners)</span></h3>
    <table>
      <thead><tr><th>Date</th><th class="left">Event</th><th class="left">Gap</th><th>Decide by</th><th>Link</th></tr></thead>
      <tbody>${pushRows || '<tr><td colspan="5">Nothing to push</td></tr>'}</tbody>
    </table>
    <h3 style="margin:1rem 0 .4rem;font-size:.9rem">Action needed <span class="muted">(triggered only)</span></h3>
    <ul class="actions">${actionRows}</ul>
  </div>

  <div class="sec">
    <h2>C · Trends <span class="muted">(L12 vs prior · labelled)</span></h2>
    <div class="trends">
      <div class="trend"><h3>1 · GP / month (T3)</h3><div class="big">${gbp(gpT3)}</div>
        <div class="muted">vs survival ${gbp(surv)} · stretch £4k / £4.7k</div>
        <svg viewBox="0 0 120 40"><polyline fill="none" stroke="#f59e0b" stroke-width="2" points="0,28 20,24 40,26 60,22 80,18 100,20 120,16"/><line x1="0" y1="14" x2="120" y2="14" stroke="#64748b" stroke-dasharray="3 3"/></svg>
      </div>
      <div class="trend"><h3>2 · Beginners fill</h3><div class="big">${begFill ?? '—'}%</div>
        <div class="muted">L12 · target ≥60% · empty runs from 7 Oct 2026<br>JLR separate faint line</div>
        <svg viewBox="0 0 120 40"><polyline fill="none" stroke="#34d399" stroke-width="2" points="0,30 30,26 60,20 90,22 120,14"/><polyline fill="none" stroke="#475569" stroke-width="1.5" points="0,34 30,32 60,30 90,28 120,27"/></svg>
      </div>
      <div class="trend"><h3>3 · Workshop attendees</h3><div class="big">day ${dayAttL12} · res ${resAttL12}</div>
        <div class="muted">L12 vs prior day ${dayAttPrior} / res ${resAttPrior}
          (${changePct(dayAttL12, dayAttPrior) == null ? '—' : (changePct(dayAttL12, dayAttPrior) >= 0 ? '+' : '') + changePct(dayAttL12, dayAttPrior).toFixed(0) + '% day'})</div>
        <svg viewBox="0 0 120 40"><polyline fill="none" stroke="#60a5fa" stroke-width="2" points="0,22 40,18 80,24 120,16"/><polyline fill="none" stroke="#c084fc" stroke-width="2" points="0,30 40,28 80,26 120,22"/></svg>
      </div>
      <div class="trend"><h3>4 · Avg / run</h3><div class="big">day ${dayAvgL12?.toFixed(1) ?? '—'} · res ${Number(resAvgL12).toFixed(1)}</div>
        <div class="muted">L12 · prior day ${f1_prior?.toFixed(1) ?? '—'} / res ${f2_prior?.toFixed(1) ?? '—'}</div>
        <svg viewBox="0 0 120 40"><polyline fill="none" stroke="#f472b6" stroke-width="2" points="0,20 40,18 80,16 120,14"/></svg>
      </div>
    </div>
  </div>

  <div class="sec">
    <h2>F · KPI scorecard</h2>
    <div class="muted" style="margin-bottom:.5rem">Hover a row for definition · sortable in live build · no per-course lists</div>
    <div style="overflow-x:auto">
    <table>
      <thead><tr><th class="left">KPI</th><th>This QTD</th><th>Last 12m</th><th>Prior 12m</th><th>Change</th><th>Target</th><th>Status</th></tr></thead>
      <tbody>${kpiTable}</tbody>
    </table>
    </div>
  </div>

  <div class="sec">
    <h2>D · This quarter</h2>
    <div class="q">
      <div class="qcard">
        <div><b>Q1 Oct–Dec 2026 — Relaunch</b> <span class="pill ok">${done} of ${(actions || []).length} done</span></div>
        <div class="muted">Targets vs now: plans ${summary.headline?.plans_active ?? 0} / 3 · non-JLR beginners ${summary.roadmap_now?.beginners_non_jlr ?? 0} / 8 · GP T3 ${gbp(gpT3)} / £2.8k · returning ${gbp(summary.headline?.returning_r12)} / £16k</div>
        <ul style="margin:.5rem 0 0;padding-left:1.1rem;font-size:.8rem;max-height:9rem;overflow:auto">
          ${(actions || []).slice(0, 10).map((a) => `<li style="${a.is_ticked ? 'opacity:.55;text-decoration:line-through' : ''}">${esc(a.label)}</li>`).join('')}
        </ul>
      </div>
      <div class="muted" style="flex:0 0 12rem;padding-top:.5rem">Q2–Q4 collapsed in live build</div>
    </div>
  </div>

  <div class="sec muted">E · Plans — hidden until ≥1 Plans row exists (Plans tab connected · 0 plans yet)</div>

  <div class="sec pagebreak" id="brief">
    <h2>Monday CEO brief <span class="muted">(mock · same purpose)</span></h2>
    <ol style="font-size:.85rem;line-height:1.55">
      <li><b>Action needed</b><ul class="actions">${actionUnique.slice(0, 6).map((a) => `<li>${esc(a.text)}</li>`).join('')}</ul></li>
      <li><b>Next 4 weeks gaps</b> + places sold this week:
        ${diary.filter((e) => e.date <= end4 && (e.status === 'Below break-even' || e.status === 'No bookings')).length} gap rows ·
        pace “+N this week” = <i>awaiting snapshots</i></li>
      <li><b>Top 3 to push</b>: ${push.slice(0, 3).map((e) => esc(e.title.slice(0, 40))).join(' · ') || '—'}</li>
      <li><b>KPI strip</b>: GP ${gbp(gpT3)} · F1 ${f1_l12?.toFixed(1) ?? '—'} · F2 ${Number(resAvgL12).toFixed(1)} · F3 ${f3_l12?.toFixed(1) ?? '—'} · F4/F5 labelled · returning ${gbp(summary.headline?.returning_r12)}</li>
      <li><b>Quarter actions due</b>: ${(actions || []).filter((a) => !a.is_ticked).slice(0, 3).map((a) => esc(a.label)).join(' · ')}</li>
      <li><b>Data health</b>: ${mismatchN > 0 ? `MISMATCH ${mismatchN} (show)` : 'ok (hidden when healthy)'} · attendee dates under 10% null</li>
    </ol>
  </div>
</div></body></html>`;

const htmlPath = resolve(OUT, 'MOCKUP-2026-10-07-strategy-tab-v4.html');
writeFileSync(htmlPath, html, 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto('file:///' + htmlPath.replace(/\\/g, '/'));
await page.screenshot({ path: resolve(OUT, 'MOCKUP-2026-10-07-strategy-tab-v4.png'), fullPage: true });
await page.locator('#brief').screenshot({ path: resolve(OUT, 'MOCKUP-2026-10-07-monday-brief-v4.png') });
await browser.close();

const sample = diary.filter((e) => /batsford|padley|vyrnwy|norfolk|lake district|christmas/i.test(e.title));
console.log(JSON.stringify({
  htmlPath,
  png: resolve(OUT, 'MOCKUP-2026-10-07-strategy-tab-v4.png'),
  brief_png: resolve(OUT, 'MOCKUP-2026-10-07-monday-brief-v4.png'),
  diary_rows: diary.length,
  push_rows: push.length,
  mismatch_n: mismatchN,
  remove_dates: [...removeDates],
  sample_fixed: sample.map((e) => ({
    date: e.date, title: e.title.slice(0, 40), price: e.price, cap: e.cap, booked: e.booked, left: e.left, status: e.status, mismatch: e.mismatch, note: e.sessionNote
  })),
  kpi_unavailable: ['F5 run rate (needs snapshots)', 'F7 forward 12w vs LY (needs booking-date cohort)', 'Plan KPIs 4–8+11 (0 plans)', '+wk pace column (needs snapshots)']
}, null, 2));
