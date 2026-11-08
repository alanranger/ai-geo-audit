/**
 * AR-social-v1 event facts record (server, read-only). One record per event, joined at read time, never copied:
 *  - editorial facts GPT approves: public.marketing_event_facts (display title, outcome, location line, inclusions,
 *    offer wording, photo path, price claims);
 *  - live facts: the event page on alanranger.com (title, start / end date and time, live price, places left, checked
 *    at), the website course feed (a course series' first session apart from later sessions) and the approved offer
 *    (public.strategy_event_overrides: code, note, end date, promote mode).
 * Missing or contradictory facts are listed, never chosen or invented. Event date is never the posting date.
 */
const SITE = 'https://www.alanranger.com';
const LONDON = 'Europe/London';
const DAY = 86400000;
const addDays = (s, n) => new Date(Date.parse(`${s}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const ukDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: LONDON });
const ukTime = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: LONDON });
const longDate = (iso, parts) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', ...parts });
const gbp = (v) => `£${Number(v).toLocaleString('en-GB')}`;

/* ---------- live event page ---------- */

/** First £ price, places left and sold-out from an event page's text. */
export function pageFacts(item) {
  const html = `${item?.excerpt || ''}\n${item?.body || ''}`.replace(/<[^>]+>/g, ' ');
  const price = html.match(/£\s?([\d,]+(?:\.\d\d)?)/);
  const left = html.match(/Only\s+(\d+)\s+available/i);
  return { price: price ? Number(price[1].replace(/,/g, '')) : null, places_left: left ? Number(left[1]) : (/sold\s*out/i.test(html) ? 0 : null), sold_out: /sold\s*out/i.test(html) };
}
export function liveOf(item, checkedAt) {
  if (!item?.startDate) return { found: false, checked_at: checkedAt };
  const end = item.endDate || item.startDate;
  return {
    found: true, checked_at: checkedAt, title: item.title || null, url: item.fullUrl || null,
    start: ukDay(item.startDate), end: ukDay(end), start_time: ukTime(item.startDate), end_time: ukTime(end), ...pageFacts(item)
  };
}
export async function fetchLive(eventUrl, fetchFn = fetch, now = new Date().toISOString()) {
  try {
    const r = await fetchFn(`${SITE}${eventUrl}?format=json`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return { found: false, checked_at: now, error: `event page ${r.status}` };
    return liveOf((await r.json())?.item, now);
  } catch (e) {
    return { found: false, checked_at: now, error: String(e?.message || e).slice(0, 120) };
  }
}

/* ---------- course series (first session ≠ later sessions) ---------- */

const familyOf = (t) => String(t || '').split(/\s+-\s*week\s*\d/i)[0].trim().toLowerCase();
const weekLabel = (t) => Number((String(t || '').match(/week\s*(\d+)\s*of\s*\d+/i) || [])[1] || 0);
const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
/** Sessions chained by family + weekday + 7-day gaps; mislabels flagged (never corrected). */
export function courseChains(courses) {
  const groups = new Map();
  for (const c of [...(courses || [])].sort((a, b) => a.date.localeCompare(b.date))) {
    const k = `${familyOf(c.title)}|${weekday(c.date)}`;
    const list = groups.get(k) || groups.set(k, []).get(k);
    const last = list.at(-1);
    if (!last || addDays(last.at(-1).date, 7) !== c.date) list.push([c]); else last.push(c);
  }
  const chains = [...groups.values()].flat().map((s) => ({ start: s[0].date, sessions: s }));
  return { chains, flags: chains.flatMap(chainFlags) };
}
function chainFlags(ch) {
  return ch.sessions.flatMap((c, i) => {
    const out = [];
    const said = weekLabel(c.title);
    if (said && said !== i + 1) out.push(`${longDate(c.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} is session ${i + 1} of the ${longDate(ch.start, { day: 'numeric', month: 'short' })} course but its title says "Week ${said}"`);
    if (i > 0 && /week-?1\b|wk1\b/i.test(String(c.url || ''))) out.push(`${longDate(c.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} is session ${i + 1} of the ${longDate(ch.start, { day: 'numeric', month: 'short' })} course but its URL says week 1 (${c.url}); never promote it as a start`);
    return out.map((text) => ({ level: 'contradiction', text, date: c.date }));
  });
}
const chainFor = (chains, url, date) => chains.find((ch) => ch.sessions.some((c) => c.date === date && (!url || c.url === url))) || null;

/* ---------- the record ---------- */

/** "20–22 November 2026", "28 December 2026 – 2 January 2027", series "13, 20 & 27 January 2027". */
export function datesText(start, end, sessions) {
  if (sessions?.length > 1 && sessions.every((s) => s.date.slice(0, 7) === sessions[0].date.slice(0, 7))) {
    const days = sessions.map((s) => Number(s.date.slice(8)));
    return `${days.slice(0, -1).join(', ')} & ${days.at(-1)} ${longDate(start, { month: 'long', year: 'numeric' })}`;
  }
  if (!end || end === start) return longDate(start, { day: 'numeric', month: 'long', year: 'numeric' });
  if (start.slice(0, 7) === end.slice(0, 7)) return `${Number(start.slice(8))}–${longDate(end, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  return `${longDate(start, { day: 'numeric', month: 'long', year: 'numeric' })} – ${longDate(end, { day: 'numeric', month: 'long', year: 'numeric' })}`;
}
const MISSING = [
  ['booking URL', (r) => r.booking_url], ['title', (r, l) => r.display_title || l.title], ['event dates with year', (r, l) => l.found],
  ['local times', (r, l) => l.start_time && l.start_time !== '00:00'], ['location', (r) => r.location_text], ['outcome', (r) => r.outcome],
  ['inclusions', (r) => r.inclusions], ['normal price', (r, l) => l.price != null], ['availability (checked)', (r, l) => l.places_left != null || l.sold_out],
  ['original photo', (r) => r.photo_path]
];
function priceCheck(row, live) {
  const claims = (row.price_claims || []).filter((c) => c && c.gbp != null);
  if (!claims.length || live.price == null || claims.every((c) => Number(c.gbp) === live.price)) return [];
  return [`Price: live page ${gbp(live.price)} · ${claims.map((c) => `${c.source} ${gbp(c.gbp)}`).join(' · ')}. These differ: not chosen, confirm with Alan before price artwork.`];
}
function offerCheck(row, ov, todayIso) {
  const out = [];
  if (row.code && ov?.offer_code && row.code !== ov.offer_code) out.push(`Offer code: facts say ${row.code}, the approved offer says ${ov.offer_code}.`);
  if (row.code && !ov?.offer_code) out.push(`Offer code ${row.code} has no approved offer on the event (strategy_event_overrides).`);
  if (ov?.offer_ends && String(ov.offer_ends).slice(0, 10) < todayIso) out.push(`Offer ended ${String(ov.offer_ends).slice(0, 10)}: stop offer reminders.`);
  return out;
}
function seriesCheck(row, live, chain, isCourse) {
  if (!isCourse) return [];
  if (!chain) return [`${row.event_date}: not found in the website course feed, so the series can't be confirmed (on hold until reconciled).`];
  return chain.start === row.event_date ? [] : [`${row.event_date} is not a series start: it is session ${chain.sessions.findIndex((c) => c.date === row.event_date) + 1} of the ${chain.start} course.`];
}
function statusCheck(live, ov) {
  const out = [];
  if (!live.found) out.push(`Event page not readable${live.error ? ` (${live.error})` : ''}: dates, price and availability unverified.`);
  if (live.sold_out || live.places_left === 0) out.push('Sold out: stop sales reminders.');
  if (ov?.promote_mode === 'dont_promote') out.push('Set to "don\'t promote": no selling posts.');
  return out;
}

function seriesOf(row, chains) {
  if (!/beginners-photography-lessons/.test(row.event_url)) return { isCourse: false, chain: null, sessions: null };
  const chain = chainFor(chains, row.event_url, row.event_date) || chainFor(chains, null, row.event_date);
  return { isCourse: true, chain, sessions: chain ? chain.sessions.map((c, i) => ({ date: c.date, session: i + 1, title: c.title })) : null };
}
/** Dates / times from the live page (the event date, never the posting date). */
function whenOf(row, live, sessions) {
  const start = live.found ? live.start : String(row.event_date).slice(0, 10);
  if (!live.found) return { start, end: null, start_time: null, end_time: null, dates_text: null };
  return { start, end: live.end, start_time: live.start_time, end_time: live.end_time, dates_text: datesText(start, live.end, sessions && sessions[0].date === start ? sessions : null) };
}
const approvedOf = (ov) => (ov ? { code: ov.offer_code || null, note: ov.offer_note || null, ends: ov.offer_ends || null } : null);

/** One facts record: editorial row + live page + approved offer + course series, with missing / contradictory facts. */
export function factsRecord(row, live, ov, chains, todayIso) {
  const { isCourse, chain, sessions } = seriesOf(row, chains);
  const contradictions = [...priceCheck(row, live), ...offerCheck(row, ov, todayIso), ...seriesCheck(row, live, chain, isCourse), ...statusCheck(live, ov)];
  const missing = MISSING.filter(([, ok]) => !ok(row, live)).map(([k]) => k);
  return {
    event_id: row.event_id, event_key: `${String(row.event_date).slice(0, 10)}|${row.event_url}`, template: row.template,
    booking_url: row.booking_url, event_url: `${SITE}${row.event_url}`, title: live.title || null, display_title: row.display_title,
    event_date: String(row.event_date).slice(0, 10), ...whenOf(row, live, sessions),
    series: sessions ? { first: sessions[0], later: sessions.slice(1) } : null,
    location: row.location_text, outcome: row.outcome, inclusions: row.inclusions,
    price: { live: live.price, claims: row.price_claims || [] }, offer: { text: row.offer_text, code: row.code, deadline: row.deadline_text, approved: approvedOf(ov) },
    availability: { places_left: live.places_left ?? null, sold_out: !!live.sold_out, checked_at: live.checked_at },
    promote_mode: ov?.promote_mode || 'normal', photo_path: row.photo_path, notes: row.notes || null,
    missing, contradictions, ready: !missing.length && !contradictions.length
  };
}

/** Event JSON for the AR-social-v1 renderer (the same fields GPT's norfolk.json / lightroom.json carry). */
export function templateEvent(rec) {
  return {
    id: rec.event_id, title: rec.display_title, subtitle: rec.outcome, dates: rec.dates_text, location: rec.location,
    inclusions: rec.inclusions, offer: rec.offer.text, code: rec.offer.code, deadline: rec.offer.deadline, photo: rec.photo_path, bookingUrl: rec.booking_url
  };
}

/* ---------- Facebook caption-link quota ---------- */

export const FB_LINK_LIMIT = 2;
const QUOTA_TEXT = /external-link monthly allowance exhausted|link quota|post-link quota/i;
/**
 * Facebook external links in captions this month. Meta exposes no quota read, so this counts our own evidence:
 * Facebook feed placements recorded with link_in_caption, and any tick evidence this month saying the allowance ran out.
 */
export function fbLinkQuota(placements, ticks, todayIso) {
  const month = todayIso.slice(0, 7);
  const links = (placements || []).filter((p) => p.placement === 'facebook_feed' && p.link_in_caption && String(p.actual_at || p.set_at || '').startsWith(month));
  const hits = (ticks || []).filter((t) => String(t.set_at || '').startsWith(month) && QUOTA_TEXT.test(`${t.reason || ''} ${JSON.stringify(t.history || [])}`));
  const used = Math.max(links.length, hits.length ? FB_LINK_LIMIT : 0);
  return {
    limit: FB_LINK_LIMIT, used, left: Math.max(0, FB_LINK_LIMIT - used), exhausted: used >= FB_LINK_LIMIT, month,
    basis: 'counted from our own evidence (Meta exposes no link-quota read)',
    evidence: hits.map((t) => ({ tick_key: t.tick_key, at: t.set_at })).slice(0, 5)
  };
}

/* ---------- loading (read-only) ---------- */

export async function loadFactsInputs(sb, propertyUrl, todayIso, deps) {
  const [facts, placements, ticks, overrides, feeds] = await Promise.all([
    sb.from('marketing_event_facts').select('*').eq('property_url', propertyUrl).order('event_date').limit(500),
    sb.from('marketing_social_placements').select('*').eq('property_url', propertyUrl).limit(2000),
    sb.from('strategy_campaign_ticks').select('tick_key, reason, history, set_at').eq('property_url', propertyUrl).gte('set_at', `${todayIso.slice(0, 7)}-01`).limit(2000),
    sb.from('strategy_event_overrides').select('event_key, offer_code, offer_note, offer_ends, promote_mode').eq('property_url', propertyUrl).limit(2000),
    deps.feeds().catch(() => ({ courses: [] }))
  ]);
  for (const r of [facts, placements, ticks, overrides]) if (r.error) throw new Error(r.error.message);
  return { facts: facts.data || [], placements: placements.data || [], ticks: ticks.data || [], overrides: new Map((overrides.data || []).map((o) => [o.event_key, o])), courses: feeds.courses || [] };
}

/** Everything the schedule's social panel needs: facts records, facts check, placements, link quota. */
export async function socialStandardView(sb, propertyUrl, { todayIso, fetchFn = fetch, feeds }) {
  const inp = await loadFactsInputs(sb, propertyUrl, todayIso, { feeds });
  const { chains, flags } = courseChains(inp.courses);
  const now = new Date().toISOString();
  const active = inp.facts.filter((r) => (r.status || 'active') === 'active');
  const withdrawn = inp.facts.filter((r) => r.status === 'withdrawn').map((r) => ({ event_id: r.event_id, event_date: String(r.event_date).slice(0, 10), notes: r.notes || null, set_at: r.set_at }));
  const lives = await Promise.all(active.map((r) => fetchLive(r.event_url, fetchFn, now)));
  const facts = active.map((r, i) => factsRecord(r, lives[i], inp.overrides.get(`${String(r.event_date).slice(0, 10)}|${r.event_url}`), chains, todayIso));
  const checks = [...facts.flatMap((f) => f.contradictions.map((text) => ({ event_id: f.event_id, level: 'contradiction', text }))), ...flags.filter((f) => f.date >= todayIso)];
  return { checked_at: now, facts, withdrawn, checks, placements: inp.placements, quota: fbLinkQuota(inp.placements, inp.ticks, todayIso) };
}
