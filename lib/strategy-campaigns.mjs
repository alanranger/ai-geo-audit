/**
 * Strategy & Actions campaign layer.
 * Overrides: public.strategy_event_overrides (per event: dont_promote / weekly until the date / offer note). Rows are
 *   ignored once the event date has passed; an offer note is ignored after its end date.
 * Campaign records: one weekly email per week, one per promoted event, plus theme campaigns Alan adds. Stages live in
 *   public.strategy_campaigns (a derived record gets a row only once its stage is moved).
 * Results: Booking Sheet bookings / revenue in the campaign window (inferred: booking date in window, not a click),
 *   GA4 sessions from the campaign's tagged source / medium (measured, but GA4 sync has no campaign-name dimension, so
 *   overlapping campaigns on the same channel share those sessions). Enquiries and email bounces are not available.
 * Auto send link: a weekly email with no linked send whose step matches exactly one sent Squarespace campaign to its
 *   chosen audience (lib/strategy-step-status.mjs) carries it as sqs_email_id with link_source 'auto' and stage 'sent'
 *   (stage_source 'auto'); nothing is stored, and auto-sent records are left out of the sends counter.
 * Sent audience: strategy_campaigns.sent_audience freezes the list names + count at link time and the DELIVERED
 *   recipients' person ids once the collector has the events (write-once: a trigger keeps existing keys).
 */
import { themeMatchesTitle } from './squarespace-events-feed.mjs';
import { matchEmail } from './strategy-step-status.mjs';

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
/** The client's latest booking day on or before the event; several payments that day (e.g. two parts) are summed. */
function latestBefore(index, client, eventIso) {
  const list = (index.get(norm(client)) || []).filter((t) => t.date <= eventIso);
  if (!list.length) return null;
  const date = list[list.length - 1].date;
  return { date, amount: list.filter((t) => t.date === date).reduce((s, t) => s + t.amount, 0) };
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

const NOT_AVAILABLE = { enquiries: 'not measured: no per-campaign enquiry source (GA4 enquiry events are only synced site-wide for 28 days)' };
const MEASURE = 'Before send = booked in the window before the first evidenced send. After send = booked from the send day to the end of the window: assisted, inferred from dates (no booking carries a campaign tag). Outside = places on the event booked outside the window.';

export async function loadSqsCampaigns(supabase) {
  const { data, error } = await supabase.from('sqs_email_campaigns').select('email_id, subject, sent_on, message_count, delivered, opened, clicked, unsubscribed, mailing_list_names, campaign_key').order('sent_on', { ascending: false }).limit(80);
  if (error) throw new Error(error.message);
  return (data || []).map((c) => ({ ...c, sent_at: c.sent_on || null, sent_on: String(c.sent_on || '').slice(0, 10) }));
}

/** First evidenced send: the linked Squarespace campaign, else the day the record was moved to "sent". */
export function sendDateOf(row, sqsById) {
  if (row?.sent_on) return String(row.sent_on).slice(0, 10);
  const linked = row?.sqs_email_id ? sqsById.get(row.sqs_email_id) : null;
  if (linked) return linked.sent_on;
  const h = (row?.stage_history || []).find((x) => x.stage === 'sent');
  return h ? String(h.at).slice(0, 10) : null;
}

const range = (start, end) => ({ start, end });
const empty = { bookings: 0, revenue: 0 };
function salesIn(rec, ctx, w) {
  if (!w.start || !w.end || w.start > w.end) return empty;
  if (rec.kind === 'event' && rec.event) return eventBookings(rec.event, w, ctx.sheets);
  return windowSales(ctx.txns, w, rec.kind === 'weekly_email' ? undefined : rec.categories);
}
/** Places on the event booked before the window opened (they can't be this campaign's). */
function outsideWindow(rec, ctx) {
  if (rec.kind !== 'event' || !rec.event) return null;
  return eventBookings(rec.event, range('1900-01-01', addDays(rec.window_start, -1)), ctx.sheets);
}
function emailStats(row, sqsById) {
  const c = row?.sqs_email_id ? sqsById.get(row.sqs_email_id) : null;
  return c ? { subject: c.subject, sent_on: c.sent_on, delivered: c.delivered, opened: c.opened, clicked: c.clicked, unsubscribed: c.unsubscribed } : null;
}
function channelsOf(rec) {
  if (rec.kind === 'event') return EVENT_CHANNELS;
  return rec.kind === 'weekly_email' ? ['email'] : Object.keys(UTM);
}

/** Results split by the first send: nothing is a "result" before a campaign is sent. */
function resultsFor(rec, ctx, row) {
  const sent = sendDateOf(row, ctx.sqsById);
  const end = rec.window_end < ctx.today ? rec.window_end : ctx.today;
  const channels = channelsOf(rec);
  const base = { sent_on: sent, measure: MEASURE, outside: outsideWindow(rec, ctx), email: emailStats(row, ctx.sqsById), ...NOT_AVAILABLE,
    sessions: sent ? taggedSessions(ctx.ga4, range(sent, rec.window_end), channels) : 0,
    sessions_basis: `measured: GA4 sessions tagged ${channels.map((c) => `${UTM[c].source}/${UTM[c].medium}`).join(', ')} from the send day (shared by campaigns on the same channel)` };
  if (!sent) return { ...base, status: 'not_sent', before: salesIn(rec, ctx, range(rec.window_start, end)), after: null };
  return { ...base, status: 'sent', before: salesIn(rec, ctx, range(rec.window_start, addDays(sent, -1))), after: salesIn(rec, ctx, range(sent, rec.window_end)) };
}

/** Squarespace campaigns sent inside a weekly email's window that aren't linked to any record yet (send evidence to link). */
function sendCandidates(rec, rows, sqs) {
  if (rec.kind !== 'weekly_email') return [];
  const linked = new Set((rows || []).map((r) => r.sqs_email_id).filter(Boolean));
  return sqs.filter((c) => !linked.has(c.email_id) && c.sent_on >= rec.window_start && c.sent_on <= rec.window_end).map((c) => ({ email_id: c.email_id, subject: c.subject, sent_on: c.sent_on }));
}

/* ---------- records ---------- */

const RECORD_DEFAULTS = { stage: 'proposed', stage_history: [], set_by: null, audience: null, segment_ids: [], sqs_email_id: null, export_id: null, results_snapshot: null };
function stageOf(row) {
  const out = { stored: !!row };
  for (const [k, d] of Object.entries(RECORD_DEFAULTS)) out[k] = row?.[k] ?? d;
  return out;
}
const COVERING = new Set(['drafted', 'verified', 'approved', 'scheduled', 'sent', 'measured']);
const mondayOfDay = (d) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
const sendDayOf = (r) => String(r.planned_send_on || r.scheduled_for || r.sent_on || '').slice(0, 10) || null;
/**
 * The generator's "Main email of the week" is a placeholder. When a stored campaign (any kind but weekly_email, e.g.
 * GPT's theme|gpt-8w-*) is drafted, scheduled or sent for a day in that week, the placeholder is covered by it:
 * `covered_by` lists those campaign keys (display rule only: the step and every record stay as they are).
 */
export function markCoveredEmailSteps(weeks, rows) {
  const real = (rows || []).filter((r) => r.kind !== 'weekly_email' && COVERING.has(r.stage) && sendDayOf(r));
  for (const w of weeks || []) {
    const step = (w.steps || []).find((s) => s.is_email);
    const keys = real.filter((r) => mondayOfDay(sendDayOf(r)) === w.week).map((r) => r.campaign_key);
    if (step && keys.length) step.covered_by = keys;
  }
  return weeks;
}
function emailRecords(weeks, themes) {
  return weeks.map((w) => {
    const step = w.steps.find((s) => s.is_email);
    const day = step?.day || w.week;
    const window = { window_start: day, window_end: addDays(day, 6) };
    const live = themes.filter((t) => t.window_start <= window.window_end && (!t.window_end || t.window_end >= day));
    return {
      campaign_key: `email|${w.week}`, kind: 'weekly_email', title: `Weekly email w/c ${w.week}`, ...window,
      send_day: day, utm_campaign: `weekly-email-${w.week}`, covered_by: step?.covered_by || null,
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

/** Which records a Squarespace email is linked to; linked to any other record = not evidence for this one. */
export function emailLinks(rows) {
  const keysBy = new Map();
  for (const r of rows || []) if (r.sqs_email_id) (keysBy.get(r.sqs_email_id) || keysBy.set(r.sqs_email_id, new Set()).get(r.sqs_email_id)).add(r.campaign_key);
  const linkedTo = new Map([...keysBy].map(([id, ks]) => [id, [...ks][0]]));
  return { linkedTo, linkedElsewhere: (id, key) => [...(keysBy.get(id) || [])].some((k) => k !== key) };
}
const PRE_SENT = new Set(['proposed', 'drafted', 'verified', 'approved', 'scheduled']);
/** Weekly email with no send linked: the Squarespace matches for its step (one = linked automatically, not stored). */
function autoLink(r, row, ctx) {
  const step = r.kind === 'weekly_email' && !row?.sqs_email_id ? ctx.emailSteps.get(String(r.campaign_key).split('|')[1]) : null;
  if (!step) return { fields: {}, row };
  const matches = matchEmail({ ...step, week: String(r.campaign_key).split('|')[1] }, { ...r, ...stageOf(row) }, ctx.match);
  if (matches.length !== 1) return { fields: { auto_matches: matches }, row };
  const m = matches[0];
  const stage = PRE_SENT.has(row?.stage || 'proposed') ? { stage: 'sent', stage_source: 'auto' } : {};
  return { fields: { auto_matches: matches, sqs_email_id: m.email_id, link_source: 'auto', auto_link: m, ...stage }, row: { ...(row || {}), sqs_email_id: m.email_id, sent_on: m.sent_on } };
}

/** Counts from the frozen sent audience (person ids stay in the database). */
function audienceSummary(row) {
  const a = row?.sent_audience;
  if (!a?.list) return null;
  return { list_names: a.list.list_names, sends: a.list.sends, sent_at: a.list.sent_at, recipients: a.recipients ? { count: a.recipients.count, matched_people: a.recipients.person_ids?.length ?? 0, unmatched: a.recipients.unmatched, captured_at: a.recipients.captured_at } : null };
}
/** Every campaign record (this view's weeks + stored themes and past records), with stage and results. */
export function buildCampaignRecords({ weeks, moments, events, leadTimes, rows, txns, sheets, ga4, sqs = [], audience = null, ticks = {}, today = new Date().toISOString().slice(0, 10) }) {
  const byKey = new Map((rows || []).map((r) => [r.campaign_key, r]));
  const themes = (rows || []).filter((r) => r.kind === 'theme' && r.stage !== 'cancelled')
    .map((r) => ({ title: r.title, window_start: String(r.window_start || '').slice(0, 10), window_end: r.window_end ? String(r.window_end).slice(0, 10) : null }));
  const derived = [...emailRecords(weeks, themes), ...eventRecords(weeks, moments, leadTimes)];
  const seen = new Set(derived.map((r) => r.campaign_key));
  const all = [...derived, ...storedOnly(rows || [], seen, events)];
  const emailSteps = new Map(weeks.map((w) => [w.week, w.steps.find((s) => s.is_email)]).filter(([, s]) => s));
  const ctx = { txns, sheets, ga4, today, emailSteps, sqsById: new Map(sqs.map((c) => [c.email_id, c])), match: { sqs, audience, ticks, ...emailLinks(rows) } };
  return all.map((r) => {
    const { fields, row } = autoLink(r, byKey.get(r.campaign_key), ctx);
    return { ...r, ...stageOf(byKey.get(r.campaign_key)), ...fields, sent_audience: audienceSummary(byKey.get(r.campaign_key)), results: r.window_start && r.window_end ? resultsFor(r, ctx, row) : null, send_candidates: row?.sqs_email_id ? [] : sendCandidates(r, rows, sqs) };
  });
}

/** Full-list sends this month = weekly emails marked sent (or measured) whose send day is in this month × list size. */
export function sendsFromRecords(records, todayIso, rules) {
  const month = todayIso.slice(0, 7);
  const sent = records.filter((r) => r.kind === 'weekly_email' && SENT.has(r.stage) && r.stage_source !== 'auto' && String(r.send_day || r.window_start || '').startsWith(month)).length;
  return { emails_sent: sent, sends: sent * rules.email.list_size, cap: rules.email.monthly_cap_sends, list_size: rules.email.list_size, month, basis: 'weekly email records at stage sent / measured' };
}

/* ---------- sent audience (write-once evidence) ---------- */

/** List part: what Squarespace says the send went to, and how many it was sent to. */
export function sentListPart(c, row, now) {
  return { email_id: c.email_id, list_names: c.mailing_list_names || [], sends: row?.actual_sends ?? c.message_count ?? c.delivered ?? null, sent_at: c.sent_on, captured_at: now };
}
/** Recipients part: DELIVERED recipients matched to person ids by email (ids only are stored, never emails). */
export function recipientsPart(events, persons, now) {
  const byEmail = new Map((persons || []).map((p) => [String(p.email || '').toLowerCase(), String(p.person_id)]));
  const emails = [...new Set((events || []).map((e) => String(e.email || '').toLowerCase()).filter(Boolean))];
  const ids = [...new Set(emails.map((e) => byEmail.get(e)).filter(Boolean))].sort();
  return { count: emails.length, person_ids: ids, unmatched: emails.filter((e) => !byEmail.has(e)).length, source: 'sqs_email_events DELIVERED → customer_person by email', captured_at: now };
}
async function deliveredRecipients(supabase, emailId, now) {
  const { data: ev, error } = await supabase.from('sqs_email_events').select('email').eq('email_id', emailId).eq('event_type', 'DELIVERED').limit(10000);
  if (error) throw new Error(error.message);
  const emails = [...new Set((ev || []).map((e) => String(e.email || '').toLowerCase()).filter(Boolean))];
  const persons = [];
  for (let i = 0; i < emails.length; i += 200) {
    const { data, error: e2 } = await supabase.from('customer_person').select('person_id, email').in('email', emails.slice(i, i + 200));
    if (e2) throw new Error(e2.message);
    persons.push(...(data || []));
  }
  return recipientsPart(ev, persons, now);
}
/**
 * Freeze the audience a linked send went to on its record: the list part as soon as it is linked, the recipients part
 * once the collector has the events (events_complete). Existing keys are kept (also enforced by a trigger).
 */
async function linkedSendOf(supabase, propertyUrl, campaignKey) {
  const { data: row, error } = await supabase.from('strategy_campaigns').select('sqs_email_id, actual_sends, sent_audience').eq('property_url', propertyUrl).eq('campaign_key', campaignKey).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row?.sqs_email_id) throw new Error('no sent email linked on this record');
  const { data: c, error: e2 } = await supabase.from('sqs_email_campaigns').select('email_id, sent_on, message_count, delivered, mailing_list_names, events_complete').eq('email_id', row.sqs_email_id).maybeSingle();
  if (e2 || !c) throw new Error(e2?.message || 'linked email not in the collected reports');
  return { row, c };
}
/** The parts still missing; parts already stored are kept as they are. */
async function nextAudience(supabase, prev, row, c, now) {
  const next = { list: prev.list || sentListPart(c, row, now) };
  const recipients = prev.recipients || (c.events_complete ? await deliveredRecipients(supabase, c.email_id, now) : null);
  return recipients ? { ...next, recipients } : next;
}
export async function freezeSentAudience(supabase, propertyUrl, campaignKey, now = new Date().toISOString()) {
  const { row, c } = await linkedSendOf(supabase, propertyUrl, campaignKey);
  const prev = row.sent_audience || {};
  const next = await nextAudience(supabase, prev, row, c, now);
  const changed = !prev.list || (!prev.recipients && !!next.recipients);
  if (changed) {
    const { error } = await supabase.from('strategy_campaigns').update({ sent_audience: next }).eq('property_url', propertyUrl).eq('campaign_key', campaignKey);
    if (error) throw new Error(error.message);
  }
  const r = next.recipients;
  return { table: 'strategy_campaigns', column: 'sent_audience', changed, sends: next.list.sends, recipients: r ? r.count : null, matched_people: r ? r.person_ids.length : null, waiting_for_collector: !r };
}

export function campaignSheets(txns, courses, workshops) {
  return { courses, workshops, idxCourse: txnByClient(txns, [1]), idxWorkshop: txnByClient(txns, [2, 3]) };
}
