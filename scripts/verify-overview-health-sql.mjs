/**
 * Independent expected figures for the Marketing Overview (10 tiles) and the Client list health panel (8 Nov 2026,
 * Agent D). Reads raw Supabase tables with its own pager and computes in plain JS here — it imports NOTHING from lib/
 * (no evaluator / aggregation code). Only the email-hash RULE is restated (sha256 of trimmed lower-case email).
 *   node --env-file=.env.local scripts/verify-overview-health-sql.mjs [outFile]
 * Output: COUNTS / £ ONLY (no names or emails) → C:/TEMP/overview-health-expected.json. Read-only: no writes anywhere.
 *
 * Sources per figure:
 *   person universe   customer_person (not stale, facts.attached_to null, record_type person; admin + organisations apart)
 *   purchase band     facts.purchases (level c, not cancelled, no duplicate_of, net > 0) → latest date, calendar months
 *                     back from today (Europe/London), boundaries inclusive; none / unknown (probable-only or
 *                     history_incomplete) when no confirmed purchase. Spot-checked against sqs_orders / pnm_plans +
 *                     pnm_plan_payments / booking_sheet_transactions.
 *   consent           RAW sqs_profiles (accepts_marketing, missing_since) + marketing_suppression (unresolved, sha256)
 *   email health      RAW sqs_email_events: latest first-OPENED / first-CLICKED time per email; DELIVERED = distinct
 *                     campaigns with events_complete
 *   tile 8            sqs_send_meter latest row − strategy_campaigns.reserved_sends (campaigns not sent)
 *   tiles 1–5         live /api/aigeo/strategy-summary tiles + Booking Sheet November sanity sum
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const OUT = process.argv[2] || 'C:/TEMP/overview-health-expected.json';
const BASE = process.env.DASH_BASE || 'https://ai-geo-audit.vercel.app';
const PROPERTY = 'https://www.alanranger.com';
const MIN_DELIVERED = 3;
const DAY = 86400000;
const BANDS = ['m0_6', 'm6_12', 'm12_24', 'm24p', 'none', 'unknown'];
const COLS = ['can_email', 'not_subscribed', 'blocked', 'no_contact', 'no_email'];
const STATES = ['hot', 'warm_click', 'warm_open', 'cooling', 'cold', 'no_response', 'too_few', 'unknown'];
const MONEY_FUNDING = /^(stripe|bank|paypal|cash)$/i;

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('run with node --env-file=.env.local');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const norm = (e) => (e == null || String(e).trim() === '' ? null : String(e).trim().toLowerCase());
const hash = (e) => crypto.createHash('sha256').update(norm(e) || '').digest('hex');
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z' -]/g, ' ').replace(/\s+/g, ' ').trim();
const r2 = (v) => Math.round(v * 100) / 100;
const zero = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));
const londonDate = (v) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v));
const dayOf = (v) => (v == null ? null : (String(v).length <= 10 ? String(v) : londonDate(v)));

const TODAY = process.env.AS_OF || londonDate(Date.now());
const TODAY_MS = Date.parse(`${TODAY}T00:00:00Z`);

/** Calendar months back, clamped to month end (31 Mar − 1 month = 28/29 Feb). */
export function minusMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = y * 12 + (m - 1) - months;
  const ny = Math.floor(t / 12);
  const nm = (t % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
const CUT = { m6: minusMonths(TODAY, 6), m12: minusMonths(TODAY, 12), m24: minusMonths(TODAY, 24) };

export function bandOf(day) {
  if (day >= CUT.m6) return 'm0_6';
  if (day >= CUT.m12) return 'm6_12';
  if (day >= CUT.m24) return 'm12_24';
  return 'm24p';
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

// ---------- purchases ----------
const qualifies = (p) => !p.cancelled && !p.duplicate_of && Number(p.net) > 0;

/** Latest confirmed qualifying purchase → band; none / unknown when there's no confirmed one. */
function purchaseState(rec) {
  const list = (Array.isArray(rec.purchases) ? rec.purchases : []).filter(qualifies);
  const conf = list.filter((p) => p.level === 'c');
  const dated = conf.filter((p) => p.date).map((p) => dayOf(p.date)).sort();
  const last = dated[dated.length - 1] || null;
  const net = r2(conf.reduce((a, p) => a + Number(p.net), 0));
  const probable = list.some((p) => p.level === 'p');
  let band = last ? bandOf(last) : 'none';
  if (!last && (probable || conf.length || rec.hi === 'true')) band = 'unknown';
  const future = (Array.isArray(rec.future) ? rec.future : []).some((x) => x.level === 'c' && x.date && dayOf(x.date) >= TODAY);
  return { band, last, net, future, probable, incompleteWithEvidence: !!last && rec.hi === 'true', undatedConfirmed: !last && conf.length > 0 };
}

// ---------- consent (raw) ----------
function consentOf(email, profiles, blocked) {
  if (!email) return 'no_email';
  if (blocked.has(hash(email))) return 'blocked';
  const p = profiles.get(email);
  if (!p) return 'no_contact';
  return p.accepts_marketing && !p.missing_since ? 'can_email' : 'not_subscribed';
}

// ---------- email health (raw events) ----------
/** Per campaign keep the FIRST open / click (Squarespace stores one first-click row per URL, so per-URL max is later). */
function addEvent(stats, r, complete) {
  const e = norm(r.email);
  if (!e) return false;
  if (!stats.has(e)) stats.set(e, { delivered: new Set(), openC: new Map(), clickC: new Map(), anyClick: null });
  const s = stats.get(e);
  const t = Date.parse(r.event_at);
  const firstIn = (m) => { if (!m.has(r.email_id) || t < m.get(r.email_id)) m.set(r.email_id, t); };
  if (r.event_type === 'DELIVERED' && complete.has(r.email_id)) s.delivered.add(r.email_id);
  if (r.event_type === 'OPENED') firstIn(s.openC);
  if (r.event_type === 'CLICKED') { firstIn(s.clickC); s.anyClick = Math.max(s.anyClick ?? -Infinity, t); }
  return true;
}

const latestOf = (m, only) => { const v = [...m].filter(([id]) => !only || only.has(id)).map(([, t]) => t); return v.length ? Math.max(...v) : null; };
function finalise(stats) {
  for (const s of stats.values()) {
    s.open = latestOf(s.openC);
    s.click = latestOf(s.clickC);
    s.deliveredOnly = { delivered: s.delivered, open: latestOf(s.openC, s.delivered), click: latestOf(s.clickC, s.delivered) };
  }
  return stats;
}

async function emailStats(campaigns) {
  const complete = new Set(campaigns.filter((c) => c.events_complete).map((c) => c.email_id));
  const pages = await pool(campaigns.map((c) => c.email_id), 8, (id) => readAll('sqs_email_events', 'email_id, event_type, email, event_at', ['event_type', 'recipient_id', 'url'], (q) => q.eq('email_id', id).in('event_type', ['DELIVERED', 'OPENED', 'CLICKED'])));
  const stats = new Map();
  let rows = 0;
  let noEmail = 0;
  for (const page of pages) for (const r of page) { rows += 1; if (!addEvent(stats, r, complete)) noEmail += 1; }
  return { stats: finalise(stats), rows, noEmail, campaigns: campaigns.length, complete: complete.size };
}

/** Whole days since, as floor((today 00:00 UTC − event) / day): the existing open/click band convention. */
const daysFloor = (ms) => Math.floor((TODAY_MS - ms) / DAY);
/** Alternatives (boundary sensitivity only): London calendar-date difference; exact fractional days from now. */
const daysCal = (ms) => Math.round((TODAY_MS - Date.parse(`${londonDate(ms)}T00:00:00Z`)) / DAY);
const daysExact = (ms) => (Date.now() - ms) / DAY;

const latestResponse = (s) => { const v = [s?.open, s?.click].filter((t) => t != null); return v.length ? Math.max(...v) : null; };
const within = (t, d, days) => t != null && days(t) <= d;

/** Hot / warm / cooling / cold from the latest known responses (null when there is none). */
function responseState(s, days) {
  if (within(s.click, 30, days)) return 'hot';
  if (within(s.click, 90, days)) return 'warm_click';
  if (within(s.open, 90, days)) return 'warm_open';
  const latest = latestResponse(s);
  if (latest == null) return null;
  return days(latest) <= 180 ? 'cooling' : 'cold';
}

/**
 * Email health v2 coverage: when every uncollected campaign was sent in the last 48 h, cold / no recorded response are
 * judged over the fully collected campaigns; an older gap makes those negative states Unknown. Set after load().
 */
const COVERAGE = { ok: true };
const NEGATIVE = new Set(['cold', 'no_response']);

export function healthOf(s, days = daysCal) {
  if (!s) return 'unknown';
  const r = responseState(s, days);
  if (r) return NEGATIVE.has(r) && !COVERAGE.ok ? 'unknown' : r;
  if (s.delivered.size >= MIN_DELIVERED) return COVERAGE.ok ? 'no_response' : 'unknown';
  return s.delivered.size > 0 ? 'too_few' : 'unknown';
}
const respondedWithin = (s, d) => !!s && within(latestResponse(s), d, daysCal);
const clickedWithin = (s, d) => !!s && within(s.click, d, daysCal);

// ---------- loading ----------
const PERSON_COLS = 'person_id, email, display_name, rt:facts->>record_type, stale:facts->>stale, att:facts->>attached_to, admin:facts->>admin, owner:facts->>owner, hi:facts->>history_incomplete, subscribed:facts->>subscribed, suppressed:facts->>suppressed, shared:facts->>email_shared, purchases:facts->purchases, future:facts->future, eng:facts->engagement, vnet:facts->value->c->>net';

async function load() {
  const [persons, profiles, supp, campaigns, meter, camps, orders, plans, payments, bst, runs] = await Promise.all([
    readAll('customer_person', PERSON_COLS, ['person_id']),
    readAll('sqs_profiles', 'profile_id, email, accepts_marketing, missing_since', ['profile_id']),
    readAll('marketing_suppression', 'email_hash, resolved_at', ['email_hash']),
    readAll('sqs_email_campaigns', 'email_id, events_complete, sent_on', ['email_id']),
    sb.from('sqs_send_meter').select('captured_at, cycle_reset_at, quota_emails, used_emails, is_sending_disabled').order('captured_at', { ascending: false }).limit(1),
    readAll('strategy_campaigns', 'campaign_key, stage, reserved_sends, actual_sends, sent_on, sqs_email_id', ['campaign_key']),
    readAll('sqs_orders', 'order_id, customer_email, created_on, grand_total_gbp, refunded_total_gbp, fulfillment_status, testmode', ['order_id']),
    readAll('pnm_plans', 'plan_key, email', ['plan_key']),
    readAll('pnm_plan_payments', 'plan_key, line_no, amount, paid_on, scheduled_only', ['plan_key', 'line_no']),
    readAll('booking_sheet_transactions', 'year, source_workbook, source_row, txn_date, client_name, funding, amount, is_jlr, is_redemption', ['year', 'source_workbook', 'source_row'], (q) => q.eq('property_url', PROPERTY)),
    readAll('marketing_collector_runs', 'run_id, kind, status, started_at, finished_at', ['run_id'], (q) => q.gte('started_at', new Date(Date.now() - 14 * DAY).toISOString()))
  ]);
  if (meter.error) throw new Error(`sqs_send_meter: ${meter.error.message}`);
  const events = await emailStats(campaigns);
  return { persons, profiles, supp, campaigns, meter: meter.data[0] || null, camps, orders, plans, payments, bst, runs, events };
}

// ---------- matrix + cards ----------
const emptyMatrix = () => Object.fromEntries(BANDS.map((b) => [b, zero(COLS)]));

function classify(raw, profiles, blocked, stats) {
  return raw.map((rec) => {
    const email = norm(rec.email);
    const p = purchaseState(rec);
    return { rec, email, ...p, consent: consentOf(email, profiles, blocked), es: email ? stats.get(email) : null };
  });
}

function matrixOf(list) {
  const m = emptyMatrix();
  const addr = Object.fromEntries(COLS.map((c) => [c, new Set()]));
  for (const x of list) { m[x.band][x.consent] += 1; if (x.email) addr[x.consent].add(x.email); }
  const rowTotals = Object.fromEntries(BANDS.map((b) => [b, COLS.reduce((a, c) => a + m[b][c], 0)]));
  const colTotals = Object.fromEntries(COLS.map((c) => [c, BANDS.reduce((a, b) => a + m[b][c], 0)]));
  return { cells: m, row_totals: rowTotals, col_totals: colTotals, total: list.length, unique_addresses: Object.fromEntries(COLS.map((c) => [c, addr[c].size])) };
}

/** Amber cells: recent-buyer (≤ 12 months) rows outside "can email": people, known confirmed net £, booked ahead. */
function amberCells(list) {
  const out = {};
  for (const b of ['m0_6', 'm6_12']) {
    out[b] = {};
    for (const c of COLS.filter((k) => k !== 'can_email')) {
      const xs = list.filter((x) => x.band === b && x.consent === c);
      out[b][c] = { people: xs.length, net_gbp: r2(xs.reduce((a, x) => a + x.net, 0)), booked_ahead: xs.filter((x) => x.future).length };
    }
  }
  return out;
}

function healthCounts(list, days = daysCal) {
  const out = zero(STATES);
  for (const x of list) out[healthOf(x.es, days)] += 1;
  if (days !== daysCal) return { ...out, total: list.length };
  return { ...out, total: list.length, sum_check: STATES.reduce((a, k) => a + out[k], 0) === list.length };
}

function cards(people) {
  const recent = people.filter((x) => (x.band === 'm0_6' || x.band === 'm6_12') && x.consent !== 'can_email');
  const lapsed = people.filter((x) => x.band === 'm24p' && x.consent === 'can_email' && respondedWithin(x.es, 90));
  const noBuy = people.filter((x) => x.band === 'none' && x.consent === 'can_email');
  const unknown = people.filter((x) => x.band === 'unknown');
  const by = (xs, c) => xs.filter((x) => x.consent === c).length;
  const noBuyStates = healthCounts(noBuy);
  return {
    recent_buyers_not_email_eligible: { total: recent.length, not_subscribed: by(recent, 'not_subscribed'), blocked: by(recent, 'blocked'), no_email_held: by(recent, 'no_email'), email_no_squarespace_contact: by(recent, 'no_contact'), booked_ahead: recent.filter((x) => x.future).length, net_gbp: r2(recent.reduce((a, x) => a + x.net, 0)) },
    lapsed_buyers_with_recorded_engagement: { total: lapsed.length, click_supported: lapsed.filter((x) => clickedWithin(x.es, 90)).length, open_only: lapsed.filter((x) => !clickedWithin(x.es, 90)).length },
    subscribers_no_evidenced_purchase: { total: noBuy.length, engaged_90d: noBuy.filter((x) => respondedWithin(x.es, 90)).length, unresponsive: noBuyStates.no_response + noBuyStates.cold, email_unknown_or_too_few: noBuyStates.unknown + noBuyStates.too_few, health: noBuyStates },
    purchase_history_unknown: { total: unknown.length, by_consent: Object.fromEntries(COLS.map((c) => [c, by(unknown, c)])), with_probable_purchase: unknown.filter((x) => x.probable).length, confirmed_but_undated: unknown.filter((x) => x.undatedConfirmed).length }
  };
}

// ---------- tile 9 + reconciliation ----------
function tile9(d, groups, profiles, blocked) {
  const subs = d.profiles.filter((p) => norm(p.email) && p.accepts_marketing && !p.missing_since && !blocked.has(hash(p.email)));
  const subsEmails = new Set(subs.map((p) => norm(p.email)));
  const listedEmails = new Set([...groups.people, ...groups.owners, ...groups.orgs].map((x) => x.email).filter(Boolean));
  const otherRecordEmails = new Set(d.persons.filter((r) => !listed(r)).map((r) => norm(r.email)).filter(Boolean));
  const notListed = [...subsEmails].filter((e) => !listedEmails.has(e));
  const can = (xs) => xs.filter((x) => x.consent === 'can_email').length;
  const parts = { people: can(groups.people), owner: can(groups.owners), organisations: can(groups.orgs), profiles_on_unlisted_records: notListed.filter((e) => otherRecordEmails.has(e)).length, profiles_with_no_record: notListed.filter((e) => !otherRecordEmails.has(e)).length };
  const sum = Object.values(parts).reduce((a, v) => a + v, 0);
  const subscribedAll = d.profiles.filter((p) => norm(p.email) && p.accepts_marketing && !p.missing_since).length;
  return { can_be_emailed: subsEmails.size, subscribed_profiles: subscribedAll, subscribed_but_blocked: subscribedAll - subs.length, reconciliation: { ...parts, sum, reconciles: sum === subsEmails.size } };
}

const listed = (r) => !r.stale && !r.att && r.rt !== 'system';

// ---------- tile 8 ----------
function tile8(meter, camps) {
  if (!meter) return { state: 'no_meter_row' };
  const unsent = camps.filter((c) => !c.sent_on && !c.actual_sends && Number(c.reserved_sends) > 0);
  const reserved = unsent.reduce((a, c) => a + Number(c.reserved_sends), 0);
  const left = meter.quota_emails - meter.used_emails;
  const ageH = r2((Date.now() - Date.parse(meter.captured_at)) / 3600000);
  return { quota: meter.quota_emails, used: meter.used_emails, reserved, reserved_campaigns: unsent.length, left_before_reservations: left, left_after_reservations: left - reserved, captured_at: meter.captured_at, reset_at: meter.cycle_reset_at, meter_age_hours: ageH, sending_disabled: meter.is_sending_disabled };
}

// ---------- tiles 1–5 (Strategy) + tile 7 inputs ----------
const cellV = (c) => (c && typeof c === 'object' ? (c.v ?? c.text) : c);

const rowOf = (tile, re) => (tile.table?.rows || []).find((r) => re.test(String(cellV(r[0]))))?.map(cellV) || null;

function returningTile(ret) {
  const of = String(ret.comparison || '').match(/^(\d+) of (\d+)/);
  return { headline: ret.headline?.value, of: of ? [Number(of[1]), Number(of[2])] : null, returning_gbp_12m: rowOf(ret, /Returning £/), plan_payments_12m: rowOf(ret, /plan payments/) };
}

function strategyTiles(j) {
  const t = Object.fromEntries(Object.values(j.insights?.rows || {}).flat().map((x) => [x.key, x]));
  const get = (k) => t[k] || {};
  const acad = get('mix-academy');
  return {
    built_at: j.insights?.built_at || null,
    money_this_month: { title: get('money-this-month').title, ...get('money-this-month').numbers, headline: get('money-this-month').headline },
    money_next_3: { title: get('money-next-3').title, ...get('money-next-3').numbers, month_split: get('money-next-3').comparison },
    mix_returning: returningTile(get('mix-returning')),
    mix_academy: { paying: acad.headline?.value, trials: rowOf(acad, /Free trials/), new_paying: rowOf(acad, /New paying/) }
  };
}

function tile7Inputs(j, camps) {
  const open = (j.actions || []).filter((a) => !a.is_ticked && a.quarter_key === j.current_quarter);
  const waiting = open.filter((a) => a.status === 'waiting');
  const live = open.filter((a) => a.status !== 'waiting').sort((a, b) => String(a.due_week_start).localeCompare(String(b.due_week_start)));
  const late = live.filter((a) => a.due_week_start < TODAY);
  const stages = {};
  for (const c of camps) stages[c.stage || 'null'] = (stages[c.stage || 'null'] || 0) + 1;
  const next = live.find((a) => a.due_week_start >= TODAY);
  return { open_actions: open.length, waiting_on_trigger: waiting.length, waiting: waiting.map((a) => ({ label: a.label, due: a.due_week_start })), late: late.map((a) => ({ label: a.label, due: a.due_week_start })), next_due: next ? { label: next.label, due: next.due_week_start } : null, campaign_stages: stages, decision_count_note: 'decision list source is chosen by Agent B — compare to the source it names' };
}

function salesSanity(bst) {
  const nov = bst.filter((t) => t.txn_date >= `${TODAY.slice(0, 7)}-01` && t.txn_date <= TODAY);
  const sum = (xs) => r2(xs.reduce((a, t) => a + Number(t.amount), 0));
  return { month: TODAY.slice(0, 7), all_rows: sum(nov), non_jlr: sum(nov.filter((t) => !t.is_jlr)), non_jlr_non_redemption: sum(nov.filter((t) => !t.is_jlr && !t.is_redemption)), rows: nov.length };
}

function tile10Inputs(runs) {
  const latest = {};
  for (const r of runs) if (!latest[r.kind] || r.started_at > latest[r.kind].started_at) latest[r.kind] = r;
  const failing = Object.values(latest).filter((r) => r.status && !/^(ok|success|done|complete)/i.test(r.status));
  return { kinds: Object.keys(latest).length, latest_status: Object.fromEntries(Object.entries(latest).map(([k, r]) => [k, r.status])), not_ok_latest: failing.map((r) => r.kind) };
}

// ---------- data checks (facts vs raw) ----------
function consentChecks(list) {
  let subs = 0;
  let sup = 0;
  for (const x of list) {
    if ((x.rec.subscribed === 'true') !== x.rawSubscribed) subs += 1;
    if ((x.rec.suppressed != null) !== (x.consent === 'blocked')) sup += 1;
  }
  return { facts_subscribed_vs_raw_mismatch: subs, facts_suppressed_vs_raw_mismatch: sup };
}

const msOrNull = (v) => (v ? Date.parse(v) : null);

function engagementDiff(out, e, es) {
  out.compared += 1;
  if (msOrNull(e.last_open_at) !== (es?.open ?? null)) out.last_open_mismatch += 1;
  if (msOrNull(e.last_click_at) !== (es?.click ?? null)) out.last_click_mismatch += 1;
  if ((e.delivered_campaigns || 0) !== (es?.delivered.size || 0)) out.delivered_mismatch += 1;
}

function engagementChecks(list) {
  const out = { compared: 0, last_open_mismatch: 0, last_click_mismatch: 0, delivered_mismatch: 0, facts_missing_but_raw_events: 0 };
  for (const x of list.filter((p) => p.email)) {
    if (x.rec.eng) engagementDiff(out, x.rec.eng, x.es);
    else if (x.es) out.facts_missing_but_raw_events += 1;
  }
  out.note = 'facts use the campaign-level click row (url = "") on campaigns delivered to that address; state impact is in email_health.sensitivity';
  return out;
}

const keepLatest = (m, k, day) => { if (k && day && (!m.has(k) || day > m.get(k))) m.set(k, day); };
const orderQualifies = (o) => !o.testmode && o.fulfillment_status !== 'CANCELED' && Number(o.grand_total_gbp) - Number(o.refunded_total_gbp || 0) > 0;
const sheetQualifies = (t) => !t.is_redemption && MONEY_FUNDING.test(t.funding || '') && Number(t.amount) > 0;

/** A Booking Sheet sale that is the same money as a Squarespace order (±£1, 3 days) or a plan payment (±£1, 10 days). */
function sameSaleTest(d) {
  const ledger = [
    ...d.orders.filter((o) => !o.testmode).map((o) => ({ t: Date.parse(o.created_on), g: Number(o.grand_total_gbp), days: 3 })),
    ...d.payments.filter((p) => p.paid_on).map((p) => ({ t: Date.parse(p.paid_on), g: Number(p.amount), days: 10 }))
  ];
  return (row) => { const t = Date.parse(row.txn_date); return ledger.some((x) => Math.abs(x.g - Number(row.amount)) <= 1 && Math.abs(x.t - t) <= (x.days + 1) * DAY); };
}

function rawLatestMaps(d) {
  const orders = new Map();
  for (const o of d.orders.filter(orderQualifies)) keepLatest(orders, norm(o.customer_email), londonDate(o.created_on));
  const planEmail = new Map(d.plans.map((p) => [p.plan_key, norm(p.email)]));
  const plans = new Map();
  for (const p of d.payments.filter((x) => !x.scheduled_only && Number(x.amount) > 0)) keepLatest(plans, planEmail.get(p.plan_key), p.paid_on);
  const same = sameSaleTest(d);
  const sheet = new Map();
  const sheetOwn = new Map();
  for (const t of d.bst.filter(sheetQualifies)) {
    keepLatest(sheet, normName(t.client_name), t.txn_date);
    if (!same(t)) keepLatest(sheetOwn, normName(t.client_name), t.txn_date);
  }
  return { orders, plans, sheet, sheetOwn };
}

const factsLatest = (rec, srcs) => (rec.purchases || []).filter((p) => p.level === 'c' && qualifies(p) && srcs.includes(p.src) && p.date).map((p) => dayOf(p.date)).sort().pop() || null;
const near1 = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) <= DAY;

function compareDates(out, f, r) {
  if (!f && !r) return;
  if (f && r && near1(f, r)) out.equal += 1;
  else if (!f) out.raw_only += 1;
  else if (!r) out.facts_only += 1;
  else if (f > r) out.facts_later += 1;
  else out.raw_later += 1;
}

/** Latest-purchase spot-check per source: facts' confirmed dates vs the raw ledgers (± 1 day). */
function purchaseChecks(people, d) {
  const raw = rawLatestMaps(d);
  const mk = () => ({ equal: 0, facts_later: 0, raw_later: 0, facts_only: 0, raw_only: 0 });
  const out = { squarespace_by_email: mk(), plan_by_email: mk(), booking_sheet_by_name: mk() };
  for (const x of people) {
    if (x.email) compareDates(out.squarespace_by_email, factsLatest(x.rec, ['squarespace']), raw.orders.get(x.email) || null);
    if (x.email) compareDates(out.plan_by_email, factsLatest(x.rec, ['plan']), raw.plans.get(x.email) || null);
    compareDates(out.booking_sheet_by_name, factsLatest(x.rec, ['booking_sheet']), raw.sheet.get(normName(x.rec.display_name)) || null);
  }
  out.note = 'facts_only / facts_later are expected where identity joins attach other emails or name records; raw_later / raw_only would mean a missed purchase';
  return out;
}

/** People whose state changes with London calendar-day counting, or with the latest per-URL click instead. */
function sensitivity(list) {
  const perUrl = (x) => (x.es ? { ...x.es, click: x.es.anyClick } : null);
  return {
    calendar_day_counting: list.filter((x) => healthOf(x.es, daysFloor) !== healthOf(x.es, daysCal)).length,
    latest_per_url_click: list.filter((x) => healthOf(x.es) !== healthOf(perUrl(x))).length,
    only_campaigns_delivered_to_them: list.filter((x) => healthOf(x.es) !== healthOf(x.es?.deliveredOnly)).length,
    only_delivered_states: healthCounts(list.map((x) => ({ es: x.es?.deliveredOnly })))
  };
}

/** Would the raw Squarespace / plan ledgers move anyone's purchase band? (later raw date than facts' latest) */
function movesBy(people, rawOf) {
  let later = 0;
  let moved = 0;
  for (const x of people) {
    const r = rawOf(x);
    if (!r || (x.last && (r <= x.last || near1(r, x.last)))) continue;
    later += 1;
    if (!x.last || bandOf(r) !== x.band) moved += 1;
  }
  return { raw_later_than_facts_people: later, band_would_change: moved };
}

const hasSheetOn = (rec, day, test) => (rec.purchases || []).some((p) => p.src === 'booking_sheet' && p.date && near1(dayOf(p.date), day) && test(p));

function sheetBucket(x, r, others) {
  if (hasSheetOn(x.rec, r, () => true)) return 'on_this_person_probable_or_duplicate';
  const owner = others.find((o) => o !== x && hasSheetOn(o.rec, r, (p) => p.level === 'c' && qualifies(p)));
  if (owner) return owner.rec.att ? 'confirmed_on_attached_name_record' : 'confirmed_on_separate_listed_record';
  return 'unexplained';
}

/** Where a later same-name Booking Sheet sale (not the same as an order / plan payment) sits. */
function sheetExplain(people, all, raw) {
  const byName = new Map();
  for (const x of all) { const n = normName(x.rec.display_name); if (!byName.has(n)) byName.set(n, []); byName.get(n).push(x); }
  const out = { on_this_person_probable_or_duplicate: 0, confirmed_on_attached_name_record: 0, confirmed_on_separate_listed_record: 0, unexplained: 0, unexplained_band_would_change: 0 };
  for (const x of people) {
    const n = normName(x.rec.display_name);
    const r = raw.sheetOwn.get(n);
    if (!r || (x.last && (r <= x.last || near1(r, x.last)))) continue;
    const b = sheetBucket(x, r, byName.get(n) || []);
    out[b] += 1;
    if (b === 'unexplained' && (!x.last || bandOf(r) !== x.band)) out.unexplained_band_would_change += 1;
  }
  return out;
}

function bandMoves(people, all, d) {
  const raw = rawLatestMaps(d);
  return {
    squarespace_or_plan_by_email: movesBy(people, (x) => (x.email ? [raw.orders.get(x.email), raw.plans.get(x.email)].filter(Boolean).sort().pop() : null)),
    booking_sheet_by_exact_name_all_sales: movesBy(people, (x) => raw.sheet.get(normName(x.rec.display_name)) || null),
    booking_sheet_by_exact_name_not_same_as_order: { ...movesBy(people, (x) => raw.sheetOwn.get(normName(x.rec.display_name)) || null), explained: sheetExplain(people, all, raw) },
    note: 'Booking Sheet sales carry a name only: for an emailed contact they are probable (never set the band) unless joined by email / order number'
  };
}

// ---------- main ----------
/** Owner / test address: Alan's business @alanranger.com records (facts.admin) or an address flagged as his own. */
const isOwnerRec = (r) => r.admin === 'true' || r.owner === 'true';

function groupsOf(classified) {
  const live = classified.filter((x) => listed(x.rec));
  return {
    people: live.filter((x) => x.rec.rt === 'person' && !isOwnerRec(x.rec)),
    owners: live.filter((x) => isOwnerRec(x.rec)),
    orgs: live.filter((x) => x.rec.rt === 'organisation' && !isOwnerRec(x.rec)),
    excluded: { stale: classified.filter((x) => x.rec.stale).length, attached: classified.filter((x) => !x.rec.stale && x.rec.att).length, system: classified.filter((x) => !x.rec.stale && !x.rec.att && x.rec.rt === 'system').length }
  };
}

function summarise(d) {
  const profiles = new Map(d.profiles.filter((p) => norm(p.email)).map((p) => [norm(p.email), p]));
  const blocked = new Set(d.supp.filter((s) => !s.resolved_at).map((s) => s.email_hash));
  const classified = classify(d.persons, profiles, blocked, d.events.stats).map((x) => ({ ...x, rawSubscribed: !!(x.email && profiles.get(x.email)?.accepts_marketing && !profiles.get(x.email)?.missing_since) }));
  const g = groupsOf(classified);
  const panel = g.people;
  const can = (xs) => xs.filter((x) => x.consent === 'can_email');
  return {
    g, profiles, blocked, classified,
    out: {
      universe: { records: d.persons.length, people: g.people.length, owners: g.owners.length, organisations: g.orgs.length, excluded: g.excluded, people_with_email: g.people.filter((x) => x.email).length, people_shared_email: g.people.filter((x) => x.rec.shared === 'true').length, panel_universe: 'people only; owner / test addresses (admin or owner flag), organisations and system labels apart' },
      matrix_panel: matrixOf(panel),
      matrix_owners: matrixOf(g.owners),
      matrix_organisations: matrixOf(g.orgs),
      amber_cells: amberCells(panel),
      cards_panel: cards(panel),
      email_health: {
        coverage_v2: { judged_over_collected_campaigns: COVERAGE.ok, ...COVERAGE },
        can_email_panel: healthCounts(can(panel)), can_email_incl_owner_orgs: healthCounts(can([...panel, ...g.owners, ...g.orgs])),
        panel_day_variants: { london_calendar_days: healthCounts(can(panel)), floor_from_today_midnight: healthCounts(can(panel), daysFloor), exact_days_from_now: healthCounts(can(panel), daysExact) },
        sensitivity: sensitivity(can(panel))
      }
    }
  };
}

function coverage(d, g) {
  return {
    email_campaigns: d.events.campaigns, campaigns_events_complete: d.events.complete, event_rows_read: d.events.rows, event_rows_without_email: d.events.noEmail,
    people_confirmed_purchase_but_history_incomplete: g.people.filter((x) => x.incompleteWithEvidence).length,
    booking_sheet_from: d.bst.map((t) => t.txn_date).sort()[0] || null
  };
}

const d = await load();
const uncollected = d.campaigns.filter((c) => !c.events_complete);
COVERAGE.ok = uncollected.every((c) => c.sent_on && Date.now() - Date.parse(c.sent_on) <= 48 * 3600000);
COVERAGE.uncollected_campaigns = uncollected.length;
COVERAGE.last_collected = d.campaigns.filter((c) => c.events_complete).map((c) => c.sent_on).sort().pop() || null;
const s = summarise(d);
const strat = await fetch(`${BASE}/api/aigeo/strategy-summary?propertyUrl=${encodeURIComponent(PROPERTY)}`).then((r) => r.json());
const result = {
  generated_at: new Date().toISOString(), as_of: TODAY, cutoffs: CUT, min_delivered: MIN_DELIVERED,
  columns: COLS, bands: BANDS, email_states: STATES,
  ...s.out,
  tile9: tile9(d, s.g, s.profiles, s.blocked),
  tile8: tile8(d.meter, d.camps),
  strategy: strategyTiles(strat),
  tile7_inputs: tile7Inputs(strat, d.camps),
  tile10_inputs: tile10Inputs(d.runs),
  sales_sanity: salesSanity(d.bst),
  coverage: coverage(d, s.g),
  data_checks: { consent: consentChecks([...s.g.people, ...s.g.owners, ...s.g.orgs]), engagement: engagementChecks(s.g.people), purchases: purchaseChecks(s.g.people, d), purchase_band_moves: bandMoves(s.g.people, s.classified, d) }
};
result.strategy_vs_sales = { money_this_month_sales: result.strategy.money_this_month.sales, booking_sheet_month_all: result.sales_sanity.all_rows, booking_sheet_month_non_jlr: result.sales_sanity.non_jlr };
fs.mkdirSync(OUT.replace(/[\\/][^\\/]+$/, ''), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));

const mp = result.matrix_panel;
console.log(`as of ${TODAY} · cut-offs 6m ${CUT.m6} · 12m ${CUT.m12} · 24m ${CUT.m24}`);
console.log(`people ${result.universe.people} · owner addresses ${result.universe.owners} · organisations ${result.universe.organisations} · excluded ${JSON.stringify(result.universe.excluded)}`);
console.log(`matrix = people only (owners, organisations, system labels apart) · email coverage v2 ${JSON.stringify(result.email_health.coverage_v2)}`);
console.log(['band'.padEnd(9), ...COLS.map((c) => c.padStart(15)), 'total'.padStart(7)].join(''));
for (const b of BANDS) console.log([b.padEnd(9), ...COLS.map((c) => String(mp.cells[b][c]).padStart(15)), String(mp.row_totals[b]).padStart(7)].join(''));
console.log(['total'.padEnd(9), ...COLS.map((c) => String(mp.col_totals[c]).padStart(15)), String(mp.total).padStart(7)].join(''));
console.log('tile 9', JSON.stringify(result.tile9));
console.log('cards (panel)', JSON.stringify(result.cards_panel, (k, v) => (k === 'health' ? undefined : v)));
console.log('email health (can-email panel)', JSON.stringify(result.email_health.can_email_panel), 'sensitivity', JSON.stringify(result.email_health.sensitivity, (k, v) => (k === 'only_delivered_states' ? undefined : v)));
console.log('email health day variants', JSON.stringify(result.email_health.panel_day_variants));
console.log('tile 8', JSON.stringify(result.tile8));
console.log('strategy', JSON.stringify(result.strategy));
console.log('tile 7 inputs', JSON.stringify(result.tile7_inputs));
console.log('sales sanity', JSON.stringify(result.sales_sanity));
console.log('data checks', JSON.stringify(result.data_checks));
console.log(`wrote ${OUT}`);
