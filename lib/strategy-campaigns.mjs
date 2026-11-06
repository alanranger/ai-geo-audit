/**
 * Strategy & Actions campaign layer.
 * Overrides: public.strategy_event_overrides (per event: dont_promote / weekly until the date / offer note). Rows are
 *   ignored once the event date has passed; an offer note is ignored after its end date.
 * Campaign records: one weekly email per week, one per promoted event, plus theme campaigns Alan adds. Stages live in
 *   public.strategy_campaigns (a derived record gets a row only once its stage is moved).
 * Results: Booking Sheet bookings / revenue in the campaign window (inferred: booking date in window, not a click),
 *   GA4 sessions from the campaign's tagged source / medium (measured, but GA4 sync has no campaign-name dimension, so
 *   overlapping campaigns on the same channel share those sessions). Enquiries and email bounces are not available.
 */
import { themeMatchesTitle } from './squarespace-events-feed.mjs';

const DAY = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (s, n) => iso(Date.parse(`${s}T12:00:00Z`) + n * DAY);
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
export const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export const STAGES = ['proposed', 'drafted', 'verified', 'approved', 'scheduled', 'sent', 'measured'];
export const SIDE_STAGES = ['blocked', 'cancelled'];
const SENT = new Set(['sent', 'measured']);

/** Campaign-tagged links: one source / medium per channel. */
export const UTM = {
  email: { source: 'squarespace-email', medium: 'email' },
  facebook: { source: 'facebook', medium: 'social' },
  instagram: { source: 'instagram', medium: 'social' },
  linkedin: { source: 'linkedin', medium: 'social' },
  outlook: { source: 'outlook', medium: 'email' }
};
const EVENT_CHANNELS = ['facebook', 'instagram', 'linkedin', 'outlook'];

function urlPath(u) {
  const s = String(u || '').trim().toLowerCase();
  if (!s) return '';
  return s.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
}
/** Same key for a diary row, a feed event and a moment's event: start date + page path (title when no page). */
export function eventKeyOf(e) {
  return `${String(e?.date || '').slice(0, 10)}|${urlPath(e?.url) || norm(e?.title).slice(0, 40)}`;
}

export async function loadOverrides(supabase, propertyUrl, todayIso) {
  const { data, error } = await supabase.from('strategy_event_overrides').select('*')
    .eq('property_url', propertyUrl).gte('event_date', todayIso).limit(2000);
  if (error) throw new Error(error.message);
  return Object.fromEntries((data || []).map((r) => [r.event_key, r]));
}

function activeOffer(o, todayIso) {
  if (!o?.offer_note) return null;
  if (o.offer_ends && String(o.offer_ends).slice(0, 10) < todayIso) return null;
  return { note: o.offer_note, code: o.offer_code || null, ends: o.offer_ends ? String(o.offer_ends).slice(0, 10) : null };
}
/** Attach event_key, the promotion mode and any live offer note to each site event. */
export function applyOverrides(events, overrides, todayIso) {
  return events.map((e) => {
    const event_key = eventKeyOf(e);
    const o = overrides?.[event_key];
    return { ...e, event_key, promote_mode: o?.promote_mode || 'normal', offer: activeOffer(o, todayIso) };
  });
}

export async function loadCampaignRows(supabase, propertyUrl, todayIso) {
  const { data, error } = await supabase.from('strategy_campaigns').select('*')
    .eq('property_url', propertyUrl).or(`window_end.gte.${addDays(todayIso, -90)},window_end.is.null`).limit(1000);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function loadTaggedSessions(supabase, propertyUrl, fromIso) {
  const { data, error } = await supabase.from('ga4_channel_sessions_daily').select('date, source, medium, sessions')
    .eq('property_url', propertyUrl).gte('date', fromIso).in('medium', ['email', 'social']).limit(10000);
  if (error) throw new Error(error.message);
  return data || [];
}

/* ---------- results ---------- */

function inWindow(d, w) {
  return !!d && d >= w.start && d <= w.end;
}
function txnByClient(txns, cats) {
  const by = new Map();
  for (const t of txns || []) {
    if (t.is_jlr || !cats.includes(Number(t.category_order)) || !t.txn_date || !t.client_name) continue;
    const k = norm(t.client_name);
    (by.get(k) || by.set(k, []).get(k)).push({ date: String(t.txn_date).slice(0, 10), amount: Number(t.amount) || 0 });
  }
  for (const list of by.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return by;
}
function latestBefore(index, client, eventIso) {
  let best = null;
  for (const t of index.get(norm(client)) || []) if (t.date <= eventIso) best = t;
  return best;
}
function eventAttendees(ev, sheets) {
  if (ev.kind === 'course') return (sheets.courses || []).filter((a) => a.source_bucket !== 'JLR' && String(a.from_date || '').slice(0, 10) === ev.date);
  return (sheets.workshops || []).filter((a) => String(a.event_start || '').slice(0, 10) === ev.date && themeMatchesTitle(a.theme_location || a.event_name || '', ev.title));
}
/** Places on this event whose booking (latest matching transaction) falls inside the campaign window. */
export function eventBookings(ev, window, sheets) {
  const index = ev.kind === 'course' ? sheets.idxCourse : sheets.idxWorkshop;
  let n = 0;
  let revenue = 0;
  for (const a of eventAttendees(ev, sheets)) {
    const t = latestBefore(index, a.client_name, ev.date);
    if (t && inWindow(t.date, window)) { n += 1; revenue += t.amount; }
  }
  return { bookings: n, revenue: Math.round(revenue) };
}
/** Non-JLR sales (redemptions excluded) in the window, optionally only some Booking Sheet categories. */
export function windowSales(txns, window, cats) {
  let n = 0;
  let revenue = 0;
  for (const t of txns || []) {
    const d = String(t.txn_date || '').slice(0, 10);
    if (t.is_jlr || Number(t.category_order) === 9 || !inWindow(d, window)) continue;
    if (cats?.length && !cats.includes(Number(t.category_order))) continue;
    n += 1;
    revenue += Number(t.amount) || 0;
  }
  return { bookings: n, revenue: Math.round(revenue) };
}
export function taggedSessions(rows, window, channels) {
  const pairs = channels.map((c) => `${UTM[c].source}|${UTM[c].medium}`);
  return (rows || []).filter((r) => inWindow(String(r.date).slice(0, 10), window) && pairs.includes(`${String(r.source).toLowerCase()}|${String(r.medium).toLowerCase()}`))
    .reduce((s, r) => s + (Number(r.sessions) || 0), 0);
}

const NOT_AVAILABLE = {
  enquiries: 'not measured: no per-campaign enquiry source (GA4 enquiry events are only synced site-wide for 28 days)',
  email_stats: 'not available: Squarespace has no API for email campaign bounces / unsubscribes'
};
function resultsFor(rec, ctx) {
  const w = { start: rec.window_start, end: rec.window_end };
  let sales;
  let channels;
  if (rec.kind === 'event' && rec.event) { sales = eventBookings(rec.event, w, ctx.sheets); channels = EVENT_CHANNELS; }
  else if (rec.kind === 'weekly_email') { sales = windowSales(ctx.txns, w); channels = ['email']; }
  else { sales = windowSales(ctx.txns, w, rec.categories); channels = Object.keys(UTM); }
  return {
    ...sales,
    sales_basis: rec.kind === 'event' ? 'inferred: places on this event booked inside the window (Booking Sheet)' : 'inferred: Booking Sheet sales dated inside the window',
    sessions: taggedSessions(ctx.ga4, w, channels),
    sessions_basis: `measured: GA4 sessions tagged ${channels.map((c) => `${UTM[c].source}/${UTM[c].medium}`).join(', ')} in the window (shared by campaigns on the same channel)`,
    ...NOT_AVAILABLE
  };
}

/* ---------- records ---------- */

function stageOf(row) {
  return { stage: row?.stage || 'proposed', stage_history: row?.stage_history || [], set_by: row?.set_by || null, stored: !!row };
}
function emailRecords(weeks, themes) {
  return weeks.map((w) => {
    const step = w.steps.find((s) => s.is_email);
    const day = step?.day || w.week;
    const window = { window_start: day, window_end: addDays(day, 6) };
    const live = themes.filter((t) => t.window_start <= window.window_end && (!t.window_end || t.window_end >= day));
    return {
      campaign_key: `email|${w.week}`, kind: 'weekly_email', title: `Weekly email w/c ${w.week}`, ...window,
      send_day: day, utm_campaign: `weekly-email-${w.week}`,
      steps: step ? [{ key: step.key, day: step.day, channel: step.channel }] : [],
      covers: step?.covers || [],
      modules: [...(step?.featured || []).map((f) => `${f.stage || f.moment}: ${f.name || f.title} ${f.when || ''}`.trim()), ...live.map((t) => `Theme: ${t.title}`), ...(/Light & Logic/.test(step?.step || '') ? ['Light & Logic (folded in)'] : [])]
    };
  });
}
function eventRecords(weeks, moments, leadTimes) {
  const byEvent = new Map();
  const horizon = weeks.length ? addDays(weeks[weeks.length - 1].week, 6) : null;
  for (const m of moments) if (horizon && m.week <= horizon) (byEvent.get(m.event.event_key) || byEvent.set(m.event.event_key, []).get(m.event.event_key)).push(m);
  const steps = weeks.flatMap((w) => w.steps);
  return [...byEvent.entries()].map(([key, ms]) => {
    const ev = ms[0].event;
    const keys = new Set(ms.map((m) => m.key));
    const lt = leadTimes[ev.kind]?.announce_weeks || 4;
    return {
      campaign_key: `event|${key}`, kind: 'event', title: ev.title, event_key: key, event: ev, offer: ev.offer,
      window_start: addDays(ev.date, -7 * lt), window_end: ev.date, utm_campaign: `ev-${ev.date}-${slug(ev.title)}`,
      steps: steps.filter((s) => s.covers.some((k) => keys.has(k))).map((s) => ({ key: s.key, day: s.day, channel: s.channel }))
    };
  });
}
function storedOnly(rows, seen, events) {
  const byKey = new Map(events.map((e) => [e.event_key, e]));
  return rows.filter((r) => !seen.has(r.campaign_key)).map((r) => {
    const [date] = String(r.event_key || '').split('|');
    const ev = byKey.get(r.event_key) || (r.kind === 'event' ? { date, title: r.title, kind: 'day', event_key: r.event_key } : null);
    return {
      campaign_key: r.campaign_key, kind: r.kind, title: r.title, event_key: r.event_key, event: ev,
      window_start: r.window_start ? String(r.window_start).slice(0, 10) : null, window_end: r.window_end ? String(r.window_end).slice(0, 10) : null,
      categories: r.categories || [], utm_campaign: r.kind === 'theme' ? `theme-${slug(r.title)}` : (r.kind === 'weekly_email' ? `weekly-email-${String(r.campaign_key).split('|')[1]}` : `ev-${slug(r.title)}`),
      steps: []
    };
  });
}

/** Every campaign record (this view's weeks + stored themes and past records), with stage and results. */
export function buildCampaignRecords({ weeks, moments, events, leadTimes, rows, txns, sheets, ga4 }) {
  const byKey = new Map((rows || []).map((r) => [r.campaign_key, r]));
  const themes = (rows || []).filter((r) => r.kind === 'theme' && r.stage !== 'cancelled')
    .map((r) => ({ title: r.title, window_start: String(r.window_start || '').slice(0, 10), window_end: r.window_end ? String(r.window_end).slice(0, 10) : null }));
  const derived = [...emailRecords(weeks, themes), ...eventRecords(weeks, moments, leadTimes)];
  const seen = new Set(derived.map((r) => r.campaign_key));
  const all = [...derived, ...storedOnly(rows || [], seen, events)];
  const ctx = { txns, sheets, ga4 };
  return all.map((r) => ({ ...r, ...stageOf(byKey.get(r.campaign_key)), results: r.window_start && r.window_end ? resultsFor(r, ctx) : null }));
}

/** Full-list sends this month = weekly emails marked sent (or measured) whose send day is in this month × list size. */
export function sendsFromRecords(records, todayIso, rules) {
  const month = todayIso.slice(0, 7);
  const sent = records.filter((r) => r.kind === 'weekly_email' && SENT.has(r.stage) && String(r.send_day || r.window_start || '').startsWith(month)).length;
  return { emails_sent: sent, sends: sent * rules.email.list_size, cap: rules.email.monthly_cap_sends, list_size: rules.email.list_size, month, basis: 'weekly email records at stage sent / measured' };
}

export function campaignSheets(txns, courses, workshops) {
  return { courses, workshops, idxCourse: txnByClient(txns, [1]), idxWorkshop: txnByClient(txns, [2, 3]) };
}
