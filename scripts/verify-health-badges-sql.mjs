/**
 * Independent expected figures for the health badges / owner-address build (8 Nov 2026, Agent D). Raw tables + plain
 * JS here; nothing imported from lib/. Counts only → C:/TEMP/health-badges-expected.json. Read-only.
 *   node --env-file=.env.local scripts/verify-health-badges-sql.mjs
 * Run scripts/verify-overview-health-sql.mjs first (its matrix_panel is used for the people-vs-owner split).
 *
 *   LR segment     stored bookings with a beginners category, none with lightroom (facts.bookings: categories are a
 *                  stored fact), ≤ 30 miles from CV4 9HW (postcode_geo_cache; haversine on facts lat/lng), can email
 *                  (RAW sqs_profiles + marketing_suppression), latest first-open (RAW sqs_email_events) on or after the
 *                  same day 6 calendar months ago (Europe/London). Owner = facts.admin or facts.owner. "No Lightroom
 *                  booking" is only a firm yes without probable Lightroom history, a cut-off list or incomplete history.
 *   inactivity     can-email people: "no" = an open or click on/after the cut-off; "yes" only when coverage is complete
 *                  and 3+ fully collected campaigns sent on/after the cut-off were delivered; otherwise undecided.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const OUT = 'C:/TEMP/health-badges-expected.json';
const OVERVIEW = 'C:/TEMP/overview-health-expected.json';
const DAY = 86400000;
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const norm = (e) => (e == null || String(e).trim() === '' ? null : String(e).trim().toLowerCase());
const hash = (e) => crypto.createHash('sha256').update(norm(e) || '').digest('hex');
const londonDate = (v) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v));
const TODAY = londonDate(Date.now());
const TODAY_MS = Date.parse(`${TODAY}T00:00:00Z`);

function minusMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = y * 12 + (m - 1) - months;
  const ny = Math.floor(t / 12);
  const nm = (t % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

async function readAll(table, cols, order, build = (q) => q) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = build(sb.from(table).select(cols));
    for (const k of order) q = q.order(k, { ascending: true });
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  const worker = async () => { while (i < items.length) { const k = i; i += 1; out[k] = await fn(items[k]); } };
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

const PERSON_COLS = 'person_id, email, rt:facts->>record_type, stale:facts->>stale, att:facts->>attached_to, admin:facts->>admin, owner:facts->>owner, hi:facts->>history_incomplete, lat:facts->lat, lng:facts->lng, bookings:facts->bookings, purchases:facts->purchases, cats:facts->cats, booking_count:facts->booking_count';

async function load() {
  const [persons, profiles, supp, campaigns, geo] = await Promise.all([
    readAll('customer_person', PERSON_COLS, ['person_id']),
    readAll('sqs_profiles', 'profile_id, email, accepts_marketing, missing_since', ['profile_id']),
    readAll('marketing_suppression', 'email_hash, resolved_at', ['email_hash']),
    readAll('sqs_email_campaigns', 'email_id, events_complete, sent_on', ['email_id']),
    sb.from('postcode_geo_cache').select('lat, lng').eq('postcode', 'CV4 9HW').single()
  ]);
  const events = await pool(campaigns.map((c) => c.email_id), 8, (id) => readAll('sqs_email_events', 'email_id, event_type, email, event_at', ['event_type', 'recipient_id', 'url'], (q) => q.eq('email_id', id).in('event_type', ['DELIVERED', 'OPENED', 'CLICKED'])));
  return { persons, profiles, supp, campaigns, centre: geo.data, events: events.flat() };
}

/** Per email: first open / click per campaign; delivered = fully collected campaigns. */
function emailStats(d) {
  const complete = new Map(d.campaigns.filter((c) => c.events_complete).map((c) => [c.email_id, londonDate(c.sent_on)]));
  const stats = new Map();
  for (const r of d.events) {
    const e = norm(r.email);
    if (!e) continue;
    if (!stats.has(e)) stats.set(e, { delivered: new Map(), open: new Map(), click: new Map() });
    const s = stats.get(e);
    const t = Date.parse(r.event_at);
    const kind = { DELIVERED: 'delivered', OPENED: 'open', CLICKED: 'click' }[r.event_type];
    if (kind === 'delivered') { if (complete.has(r.email_id)) s.delivered.set(r.email_id, complete.get(r.email_id)); continue; }
    if (!s[kind].has(r.email_id) || t < s[kind].get(r.email_id)) s[kind].set(r.email_id, t);
  }
  for (const s of stats.values()) {
    s.lastOpen = s.open.size ? Math.max(...s.open.values()) : null;
    s.lastClick = s.click.size ? Math.max(...s.click.values()) : null;
  }
  return stats;
}

function consentOf(email, profiles, blocked) {
  if (!email) return 'no_email';
  if (blocked.has(hash(email))) return 'blocked';
  const p = profiles.get(email);
  if (!p) return 'no_contact';
  return p.accepts_marketing && !p.missing_since ? 'can_email' : 'not_subscribed';
}

function miles(a, b) {
  if (a?.lat == null || b?.lat == null) return null;
  const rad = (x) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

const hasCat = (rec, cat) => (Array.isArray(rec.bookings) ? rec.bookings : []).some((b) => (b.cats || []).includes(cat));
/** "Has no Lightroom booking" can't be a confident yes with probable Lightroom history, a cut-off list or incomplete history. */
const lightroomMaybe = (rec) => Number(rec.cats?.lightroom?.p || 0) > 0 || rec.hi === 'true' || Number(rec.booking_count || 0) > (Array.isArray(rec.bookings) ? rec.bookings.length : 0);
const listed = (r) => !r.stale && !r.att && r.rt !== 'system';
const isOwner = (r) => r.admin === 'true' || r.owner === 'true';
const day = (ms) => (ms == null ? null : londonDate(ms));

function lrSegment(people, cut6) {
  const steps = { listed: people.length };
  const beg = people.filter((x) => hasCat(x.rec, 'beginners'));
  const noLr = beg.filter((x) => !hasCat(x.rec, 'lightroom'));
  const near = noLr.filter((x) => x.miles != null && x.miles <= 30);
  const can = near.filter((x) => x.consent === 'can_email');
  const opened = can.filter((x) => day(x.es?.lastOpen) >= cut6);
  const sure = opened.filter((x) => !lightroomMaybe(x.rec));
  Object.assign(steps, { beginners: beg.length, no_lightroom: noLr.length, within_30_miles: near.length, can_email: can.length, opened_within_6_months: opened.length, no_lightroom_is_certain: sure.length });
  const split = (xs) => ({ clients: xs.filter((x) => !isOwner(x.rec)).length, owner: xs.filter((x) => isOwner(x.rec)).length });
  return { steps, confirmed_only: split(opened), yes_strict: split(sure), undecided_probable_or_incomplete_history: split(opened.filter((x) => lightroomMaybe(x.rec))), organisations_in: sure.filter((x) => x.rec.rt === 'organisation').length };
}

/** Three-valued inactivity / opened-within answers for can-email records. */
function windowAnswers(xs, months, coverageComplete, sentDays) {
  const cut = minusMonths(TODAY, months);
  const out = { months, cutoff: cut, no_active_in_window: 0, yes: 0, undecided: 0, would_be_yes_if_coverage_complete: 0, opened_within_yes: 0 };
  for (const x of xs) {
    const latest = Math.max(x.es?.lastOpen ?? -Infinity, x.es?.lastClick ?? -Infinity);
    if (day(x.es?.lastOpen) >= cut) out.opened_within_yes += 1;
    if (latest > -Infinity && day(latest) >= cut) { out.no_active_in_window += 1; continue; }
    const delivered = x.es ? [...x.es.delivered.values()].filter((d) => d >= cut && sentDays.has(d)).length : 0;
    const yes = delivered >= 3;
    if (yes) out.would_be_yes_if_coverage_complete += 1;
    if (yes && coverageComplete) out.yes += 1;
    else out.undecided += 1;
  }
  return out;
}

const qualifies = (p) => !p.cancelled && !p.duplicate_of && Number(p.net) > 0;
function bandOf(rec) {
  const conf = (rec.purchases || []).filter((p) => qualifies(p) && p.level === 'c');
  const last = conf.filter((p) => p.date).map((p) => String(p.date).slice(0, 10)).sort().pop();
  if (!last) return conf.length || rec.hi === 'true' || (rec.purchases || []).some((p) => qualifies(p) && p.level === 'p') ? 'unknown' : 'none';
  if (last >= minusMonths(TODAY, 6)) return 'm0_6';
  if (last >= minusMonths(TODAY, 12)) return 'm6_12';
  return last >= minusMonths(TODAY, 24) ? 'm12_24' : 'm24p';
}

function ownerCells(owners) {
  const cells = {};
  for (const x of owners) { const k = `${bandOf(x.rec)}×${x.consent}`; cells[k] = (cells[k] || 0) + 1; }
  return cells;
}

/** Health-panel matrix (people only; owners and organisations apart) from the overview expected file. */
function clientMatrix() {
  if (!fs.existsSync(OVERVIEW)) return null;
  return { cells: JSON.parse(fs.readFileSync(OVERVIEW, 'utf8')).matrix_panel.cells, note: 'matrix_panel: people only' };
}

const d = await load();
const profiles = new Map(d.profiles.filter((p) => norm(p.email)).map((p) => [norm(p.email), p]));
const blocked = new Set(d.supp.filter((s) => !s.resolved_at).map((s) => s.email_hash));
const stats = emailStats(d);
const all = d.persons.filter(listed).map((rec) => {
  const email = norm(rec.email);
  return { rec, email, consent: consentOf(email, profiles, blocked), es: email ? stats.get(email) : null, miles: miles(d.centre, { lat: rec.lat, lng: rec.lng }) };
});
/** Email health v2: a gap made only of campaigns sent in the last 48 h is judged over the fully collected campaigns. */
const coverageComplete = d.campaigns.every((c) => c.events_complete || (c.sent_on && Date.now() - Date.parse(c.sent_on) <= 48 * 3600000));
const sentDays = new Set(d.campaigns.filter((c) => c.events_complete).map((c) => londonDate(c.sent_on)));
const owners = all.filter((x) => isOwner(x.rec));
const canPeople = all.filter((x) => x.rec.rt === 'person' && !isOwner(x.rec) && x.consent === 'can_email');
const canOrgs = all.filter((x) => x.rec.rt === 'organisation' && x.consent === 'can_email');
const result = {
  generated_at: new Date().toISOString(), as_of: TODAY,
  coverage: { campaigns: d.campaigns.length, complete: d.campaigns.filter((c) => c.events_complete).length, judged_over_collected_v2: coverageComplete },
  organisations: { records: all.filter((x) => x.rec.rt === 'organisation').length, cells: ownerCells(all.filter((x) => x.rec.rt === 'organisation' && !isOwner(x.rec))) },
  owners: { records: owners.length, admin: owners.filter((x) => x.rec.admin === 'true').length, owner_flag: owners.filter((x) => x.rec.owner === 'true').length, by_consent: owners.reduce((a, x) => ({ ...a, [x.consent]: (a[x.consent] || 0) + 1 }), {}), cells: ownerCells(owners) },
  lr_segment: lrSegment(all, minusMonths(TODAY, 6)),
  can_email: { people_not_owner: canPeople.length, owner: owners.filter((x) => x.consent === 'can_email').length, organisations: canOrgs.length },
  inactivity_6m_can_email_people: windowAnswers(canPeople, 6, coverageComplete, sentDays),
  inactivity_6m_can_email_owner: windowAnswers(owners.filter((x) => x.consent === 'can_email'), 6, coverageComplete, sentDays),
  inactivity_6m_can_email_orgs: windowAnswers(canOrgs, 6, coverageComplete, sentDays),
  client_matrix: clientMatrix()
};
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, client_matrix: result.client_matrix ? '(in file)' : null }, null, 1));
