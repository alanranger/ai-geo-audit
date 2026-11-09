/**
 * Results → "Bookings after" + "£": places booked on the promoted event(s) from the send day to the event date,
 * from the Booking Sheet with the same rule as the old "Campaigns this week: stages & results" panel
 * (lib/strategy-campaigns.mjs eventBookings: an attendee counts when their latest transaction before the event falls in
 * the window; assisted, inferred from dates). Read-only; attendee names stay on the server, only counts are returned.
 * Promoted events per row: an event campaign record's event key; a post's step "featured" events; a theme email with
 * no event link: the known upcoming events whose short name appears in its subject (labelled "matched by subject").
 * No linked event → null ("—"); a linked event with nothing booked → 0 / £0.
 */
import { campaignSheets, eventBookings } from '../strategy-campaigns.mjs';

const PROP = 'https://www.alanranger.com';
const STOP = new Set(['course', 'courses', 'workshop', 'workshops', 'photography', 'photo', 'photographic', 'classes', 'class', 'week', 'weekend', 'beginners', 'editing', 'lessons', 'something', 'watch', 'your', 'next', 'step', 'gift', 'gifts', 'inspiration', 'with', 'from', 'starts', 'last', 'places', 'offer', 'ends', 'saturday', 'district', 'autumn', 'winter', 'spring', 'summer', 'https', 'www', 'alanranger']);
const londonDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const tokens = (s) => (String(s || '').toLowerCase().match(/[a-z]{4,}/g) || []).filter((t) => !STOP.has(t));

export const kindOf = (url) => (/^\/beginners-photography-lessons\//.test(String(url)) ? 'course' : 'workshop');
const pathOf = (u) => String(u || '').replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
/** A readable event name from its page when no title is stored ("/…/landscape-photography-workshop-norfolk" → "Landscape photography workshop norfolk"). */
const pageName = (url) => {
  const s = String(url).split('/').filter(Boolean).pop() || '';
  return s ? `${s.charAt(0).toUpperCase()}${s.slice(1).replace(/-/g, ' ')}` : url;
};
const readable = (t) => (t && !/^(https?:|\/)/.test(t) ? t : null);
export function eventFromKey(key, title, name) {
  const [date, raw] = String(key || '').split('|');
  const url = pathOf(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !url) return null;
  const label = readable(title) || readable(name) || pageName(url);
  return { event_key: `${date}|${url}`, date, url, title: label, name: readable(name) || label, kind: kindOf(url) };
}
const fromFeatured = (f) => eventFromKey(f?.event_key || (f?.date && f?.url ? `${f.date}|${f.url}` : null), f?.title, f?.name);
/** One event per page: offer / last-chance moments on the same page fold into the event (its latest date). */
export function onePerPage(evs) {
  const groups = new Map();
  for (const e of evs) groups.set(e.url, [...(groups.get(e.url) || []), e]);
  const pages = [...groups.values()].map((list) => {
    const latest = list.reduce((a, b) => (b.date > a.date ? b : a));
    const named = list.find((e) => !/^(https?:|\/)/.test(e.title)) || latest;
    return { ...latest, title: named.title, name: named.name };
  });
  const same = new Map();
  for (const e of pages) {
    const k = `${e.date}|${e.kind}|${tokens(e.name)[0] || e.url}`;
    if (!same.has(k)) same.set(k, e);
  }
  return [...same.values()];
}

/** Known upcoming events after the send whose short name shares a word with the subject. */
export function eventsBySubject(subject, catalog, sendDay) {
  const words = new Set(tokens(subject));
  return catalog.filter((e) => e.date >= sendDay && tokens(e.name).some((t) => words.has(t)));
}

/** → [{ ev, basis }] for one Results row. */
export function linkedEvents(row, ctx) {
  const sendDay = londonDay(row.sent_at);
  if (row.event_keys?.length) return row.event_keys.map((k) => ({ ev: eventFromKey(k, row.event_title), basis: 'campaign record' })).filter((x) => x.ev);
  if (row.kind === 'social') {
    const evs = onePerPage(row.step_keys.flatMap((k) => (ctx.featured.get(k) || []).map(fromFeatured)).filter(Boolean));
    return evs.map((ev) => ({ ev, basis: 'the post\'s featured event' }));
  }
  return eventsBySubject(row.copy, ctx.catalog, sendDay).map((ev) => ({ ev, basis: 'matched by subject' }));
}

/** Sum over the linked events: [send day, event date]; null when nothing is linked. */
export function bookingsFor(row, links, sheets) {
  if (!links.length) return null;
  const start = londonDay(row.sent_at);
  const after = links.reduce((acc, { ev }) => {
    const b = ev.date >= start ? eventBookings(ev, { start, end: ev.date }, sheets) : { bookings: 0, revenue: 0 };
    return { bookings: acc.bookings + b.bookings, revenue: acc.revenue + b.revenue };
  }, { bookings: 0, revenue: 0 });
  return { after, events: links.map(({ ev, basis }) => ({ title: ev.title, date: ev.date, basis })) };
}

/* ---------- reads ---------- */

async function pages(build, what) {
  const out = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(`${what}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function stepEvents(sb, sinceDay, keys) {
  const sel = 'step_key, featured';
  const recent = await pages(() => sb.from('strategy_campaign_steps').select(sel).gte('scheduled_day', sinceDay), 'strategy_campaign_steps');
  const extra = keys.length ? await pages(() => sb.from('strategy_campaign_steps').select(sel).in('step_key', keys), 'strategy_campaign_steps') : [];
  return new Map([...recent, ...extra].map((s) => [s.step_key, Array.isArray(s.featured) ? s.featured : []]));
}

async function eventCatalog(sb, featured) {
  const { data, error } = await sb.from('strategy_campaigns').select('event_key, title').eq('property_url', PROP).eq('kind', 'event').not('event_key', 'is', null).limit(500);
  if (error) throw new Error(`strategy_campaigns: ${error.message}`);
  return onePerPage([...(data || []).map((r) => eventFromKey(r.event_key, r.title)), ...[...featured.values()].flat().map(fromFeatured)].filter(Boolean));
}

async function loadSheets(sb, fromDay, events) {
  const dates = [...new Set(events.map((e) => e.date))];
  if (!dates.length) return campaignSheets([], [], []);
  const toDay = dates.sort().slice(-1)[0];
  const [txns, courses, workshops] = await Promise.all([
    pages(() => sb.from('booking_sheet_transactions').select('txn_date, category_order, amount, client_name, is_jlr').eq('property_url', PROP).gte('txn_date', fromDay).lte('txn_date', toDay).in('category_order', [1, 2, 3]), 'booking_sheet_transactions'),
    pages(() => sb.from('booking_sheet_course_attendees').select('from_date, client_name, source_bucket').eq('property_url', PROP).in('from_date', dates), 'booking_sheet_course_attendees'),
    pages(() => sb.from('booking_sheet_workshop_attendees').select('event_start, theme_location, client_name').eq('property_url', PROP).in('event_start', dates), 'booking_sheet_workshop_attendees')
  ]);
  return campaignSheets(txns, courses, workshops);
}

/** Adds `bookings` to every row (null = no linked event); internal link fields are dropped from the response. */
export async function attachBookings(sb, rows, sinceIso) {
  const sinceDay = sinceIso.slice(0, 10);
  const featured = await stepEvents(sb, sinceDay, [...new Set(rows.flatMap((r) => r.step_keys))]);
  const ctx = { featured, catalog: await eventCatalog(sb, featured) };
  const links = rows.map((r) => linkedEvents(r, ctx));
  const sheets = await loadSheets(sb, sinceDay, links.flat().map((x) => x.ev));
  return rows.map((r, i) => {
    const { event_keys: _k, event_title: _t, ...rest } = r;
    return { ...rest, bookings: bookingsFor(r, links[i], sheets) };
  });
}
