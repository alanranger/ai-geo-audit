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

export async function loadProductVariants() {
  const j = await fetch(PRODUCTS_URL).then((r) => r.json());
  const variants = [];
  for (const it of j.items || []) {
    for (const v of it.variants || []) {
      const optText = Object.values(v.attributes || {}).join(' | ');
      variants.push({
        productTitle: it.title || '',
        url: it.url || it.fullUrl || null,
        optText,
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
      if (session === 'All Day' && !/all\s*day|full\s*day/.test(th) && (/\bam\b|\bpm\b/.test(th))) continue;
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

function statedCapacity(type, title, v) {
  if (type === 'residential') return 4;
  if (type === 'course') return 4;
  if (/batsford/i.test(title)) return 6;
  if (/christmas/i.test(title) && /evening/i.test(title)) return 6;
  if (/christmas/i.test(title) && /walk/i.test(title)) return 6;
  if (/walk/i.test(title)) return 6;
  return 4;
}

function resolveCapacity(stated, booked, stock) {
  if (stock == null) return { cap: stated, mismatch: booked > stated };
  const implied = booked + stock;
  if (implied === stated) return { cap: stated, mismatch: false };
  // Prefer stated max when present; mismatch only when genuine conflict
  if (booked > stated) return { cap: stated, mismatch: true };
  if (stock > stated && booked === 0) return { cap: stock, mismatch: false }; // max not stated tightly
  if (Math.abs(implied - stated) >= 1 && booked + stock !== stated) {
    return { cap: stated, mismatch: true };
  }
  return { cap: stated, mismatch: false };
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
      const parts = ['AM', 'PM', 'All Day']
        .map((sess) => vs.find((v) => v.session === sess))
        .filter(Boolean);
      const booked = countSheetBooked(workshops, e.title, e.date);
      const price = parts.find((v) => v.session === 'AM')?.price ?? 99;
      const stated = 6;
      const left = e.places_left != null ? e.places_left : Math.min(...parts.map((v) => v.qty ?? 6));
      const { cap, mismatch } = resolveCapacity(stated, booked, left);
      const be = 2;
      const over = booked > cap;
      const split = parts.map((v) => `${v.session}:${v.qty ?? '—'}left`).join(' · ');
      diary.push(row({
        date: e.date, title: e.title, type: 'day', kind: 'workshop', url: e.url,
        price, cap, booked, left, be, over, mismatch: mismatch || (booked > 0 && parts.every((v) => (v.qty ?? 0) >= 5)),
        note: split, eventKey, excludePush: false, pace: paceDelta(paceByKey, eventKey, booked)
      }));
      continue;
    }

    const v = vs[0] || null;
    const booked = countSheetBooked(workshops, e.title, e.date);
    let price = v?.price ?? (type === 'residential' ? 1075 : (/walk/i.test(e.title) ? 35 : 125));
    const stock = v?.qty != null ? v.qty : e.places_left;
    const stated = statedCapacity(type, e.title, v);
    const { cap, mismatch } = resolveCapacity(stated, booked, stock);
    const left = stock != null ? stock : Math.max(0, cap - booked);
    const be = breakEven(type);
    const over = booked > cap;
    // Residential sheet vs web sold
    let mm = mismatch;
    if (type === 'residential' && stock != null && booked !== Math.max(0, 4 - stock)) mm = true;
    diary.push(row({
      date: e.date, title: e.title, type, kind: 'workshop', url: e.url || v?.url,
      price, cap, booked, left, be, over, mismatch: mm,
      note: v?.onSale ? 'sale price' : '', eventKey, excludePush: false,
      pace: paceDelta(paceByKey, eventKey, booked),
      listPrice: v?.listPrice, salePrice: v?.salePrice, onSale: v?.onSale, qty: v?.qty
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
    diary.push(row({
      date: g.date, title: g.title, type: 'course', kind: 'course', url: g.url,
      price: 150, cap, booked, left, be, over: booked > cap, mismatch: false,
      note: 'left = cap − sheet', eventKey, excludePush: removeDates.has(g.date),
      pace: paceDelta(paceByKey, eventKey, booked)
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
  const status = o.over ? 'Over cap' : statusLabel(o.booked, o.cap, o.be);
  const rag = ragFor(o.booked, o.cap, o.be);
  return {
    ...o,
    status,
    rag: o.over && o.booked > 0 ? 'amber' : rag,
    booked_gbp: Math.round(o.booked * o.price),
    unsold_gbp: Math.round(o.left * o.price),
    full: o.booked >= o.cap && !o.over
  };
}

export function buildPushList(diary, days = 56, max = 5) {
  const end = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  return diary
    .filter((e) => !e.excludePush && e.date <= end && (e.rag === 'red' || e.rag === 'amber' || e.left >= 2))
    .map((e) => ({
      ...e,
      gap: e.booked < e.be ? `needs ${e.be - e.booked} more to run` : `${e.left} places, £${e.unsold_gbp} unsold`,
      score: e.unsold_gbp / Math.max(1, (new Date(`${e.date}T12:00:00Z`) - Date.now()) / 86400000)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
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
    if (e.mismatch) add(key, `${e.date} ${e.title}`, 'MISMATCH', e.url);
    if (e.over) add(key, `${e.date} ${e.title}`, 'Over cap', e.url);
    if (opts.stale14?.has?.(e.eventKey)) {
      add(key, `${e.date} ${e.title}`, '0 sales in last 14 days', e.url);
    }
  }
  for (const a of actions || []) {
    if (!a.is_ticked && a.due_week_start && a.due_week_start < weekStart) {
      add(`q-${a.id}`, a.label, 'Quarter action overdue', null);
    }
  }
  if ((opts.mismatchTotal || 0) > 0) {
    add('data-mismatch', 'Data health', `MISMATCH count ${opts.mismatchTotal}`, null);
  }
  if (opts.dateHealthFail) {
    add('date-health', 'Attendee dates', opts.dateHealthFail, null);
  }
  return [...byKey.values()].map((r) => ({
    key: r.key,
    title: r.title,
    detail: r.detail,
    why: r.detail,
    url: r.url
  }));
}
