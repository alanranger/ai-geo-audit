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
    diary.push(...workshopRows(e, { variants, workshops, paceByKey }));
  }
  diary.push(...productOnlyRows(diary, variants, { workshops, paceByKey, today, end12 }));

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
      title: e.push_title || e.title,
      gap: e.booked < (e.be_free != null ? e.be_free : e.be)
        ? `needs ${(e.be_free != null ? e.be_free : e.be) - e.booked} more to run (time free)`
        : `${e.left} places, £${e.unsold_gbp} unsold`
    }));
}

function actionTitle(e) {
  return e.is_subrow && e.push_title ? e.push_title : `${e.date} ${e.title}`;
}

function statusReason(e) {
  return e.is_subrow ? String(e.status || '').toLowerCase() : e.status;
}

function mismatchReason(e) {
  return e.flag_message || 'Sheet and shop counts do not match — check for a missing or extra booking.';
}

/** Reasons a single diary row needs action (parent rows: mismatch only). */
function diaryReasons(e, win, stale14) {
  if (e.is_parent) return e.mismatch ? [mismatchReason(e)] : [];
  if (e.excludePush) return [];
  const out = [];
  if (e.date <= win.end8 && (e.status === 'Below break-even' || e.status === 'No bookings')) out.push(statusReason(e));
  if (e.type === 'residential' && e.date <= win.end60 && e.booked <= 2) out.push('residential ≤2 booked');
  if (e.mismatch) out.push(mismatchReason(e));
  if (e.over) out.push(`Over capacity (${e.booked} booked / ${e.cap} cap) — move or refund the overflow.`);
  if (stale14?.has?.(e.eventKey)) out.push('0 sales in last 14 days');
  return out;
}

/** One line per event; combine reasons. */
export function buildActionNeeded(diary, actions, weekStart, opts = {}) {
  const win = {
    end8: new Date(Date.now() + 56 * 86400000).toISOString().slice(0, 10),
    end60: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10)
  };
  const byKey = new Map();
  const add = (key, title, reason, url, sep = null) => {
    if (!byKey.has(key)) byKey.set(key, { key, title, reasons: [], url, detail: '', sep });
    const r = byKey.get(key);
    if (!r.reasons.includes(reason)) r.reasons.push(reason);
    r.detail = r.reasons.join(' · ');
  };

  for (const e of diary) {
    for (const reason of diaryReasons(e, win, opts.stale14)) {
      add(e.eventKey, actionTitle(e), reason, e.url, e.is_subrow ? ': ' : null);
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
    url: r.url,
    sep: r.sep
  }));
}

// ---------------------------------------------------------------------------
// Workshop row builders (session AM/PM detection + product-only events)
// ---------------------------------------------------------------------------

const SESSION_CAP = 6;
const SESSION_BE = 2;
const PRODUCT_ONLY_RE = /christmas|evening|walk/i;

function sessionPair(vs) {
  const am = vs.find((x) => x.session === 'AM');
  const pm = vs.find((x) => x.session === 'PM');
  return am && pm ? { am, pm } : null;
}

function shortEventName(title) {
  const n = norm(title);
  const key = PLACE_KEYS.find((k) => n.includes(k));
  const base = key || n.split(' ').slice(0, 2).join(' ');
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}

function dayMonthLabel(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${d.getUTCDate()} ${d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
}

function sessionSubRow({ e, v, session, eventKey, ctx }) {
  const left = v.qty != null ? v.qty : SESSION_CAP;
  const sold = Math.max(0, SESSION_CAP - left);
  const key = `${eventKey}|${session}`;
  return row({
    date: e.date, title: e.title, type: 'day', kind: 'workshop', url: e.url || v.url,
    price: v.price ?? 99, booked: sold, cap: SESSION_CAP, left, be: SESSION_BE,
    over: false, mismatch: false, flag_message: null,
    note: session, eventKey: key, excludePush: false,
    is_subrow: true, session, parentKey: eventKey,
    push_title: `${shortEventName(e.title)} ${dayMonthLabel(e.date)} ${session}`,
    pace: paceDelta(ctx.paceByKey, key, sold),
    capacity_source: `${session} session: cap ${SESSION_CAP}, booked = shop sold (${SESSION_CAP} − left)`,
    listPrice: v.listPrice, salePrice: v.salePrice, onSale: v.onSale, qty: left
  });
}

/**
 * Linked stock: AM/PM booking also takes All Day; All Day takes AM+PM.
 * Parent = slim totals + sheet mismatch flag; AM and PM are the actionable sub-rows.
 */
function sessionParentRow({ e, pair, eventKey, ctx, sold }) {
  const booked = countSheetBooked(ctx.workshops, e.title, e.date);
  const combined = sold.am + sold.pm;
  const lo = Math.max(sold.am, sold.pm);
  const mismatch = booked < lo || booked > combined;
  return row({
    date: e.date, title: e.title, type: 'day', kind: 'workshop', url: e.url,
    price: pair.am.price ?? 99, booked, cap: SESSION_CAP * 2,
    left: (pair.am.qty ?? SESSION_CAP) + (pair.pm.qty ?? SESSION_CAP),
    be: SESSION_BE, rag_booked: combined, over: booked > SESSION_CAP * 2,
    mismatch,
    flag_message: mismatch
      ? `Sheet has ${booked} booking${booked === 1 ? '' : 's'}; shop shows ${combined} sold across AM/PM (expected ${lo}–${combined}). Check for a missing or extra booking.`
      : null,
    note: `AM ${sold.am}/${SESSION_CAP} · PM ${sold.pm}/${SESSION_CAP}`,
    eventKey, excludePush: true, is_parent: true,
    pace: paceDelta(ctx.paceByKey, eventKey, booked),
    am_sold: sold.am, pm_sold: sold.pm,
    capacity_source: 'AM + PM sessions linked (All Day = min of both)',
    listPrice: pair.am.listPrice, salePrice: pair.am.salePrice, onSale: pair.am.onSale, qty: pair.am.qty
  });
}

function sessionRows({ e, pair, eventKey, ctx }) {
  const soldOf = (v) => Math.max(0, SESSION_CAP - (v.qty != null ? v.qty : SESSION_CAP));
  const sold = { am: soldOf(pair.am), pm: soldOf(pair.pm) };
  return [
    sessionParentRow({ e, pair, eventKey, ctx, sold }),
    sessionSubRow({ e, v: pair.am, session: 'AM', eventKey, ctx }),
    sessionSubRow({ e, v: pair.pm, session: 'PM', eventKey, ctx })
  ];
}

function fallbackPrice(type, title) {
  if (type === 'residential') return 1075;
  return /walk/i.test(title) ? 35 : 125;
}

function variantFields(v) {
  const x = v || {};
  return { listPrice: x.listPrice, salePrice: x.salePrice, onSale: x.onSale, qty: x.qty };
}

function parseDaysFromText(text) {
  const m = String(text || '').match(/\b(\d)\s*days?\b/i);
  return m ? Number(m[1]) : null;
}

function durationFields(e, v, type) {
  if (type !== 'residential') return { end: e.end || null, days: 1, nights: 0 };
  const fromText = parseDaysFromText(`${e.title} ${v?.optText || ''} ${v?.productTitle || ''}`);
  const span = e.end && e.date
    ? Math.max(1, Math.round((new Date(`${e.end}T12:00:00Z`) - new Date(`${e.date}T12:00:00Z`)) / 86400000) + 1)
    : null;
  const days = fromText || span || 2;
  return { end: e.end || null, days, nights: Math.max(0, days - 1) };
}

function simpleWorkshopRow({ e, v, type, eventKey, ctx }) {
  const booked = countSheetBooked(ctx.workshops, e.title, e.date); // never dedupe names/order refs
  const price = v?.price ?? fallbackPrice(type, e.title);
  const stock = v?.qty != null ? v.qty : e.places_left;
  const resolved = resolveCapacity(type, e.title, v?.productMax, booked, stock);
  const shopSold = resolved.cap - resolved.left;
  return row({
    date: e.date, title: e.title, type, kind: 'workshop', url: e.url || v?.url,
    price, booked, ...resolved, be: breakEven(type), over: resolved.over, mismatch: resolved.mismatch,
    flag_message: resolved.mismatch
      ? `Shop shows ${shopSold} sold, sheet has ${booked}: check for a missing or extra booking.`
      : null,
    note: '',
    eventKey, excludePush: false,
    pace: paceDelta(ctx.paceByKey, eventKey, booked),
    ...variantFields(v),
    ...durationFields(e, v, type),
    capacity_source: resolved.capacity_source,
    from_product_only: !!e.from_product_only
  });
}

function workshopRows(e, ctx) {
  const span = e.end ? Math.round((new Date(e.end) - new Date(e.date)) / 86400000) + 1 : 1;
  const type = span >= 2 ? 'residential' : (/walk/i.test(e.title) ? 'walk' : 'day');
  const vs = findVariants(e.title, e.date, ctx.variants);
  const eventKey = `${e.date}|${norm(e.title).slice(0, 48)}`;
  const pair = sessionPair(vs);
  if (pair) return sessionRows({ e, pair, eventKey, ctx });
  return [simpleWorkshopRow({ e, v: vs[0] || null, type, eventKey, ctx })];
}

function productOnlyGroups(variants, today, end12) {
  const map = new Map();
  for (const v of variants) {
    if (!v.date || v.date < today || v.date > end12) continue;
    if (!PRODUCT_ONLY_RE.test(`${v.productTitle} ${v.optText}`)) continue;
    const key = `${v.date}|${v.productTitle}`;
    if (!map.has(key)) map.set(key, v);
  }
  return [...map.values()];
}

function inDiary(diary, v) {
  const name = `${v.productTitle} ${v.optText}`;
  return diary.some((r) => r.date === v.date && (fuzzyPlace(r.title, name) || fuzzyPlace(name, r.title)));
}

/**
 * Events that exist only as product variants (e.g. Christmas Evening / Christmas Walk)
 * and are missing from the Squarespace events feed.
 */
export function productOnlyRows(diary, variants, ctx) {
  const out = [];
  for (const v of productOnlyGroups(variants, ctx.today, ctx.end12)) {
    if (inDiary([...diary, ...out], v)) continue;
    const title = String(v.productTitle || '').replace(/\s+/g, ' ').trim();
    const e = { date: v.date, title, url: v.url, end: null, places_left: null, from_product_only: true };
    const type = /walk/i.test(title) ? 'walk' : 'day';
    const eventKey = `${e.date}|${norm(title).slice(0, 48)}`;
    out.push(simpleWorkshopRow({ e, v, type, eventKey, ctx }));
  }
  return out;
}
