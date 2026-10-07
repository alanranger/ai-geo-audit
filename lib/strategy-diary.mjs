/**
 * Strategy v4 diary — match Squarespace events to product variants + sheet bookings.
 */
import { loadSquarespaceEventFeeds } from './squarespace-events-feed.mjs';

const PRODUCTS_URL = 'https://www.alanranger.com/photo-workshops-uk?format=json';
const PLACE_KEYS = [
  'batsford', 'padley', 'vyrnwy', 'pistyll', 'norfolk', 'cromer',
  'lake district', 'christmas', 'woodland', 'macro', 'abstract', 'secrets',
  'hay woods', 'piles', 'crackley'
];

export function norm(s) {
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

export function fuzzyPlace(a, b) {
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
    day = Number(m[1]); mon = months[m[2].slice(0, 3).toLowerCase()]; year = m[3] ? Number(m[3]) : 2026;
  } else {
    mon = months[m[1].slice(0, 3).toLowerCase()]; day = Number(m[2]); year = m[3] ? Number(m[3]) : 2026;
  }
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

function money(v) {
  const pence = v.onSale && v.salePrice != null ? v.salePrice : v.price;
  return pence == null ? null : pence / 100;
}

function stripHtml(s) {
  return String(s || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Parse "max N" / "up to N" / "N places" from product copy. */
export function parseStatedMax(text) {
  const t = stripHtml(text);
  const m = t.match(/\b(?:max(?:imum)?|up to)\s*(\d{1,2})\b/i)
    || t.match(/\b(\d{1,2})\s*(?:places|spaces|people|guests)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 2 && n <= 12 ? n : null;
}

export async function loadProductVariants() {
  const j = await fetch(PRODUCTS_URL).then((r) => r.json());
  const variants = [];
  for (const it of j.items || []) {
    const productText = [it.title, it.excerpt, it.description, it.body].map(stripHtml).join(' ');
    const productMax = parseStatedMax(productText);
    for (const v of it.variants || []) {
      const optText = Object.values(v.attributes || {}).join(' | ');
      variants.push({
        productTitle: it.title || '',
        url: it.url || it.fullUrl || null,
        optText,
        productText,
        productMax,
        date: parseDayMonthYear(optText) || parseDayMonthYear(it.title),
        session: sessionTag(optText),
        price: money(v),
        salePrice: v.salePrice != null ? v.salePrice / 100 : null,
        listPrice: v.price != null ? v.price / 100 : null,
        qty: v.qtyInStock,
        onSale: !!v.onSale,
        sku: v.sku
      });
    }
  }
  return variants;
}

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
  score += tokens(title).filter((t) => tokens(blob).includes(t)).length;
  if (fuzzyPlace(v.productTitle, title)) score += 5;
  return score;
}

function findVariants(title, date, variants) {
  const scored = variants
    .map((v) => ({ v, score: scoreVariant(title, date, v) }))
    .filter((x) => x.score >= 10)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const top = scored[0].score;
  const best = scored.filter((x) => x.score >= top - 2).map((x) => x.v);
  const product = best[0].productTitle;
  return variants.filter((v) => v.productTitle === product && (!v.date || v.date === date) && scoreVariant(title, date, v) >= 8);
}

export function countSheetBooked(workshops, title, date, session = null) {
  let n = 0;
  for (const r of workshops || []) {
    if (!r.client_name || !r.event_start || r.event_start !== date) continue;
    const theme = r.theme_location || '';
    if (!fuzzyPlace(theme, title) && !fuzzyPlace(title, theme)) continue;
    if (session) {
      const th = norm(theme);
      if (session === 'AM' && !/\bam\b|morning/.test(th)) continue;
      if (session === 'PM' && !/\bpm\b|afternoon/.test(th)) continue;
      // All Day only when explicitly tagged — bare "Batsford" stays unassigned
      if (session === 'All Day' && !/all\s*day|full\s*day/.test(th)) continue;
    }
    n += 1;
  }
  return n;
}

function breakEven(type) {
  return type === 'residential' ? 3 : 2;
}

/** RAG: red / amber / green (+ full green with check). Over cap / mismatch are separate flags. */
export function ragFor(booked, cap, be) {
  if (booked <= 0) return 'red';
  const fill = cap > 0 ? booked / cap : 0;
  if (fill >= 0.5 && booked >= be) return 'green';
  return 'amber';
}

export function statusLabel(booked, cap, be) {
  if (booked > cap) return 'Over cap';
  if (booked >= cap) return 'Full';
  if (booked === 0) return 'No bookings';
  if (booked < be) return 'Below break-even';
  return 'OK';
}

function removeDatesFromActions(actions) {
  const set = new Set(['2026-10-12', '2026-10-14']);
  for (const a of actions || []) {
    if (a.is_ticked || !/remove/i.test(a.label || '')) continue;
    for (const m of String(a.label).matchAll(/(\d{1,2})\s*(?:&|and|,)?\s*(\d{1,2})?\s*(oct|nov|dec|jan|feb|mar|apr|may|jun|jul|aug|sep)/gi)) {
      const mon = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' }[m[3].slice(0, 3).toLowerCase()];
      const y = Number(mon) >= 10 ? '2026' : '2027';
      set.add(`${y}-${mon}-${String(m[1]).padStart(2, '0')}`);
      if (m[2]) set.add(`${y}-${mon}-${String(m[2]).padStart(2, '0')}`);
    }
  }
  return set;
}

/** Alan defaults: day/half-day/walk/Batsford session = 6; residential = 4; course = 4. */
function defaultCapacity(type, title) {
  if (type === 'course') return { cap: 4, source: 'default:course=4' };
  if (type === 'residential') return { cap: 4, source: 'default:residential=4' };
  if (/batsford/i.test(title)) return { cap: 6, source: 'default:batsford=6/session' };
  if (/walk/i.test(title)) return { cap: 6, source: 'default:walk=6' };
  return { cap: 6, source: 'default:day=6' };
}

/**
 * Capacity = product "max N" if present, else defaults.
 * MISMATCH only when sheet booked + places left ≠ capacity.
 */
function resolveCapacity(type, title, productMax, booked, stock) {
  const def = defaultCapacity(type, title);
  const cap = productMax != null ? productMax : def.cap;
  const capacity_source = productMax != null ? `product:max ${productMax}` : def.source;
  const left = stock != null ? stock : Math.max(0, cap - booked);
  const mismatch = stock != null ? (booked + left !== cap) : (booked > cap);
  const over = booked > cap;
  const fill_pct = cap > 0 ? Math.min(100, Math.round((booked / cap) * 1000) / 10) : null;
  return { cap, left, mismatch, over, capacity_source, fill_pct };
}

/**
 * Build next-12-week diary rows from live feeds + products + sheet.
 */
export async function buildStrategyDiary({ workshops, courses, actions, snapshots = [] }) {
  const [feeds, variants] = await Promise.all([
    loadSquarespaceEventFeeds(),
    loadProductVariants()
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const end12 = new Date(Date.now() + 84 * 86400000).toISOString().slice(0, 10);
  const removeDates = removeDatesFromActions(actions);
  const diary = [];

  // Pace map: sheet_booked delta vs snapshot ~7 days ago
  const paceByKey = new Map();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  for (const s of snapshots || []) {
    if (s.snapshot_date > weekAgo) continue;
    const prev = paceByKey.get(s.event_key);
    if (!prev || s.snapshot_date > prev.snapshot_date) paceByKey.set(s.event_key, s);
  }

  for (const e of feeds.workshops) {
    if (e.date < today || e.date > end12) continue;
    const span = e.end ? Math.round((new Date(e.end) - new Date(e.date)) / 86400000) + 1 : 1;
    const type = span >= 2 ? 'residential' : (/walk/i.test(e.title) ? 'walk' : 'day');
    const vs = findVariants(e.title, e.date, variants);
    const isBatsford = /batsford/i.test(e.title);
    const eventKey = `${e.date}|${norm(e.title).slice(0, 48)}`;

    if (isBatsford && vs.length) {
      // Linked stock: AM/PM booking also takes All Day; All Day takes AM+PM.
      // All Day left = min(AM left, PM left). Display AM sold/6 · PM sold/6 only.
      const amV = vs.find((x) => x.session === 'AM');
      const pmV = vs.find((x) => x.session === 'PM');
      const amLeft = amV?.qty != null ? amV.qty : 6;
      const pmLeft = pmV?.qty != null ? pmV.qty : 6;
      const amSold = Math.max(0, 6 - amLeft);
      const pmSold = Math.max(0, 6 - pmLeft);
      const combinedSold = amSold + pmSold;
      const booked = countSheetBooked(workshops, e.title, e.date);
      const mmLo = Math.max(amSold, pmSold);
      const mmHi = combinedSold;
      const mismatch = booked < mmLo || booked > mmHi;
      const cap = 12;
      const left = amLeft + pmLeft;
      const fill_pct = Math.min(100, Math.round((combinedSold / 12) * 1000) / 10);
      const be = 2;
      const price = amV?.price ?? 99;
      const flag_message = mismatch
        ? `Sheet has ${booked} booking${booked === 1 ? '' : 's'}; shop shows ${combinedSold} sold across AM/PM (expected ${mmLo}–${mmHi}). Check for a missing or extra booking.`
        : null;
      diary.push(row({
        date: e.date, title: e.title, type: 'day', kind: 'workshop', url: e.url,
        price, booked, cap, left, fill_pct, be,
        rag_booked: combinedSold,
        over: booked > cap,
        mismatch,
        flag_message,
        note: `AM ${amSold}/6 · PM ${pmSold}/6`,
        eventKey, excludePush: false,
        pace: paceDelta(paceByKey, eventKey, booked),
        am_sold: amSold, pm_sold: pmSold,
        capacity_source: 'Batsford linked AM/PM (All Day = min of both)',
        listPrice: amV?.listPrice, salePrice: amV?.salePrice, onSale: amV?.onSale, qty: amLeft
      }));
      continue;
    }

    const v = vs[0] || null;
    const booked = countSheetBooked(workshops, e.title, e.date); // never dedupe names/order refs
    let price = v?.price ?? (type === 'residential' ? 1075 : (/walk/i.test(e.title) ? 35 : 125));
    const stock = v?.qty != null ? v.qty : e.places_left;
    const resolved = resolveCapacity(type, e.title, v?.productMax, booked, stock);
    const be = breakEven(type);
    const shopSold = resolved.cap - resolved.left;
    const flag_message = resolved.mismatch
      ? `Shop shows ${shopSold} sold, sheet has ${booked}: check for a missing or extra booking.`
      : null;
    diary.push(row({
      date: e.date, title: e.title, type, kind: 'workshop', url: e.url || v?.url,
      price, booked, ...resolved, be, over: resolved.over, mismatch: resolved.mismatch,
      flag_message,
      note: '',
      eventKey, excludePush: false,
      pace: paceDelta(paceByKey, eventKey, booked),
      listPrice: v?.listPrice, salePrice: v?.salePrice, onSale: v?.onSale, qty: v?.qty,
      capacity_source: resolved.capacity_source
    }));
  }

  // Courses: Week 1 groups
  const groups = new Map();
  for (const e of feeds.beginners) {
    if (!/week\s*(\d)\s*of\s*3/i.test(e.title) && !/beginner|lightroom/i.test(e.title)) continue;
    const m = e.title.match(/week\s*(\d)\s*of\s*3/i);
    const week = m ? Number(m[1]) : 1;
    const base = e.title.replace(/week\s*\d\s*of\s*3/ig, 'Week 1 of 3').replace(/\s*-\s*\d{1,2}-\d{1,2}\s*$/, '').trim();
    let key = week === 1 ? `${e.date}|${base}` : [...groups.keys()].reverse().find((k) => k.includes(base.slice(0, 40))) || `${e.date}|${base}`;
    if (!groups.has(key)) groups.set(key, { date: e.date, title: base.replace(/Week 1 of 3/i, '3-week beginners').slice(0, 80), url: e.url });
    if (week === 1) groups.get(key).date = e.date;
  }
  for (const g of groups.values()) {
    if (g.date < today || g.date > end12) continue;
    const booked = (courses || []).filter((r) => r.client_name && (r.from_date || r.to_date) === g.date).length;
    const cap = 4;
    const left = Math.max(0, cap - booked);
    const be = 2;
    const eventKey = `${g.date}|course|${norm(g.title).slice(0, 40)}`;
    const resolved = resolveCapacity('course', g.title, null, booked, left);
    diary.push(row({
      date: g.date, title: g.title, type: 'course', kind: 'course', url: g.url,
      price: 150, booked, ...resolved, be, over: resolved.over, mismatch: resolved.mismatch,
      flag_message: resolved.mismatch
        ? `Sheet bookings (${booked}) do not match course capacity left (${resolved.left}). Check the Courses-Classes tab.`
        : null,
      note: '',
      eventKey, excludePush: removeDates.has(g.date),
      pace: paceDelta(paceByKey, eventKey, booked),
      capacity_source: resolved.capacity_source
    }));
  }

  diary.sort((a, b) => a.date.localeCompare(b.date));
  return { diary, feeds, variants };
}

function paceDelta(paceByKey, eventKey, booked) {
  const prev = paceByKey.get(eventKey);
  if (!prev) return null;
  return booked - Number(prev.sheet_booked || 0);
}

function row(o) {
  const ragBooked = o.rag_booked != null ? o.rag_booked : o.booked;
  const status = o.over ? 'Over cap' : statusLabel(ragBooked, o.cap, o.be);
  const rag = ragFor(ragBooked, o.cap, o.be);
  const fill_pct = o.fill_pct != null ? o.fill_pct
    : (o.cap > 0 ? Math.min(100, Math.round((ragBooked / o.cap) * 1000) / 10) : null);
  return {
    ...o,
    status,
    rag: o.over && o.booked > 0 ? 'amber' : rag,
    fill_pct,
    booked_gbp: Math.round(o.booked * o.price),
    unsold_gbp: Math.round(o.left * o.price),
    full: ragBooked >= o.cap && !o.over
  };
}

/** RED first, then AMBER; within band by date then £ unsold. GREEN never listed. */
export function buildPushList(diary, days = 56, max = 5) {
  const end = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const rank = { red: 0, amber: 1 };
  return diary
    .filter((e) => !e.excludePush && e.date <= end && (e.rag === 'red' || e.rag === 'amber'))
    .sort((a, b) => {
      const rd = (rank[a.rag] ?? 9) - (rank[b.rag] ?? 9);
      if (rd) return rd;
      const dd = a.date.localeCompare(b.date);
      if (dd) return dd;
      return (b.unsold_gbp || 0) - (a.unsold_gbp || 0);
    })
    .slice(0, max)
    .map((e) => ({
      ...e,
      gap: e.booked < e.be ? `needs ${e.be - e.booked} more to run` : `${e.left} places, £${e.unsold_gbp} unsold`
    }));
}

/** One line per event; combine reasons. */
export function buildActionNeeded(diary, actions, weekStart, opts = {}) {
  const end8 = new Date(Date.now() + 56 * 86400000).toISOString().slice(0, 10);
  const end60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const byKey = new Map();
  const add = (key, title, reason, url) => {
    if (!byKey.has(key)) byKey.set(key, { key, title, reasons: [], url, detail: '' });
    const row = byKey.get(key);
    if (!row.reasons.includes(reason)) row.reasons.push(reason);
    row.detail = row.reasons.join(' · ');
  };

  for (const e of diary) {
    if (e.excludePush) continue;
    const key = e.eventKey;
    if (e.date <= end8 && (e.status === 'Below break-even' || e.status === 'No bookings')) {
      add(key, `${e.date} ${e.title}`, e.status, e.url);
    }
    if (e.type === 'residential' && e.date <= end60 && e.booked <= 2) {
      add(key, `${e.date} ${e.title}`, `residential ≤2 booked`, e.url);
    }
    if (e.mismatch) add(key, `${e.date} ${e.title}`, e.flag_message || 'Sheet and shop counts do not match — check for a missing or extra booking.', e.url);
    if (e.over) add(key, `${e.date} ${e.title}`, `Over capacity (${e.booked} booked / ${e.cap} cap) — move or refund the overflow.`, e.url);
    if (opts.stale14?.has?.(e.eventKey)) {
      add(key, `${e.date} ${e.title}`, '0 sales in last 14 days', e.url);
    }
  }
  for (const a of actions || []) {
    if (!a.is_ticked && a.due_week_start && a.due_week_start < weekStart) {
      add(`q-${a.id}`, a.label, 'Quarter action overdue', null);
    }
  }
  if (opts.dateHealthFail) {
    add('date-health', 'Attendee dates', `Date check failed on ${opts.dateHealthFail} — fix attendee dates on the sheet.`, null);
  }
  return [...byKey.values()].map((r) => ({
    key: r.key,
    title: r.title,
    detail: r.detail,
    why: r.detail,
    url: r.url
  }));
}
