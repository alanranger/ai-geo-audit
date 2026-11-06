/**
 * CEO weekly Section G — Profit levers scorecard (live every run).
 * Calendar months: MTD | previous full | month before.
 */
import fs from 'fs';import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_SECTION_G_CONFIG } from '../business-targets.mjs';
import { resolveGpTargetsBundle } from '../targets-master.mjs';
import { dayLabel } from './front-page.js';
import { inWorkingWeekTwo } from './sales-tab.js';

/** Mentoring reviews are manual-paste on Squarespace (Alan 2026-10-06). */
function mentoringPasteDataCheck() {
  const flagPath = path.resolve(
    process.cwd(),
    '..',
    'alan-shared-resources',
    'outputs',
    'manual-paste',
    'mentoring-paste-flag.json'
  );
  const alt = 'G:/Dropbox/alan ranger photography/Website Code/alan-shared-resources/outputs/manual-paste/mentoring-paste-flag.json';
  const file = fs.existsSync(flagPath) ? flagPath : (fs.existsSync(alt) ? alt : null);
  if (!file) return null;
  try {
    const flag = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!flag?.needsRepaste) return null;
    return flag.reason || 'Mentoring page schema needs re-paste — reviews changed';
  } catch {
    return null;
  }
}

function round1(n) { return Math.round(Number(n || 0) * 10) / 10; }
function round0(n) { return Math.round(Number(n || 0)); }
function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }
function ymd(d) { return d.toISOString().slice(0, 10); }
function pad(m) { return String(m).padStart(2, '0'); }
function monthStart(y, m) { return `${y}-${pad(m)}-01`; }
function monthEndExclusive(y, m) {
  return m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
}
function monthLabel(y, m) {
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function monthParts(asOf) {
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth() + 1;
  const day = asOf.getUTCDate();
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const prev = m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
  const prev2 = prev.month === 1 ? { year: prev.year - 1, month: 12 } : { year: prev.year, month: prev.month - 1 };
  return {
    cur: { year: y, month: m, day, daysIn, label: monthLabel(y, m) },
    prev: { ...prev, label: monthLabel(prev.year, prev.month) },
    prev2: { ...prev2, label: monthLabel(prev2.year, prev2.month) },
    asOfYmd: ymd(asOf)
  };
}
function pace(monthlyTarget, day, daysIn) {
  if (monthlyTarget == null || !daysIn) return null;
  return round1((Number(monthlyTarget) * day) / daysIn);
}
/** Rows judged on the month so far; "Events below minimum" looks 60 days ahead, so it is not one. */
const MONTH_SO_FAR_ROWS = new Set([
  'direct_sales', 'gross_profit', 'avg_clients_residential', 'existing_referral',
  'high_margin_share', 'commercial_clicks', 'bookings_per_1k'
]);

function prevJudgement(r) {
  const prev = Number(r.prev);
  const target = Number(r.target);
  if (r.prev == null || !Number.isFinite(prev) || !Number.isFinite(target)) return null;
  return prev >= target ? 'on target' : 'off target';
}

/** Same rule as every month-so-far figure: no on/off judgement until working week 2. Returns the row ids changed. */
export function applyWeekOneRule(rows, asOfYmd) {
  if (inWorkingWeekTwo(asOfYmd)) return [];
  const changed = [];
  for (const r of rows) {
    if (!MONTH_SO_FAR_ROWS.has(r.id) || r.status === 'Too early') continue;
    const prev = prevJudgement(r);
    r.status = 'Too early';
    r.detail = prev ? `Prev: ${prev}` : null;
    changed.push(r.id);
  }
  return changed;
}

function statusPace(actual, paceNow, { tooEarly = false, prevStatus = null } = {}) {
  if (tooEarly) return { status: 'Too early', detail: prevStatus ? `Prev: ${prevStatus}` : null };
  if (paceNow == null || actual == null) return { status: '—', detail: null };
  return { status: actual >= paceNow ? 'On pace' : 'Off pace', detail: null };
}

/** Full months: Σ monthly_category − JLR txns. MTD: txns incl. negatives (GV Out), excl JLR only. */
async function sumSalesExclJlr(supabase, propertyUrl, year, month, { mtdDay = null } = {}) {
  if (mtdDay == null) {
    const { data: cats, error } = await supabase
      .from('booking_sheet_monthly_category')
      .select('revenue_amount')
      .eq('property_url', propertyUrl)
      .eq('year', year)
      .eq('month', month);
    if (error) throw error;
    const catSum = (cats || []).reduce((s, r) => s + (Number(r.revenue_amount) || 0), 0);
    const jlr = await sumJlr(supabase, propertyUrl, year, month);
    return round0(catSum - jlr);
  }
  const { data, error } = await supabase
    .from('booking_sheet_transactions')
    .select('amount, txn_date, is_jlr')
    .eq('property_url', propertyUrl)
    .gte('txn_date', monthStart(year, month))
    .lt('txn_date', monthEndExclusive(year, month));
  if (error) throw error;
  let sum = 0;
  for (const r of data || []) {
    if (r.is_jlr) continue;
    const d = Number(String(r.txn_date).slice(8, 10));
    if (d > mtdDay) continue;
    sum += Number(r.amount) || 0;
  }
  return round0(sum);
}

async function sumJlr(supabase, propertyUrl, year, month) {
  const { data, error } = await supabase
    .from('booking_sheet_transactions')
    .select('amount, is_jlr')
    .eq('property_url', propertyUrl)
    .eq('is_jlr', true)
    .gte('txn_date', monthStart(year, month))
    .lt('txn_date', monthEndExclusive(year, month));
  if (error) throw error;
  return (data || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
}

async function sumGpFromCategory(supabase, propertyUrl, year, month) {
  const { data: cats, error } = await supabase
    .from('booking_sheet_monthly_category')
    .select('category_label, revenue_amount')
    .eq('property_url', propertyUrl)
    .eq('year', year)
    .eq('month', month);
  if (error) throw error;
  const { data: gps, error: gErr } = await supabase
    .from('booking_sheet_category_gp')
    .select('category_label, gp_rate')
    .eq('property_url', propertyUrl)
    .eq('year', year);
  if (gErr) throw gErr;
  const rate = new Map((gps || []).map((g) => [g.category_label, Number(g.gp_rate) || 0]));
  let gp = 0;
  for (const r of cats || []) gp += (Number(r.revenue_amount) || 0) * (rate.get(r.category_label) || 0);
  return round0(gp);
}

async function sumGp(supabase, propertyUrl, year, month, { mtdDay = null } = {}) {
  if (mtdDay == null) return sumGpFromCategory(supabase, propertyUrl, year, month);
  const sales = await sumSalesExclJlr(supabase, propertyUrl, year, month, { mtdDay });
  const fullSales = await sumSalesExclJlr(supabase, propertyUrl, year, month);
  const fullGp = await sumGpFromCategory(supabase, propertyUrl, year, month);
  if (!fullSales) return 0;
  return round0(fullGp * (sales / fullSales));
}

async function highMarginShare(supabase, propertyUrl, year, month) {
  const { data: cats } = await supabase
    .from('booking_sheet_monthly_category')
    .select('category_label, revenue_amount')
    .eq('property_url', propertyUrl)
    .eq('year', year)
    .eq('month', month);
  const { data: gps } = await supabase
    .from('booking_sheet_category_gp')
    .select('category_label, gp_rate')
    .eq('property_url', propertyUrl)
    .eq('year', year);
  const rate = new Map((gps || []).map((g) => [g.category_label, Number(g.gp_rate) || 0]));
  let total = 0;
  let hi = 0;
  for (const r of cats || []) {
    const g = (Number(r.revenue_amount) || 0) * (rate.get(r.category_label) || 0);
    total += g;
    if ((rate.get(r.category_label) || 0) >= 0.9) hi += g;
  }
  return total > 0 ? round0((hi / total) * 100) : null;
}

async function existingReferralCount(supabase, propertyUrl, year, month, { mtdDay = null } = {}) {
  const { data } = await supabase
    .from('booking_sheet_transactions')
    .select('amount, txn_date, is_jlr, booking_source')
    .eq('property_url', propertyUrl)
    .gte('txn_date', monthStart(year, month))
    .lt('txn_date', monthEndExclusive(year, month));
  let n = 0;
  for (const r of data || []) {
    if (r.is_jlr || !(Number(r.amount) > 0)) continue;
    if (!/^(Existing|Referral)$/i.test(String(r.booking_source || ''))) continue;
    const d = Number(String(r.txn_date).slice(8, 10));
    if (mtdDay != null && d > mtdDay) continue;
    n += 1;
  }
  return n;
}

async function brandClicks(supabase, propertyUrl, year, month) {
  const monthKey = monthStart(year, month);
  const { data } = await supabase
    .from('gsc_brand_query_monthly')
    .select('brand_clicks, fetched_at')
    .eq('property_url', propertyUrl)
    .eq('month', monthKey)
    .maybeSingle();
  return {
    value: data?.brand_clicks == null ? null : Number(data.brand_clicks),
    data_to: data?.fetched_at ? String(data.fetched_at).slice(0, 10) : null
  };
}

function normalisePath(u) {
  try {
    let p = u.startsWith('http') ? new URL(u).pathname : String(u || '');
    p = p.toLowerCase().replace(/\/+$/, '').replace(/^\//, '');
    return p;
  } catch {
    return String(u || '').toLowerCase().replace(/^\//, '');
  }
}

async function commercialClicks(supabase, propertyUrl, year, month, { mtdDay = null } = {}) {
  const { data: pages } = await supabase
    .from('pages_master')
    .select('path, url, tier')
    .eq('property_url', propertyUrl)
    .in('tier', ['A_landing', 'B_product', 'C_event']);
  const allow = new Set();
  for (const p of pages || []) {
    allow.add(normalisePath(p.path || ''));
    allow.add(normalisePath(p.url || ''));
  }
  const start = monthStart(year, month);
  const endCap = mtdDay != null ? `${year}-${pad(month)}-${pad(mtdDay)}` : null;
  const endEx = monthEndExclusive(year, month);
  let sum = 0;
  let maxDate = null;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('gsc_page_timeseries')
      .select('page_url, date, clicks')
      .eq('property_url', propertyUrl)
      .gte('date', start)
      .lt('date', endEx)
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data) {
      const d = String(r.date).slice(0, 10);
      if (endCap && d > endCap) continue;
      if (!allow.has(normalisePath(r.page_url))) continue;
      sum += Number(r.clicks) || 0;
      if (!maxDate || d > maxDate) maxDate = d;
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  return { value: round0(sum), data_to: maxDate };
}

async function googleBookings(supabase, propertyUrl, year, month, { mtdDay = null } = {}) {
  const { data } = await supabase
    .from('booking_sheet_transactions')
    .select('amount, txn_date, is_jlr, booking_source')
    .eq('property_url', propertyUrl)
    .gte('txn_date', monthStart(year, month))
    .lt('txn_date', monthEndExclusive(year, month));
  let n = 0;
  for (const r of data || []) {
    if (r.is_jlr || !(Number(r.amount) > 0)) continue;
    if (!/^Google$/i.test(String(r.booking_source || ''))) continue;
    const d = Number(String(r.txn_date).slice(8, 10));
    if (mtdDay != null && d > mtdDay) continue;
    n += 1;
  }
  return n;
}

async function organicEngagedSessions(supabase, propertyUrl, year, month, { mtdDay = null } = {}) {
  const start = monthStart(year, month);
  const endEx = monthEndExclusive(year, month);
  const { data, error } = await supabase
    .from('ga4_channel_sessions_daily')
    .select('date, channel_group, engaged_sessions')
    .eq('property_url', propertyUrl)
    .gte('date', start)
    .lt('date', endEx);
  if (error) throw error;
  let sum = 0;
  let maxDate = null;
  for (const r of data || []) {
    if (!/organic search/i.test(String(r.channel_group || ''))) continue;
    const d = String(r.date).slice(0, 10);
    if (mtdDay != null && Number(d.slice(8, 10)) > mtdDay) continue;
    sum += Number(r.engaged_sessions) || 0;
    if (!maxDate || d > maxDate) maxDate = d;
  }
  return { value: sum, data_to: maxDate };
}

async function aiBookingsAndVisits(supabase, propertyUrl, year, month, { mtdDay = null } = {}) {
  const { data: tx } = await supabase
    .from('booking_sheet_transactions')
    .select('amount, txn_date, is_jlr, booking_source')
    .eq('property_url', propertyUrl)
    .gte('txn_date', monthStart(year, month))
    .lt('txn_date', monthEndExclusive(year, month));
  let bookings = 0;
  for (const r of tx || []) {
    if (r.is_jlr || !(Number(r.amount) > 0)) continue;
    if (!/(chatgpt|gemini|perplexity|claude|copilot)/i.test(String(r.booking_source || ''))) continue;
    const d = Number(String(r.txn_date).slice(8, 10));
    if (mtdDay != null && d > mtdDay) continue;
    bookings += 1;
  }
  const { data: ga } = await supabase
    .from('ga4_channel_sessions_daily')
    .select('date, channel_group, sessions')
    .eq('property_url', propertyUrl)
    .gte('date', monthStart(year, month))
    .lt('date', monthEndExclusive(year, month));
  let visits = 0;
  let maxDate = null;
  for (const r of ga || []) {
    if (!/ai assistant/i.test(String(r.channel_group || ''))) continue;
    const d = String(r.date).slice(0, 10);
    if (mtdDay != null && Number(d.slice(8, 10)) > mtdDay) continue;
    visits += Number(r.sessions) || 0;
    if (!maxDate || d > maxDate) maxDate = d;
  }
  return { bookings, visits, data_to: maxDate };
}

function academyClient() {
  const url = String(process.env.ACADEMY_SUPABASE_URL || '').trim();
  const key = String(process.env.ACADEMY_SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function academyPaidConversions(year, month, { mtdDay = null } = {}) {
  const ac = academyClient();
  if (!ac) return { value: null, trials: null, error: 'academy env missing' };
  const start = monthStart(year, month);
  const endEx = monthEndExclusive(year, month);
  const { data, error } = await ac
    .from('academy_trial_history')
    .select('converted_at, trial_start_at')
    .or(`converted_at.gte.${start},trial_start_at.gte.${start}`);
  if (error) return { value: null, trials: null, error: error.message };
  let converted = 0;
  let trials = 0;
  for (const r of data || []) {
    const c = r.converted_at ? String(r.converted_at).slice(0, 10) : null;
    const t = r.trial_start_at ? String(r.trial_start_at).slice(0, 10) : null;
    if (c && c >= start && c < endEx) {
      if (mtdDay == null || Number(c.slice(8, 10)) <= mtdDay) converted += 1;
    }
    if (t && t >= start && t < endEx) {
      if (mtdDay == null || Number(t.slice(8, 10)) <= mtdDay) trials += 1;
    }
  }
  return { value: converted, trials };
}

async function rankingDataCheck(supabase, propertyUrl) {
  const { data: latest } = await supabase
    .from('keyword_rankings')
    .select('audit_date')
    .eq('property_url', propertyUrl)
    .order('audit_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  const auditDate = latest?.audit_date;
  if (!auditDate) return { ok: false, message: 'Ranking audit incomplete: no audit_date' };
  const { data: rows } = await supabase
    .from('keyword_rankings')
    .select('serp_surface_stack')
    .eq('property_url', propertyUrl)
    .eq('audit_date', auditDate);
  const n = (rows || []).length;
  const missing = (rows || []).filter((r) => r.serp_surface_stack == null).length;
  if (n && missing / n > 0.1) {
    return { ok: false, message: `Ranking audit incomplete: ${missing} of ${n} missing`, auditDate, missing, n };
  }
  return { ok: true, message: 'Ranking audit complete', auditDate, missing, n };
}

async function workshopLever(supabase, propertyUrl, asOfYmd) {
  const needs = {
    avg: { status: 'Needs data feed', value: null },
    below: { status: 'Needs data feed', spanNote: 'Needs Workshops import' }
  };
  const { data, error } = await supabase
    .from('booking_sheet_workshop_attendees')
    .select('event_start, is_multi_day')
    .eq('property_url', propertyUrl)
    .not('event_start', 'is', null)
    .eq('is_multi_day', true)
    .limit(1);
  if (error || !data?.length) return needs;

  const { data: rows } = await supabase
    .from('booking_sheet_workshop_attendees')
    .select('event_start, event_end, theme_location, client_name, paid, is_multi_day')
    .eq('property_url', propertyUrl)
    .eq('is_multi_day', true)
    .not('event_start', 'is', null)
    .gte('event_start', asOfYmd);
  const end60 = new Date(`${asOfYmd}T12:00:00Z`);
  end60.setUTCDate(end60.getUTCDate() + 60);
  const endYmd = end60.toISOString().slice(0, 10);
  const byEvent = new Map();
  for (const r of rows || []) {
    if (!r.event_start || r.event_start > endYmd) continue;
    const key = `${r.event_start}|${r.theme_location || ''}`;
    if (!byEvent.has(key)) byEvent.set(key, { start: r.event_start, name: r.theme_location || r.event_start, n: 0 });
    if (r.client_name) byEvent.get(key).n += 1;
  }
  const below = [...byEvent.values()].filter((e) => e.n < 4);
  const spanNote = below.length
    ? below.map((e) => `${e.name}, ${dayLabel(e.start)} (${e.n} booked)`).join(' · ')
    : '0 events below minimum';
  return {
    avg: { status: 'computed', value: null },
    below: { status: below.length ? 'Off target' : 'On target', spanNote, count: below.length }
  };
}

/** Lever 1: residential events that ran in the month (started by asOf) — people ÷ events from the Workshops tab. */
async function residentialAverage(supabase, propertyUrl, year, month, asOfYmd) {
  const start = monthStart(year, month);
  const endEx = monthEndExclusive(year, month);
  const { data } = await supabase.from('booking_sheet_workshop_attendees')
    .select('event_start, client_name')
    .eq('property_url', propertyUrl).eq('is_multi_day', true)
    .gte('event_start', start).lt('event_start', endEx).lte('event_start', asOfYmd);
  const events = new Map();
  for (const r of data || []) {
    if (!r.client_name) continue;
    events.set(r.event_start, (events.get(r.event_start) || 0) + 1);
  }
  const people = [...events.values()].reduce((a, n) => a + n, 0);
  return events.size ? { value: round1(people / events.size), people, events: events.size } : { value: null, people: 0, events: 0 };
}

export async function buildSectionG(supabase, opts = {}) {
  const propertyUrl = opts.propertyUrl || 'https://www.alanranger.com';
  const asOf = opts.asOf ? new Date(opts.asOf) : new Date();
  const parts = monthParts(asOf);
  const gpBundle = await resolveGpTargetsBundle(supabase, propertyUrl, asOf);
  const cfg = { ...DEFAULT_SECTION_G_CONFIG, ...(gpBundle.targets.section_g_config || {}) };
  const tm = gpBundle.this_month;
  const survivalGp = tm.survival;
  const derivedSales = gpBundle.derived.survival_sales;
  const salesTarget = derivedSales ?? survivalGp;

  const curMtd = { mtdDay: parts.cur.day };
  const curSales = await sumSalesExclJlr(supabase, propertyUrl, parts.cur.year, parts.cur.month, curMtd);
  const prevSales = await sumSalesExclJlr(supabase, propertyUrl, parts.prev.year, parts.prev.month);
  const prev2Sales = await sumSalesExclJlr(supabase, propertyUrl, parts.prev2.year, parts.prev2.month);
  const lySales = await sumSalesExclJlr(supabase, propertyUrl, parts.cur.year - 1, parts.cur.month, curMtd);

  const curGp = await sumGp(supabase, propertyUrl, parts.cur.year, parts.cur.month, curMtd);
  const prevGp = await sumGp(supabase, propertyUrl, parts.prev.year, parts.prev.month);
  const prev2Gp = await sumGp(supabase, propertyUrl, parts.prev2.year, parts.prev2.month);
  const lyGp = await sumGp(supabase, propertyUrl, parts.cur.year - 1, parts.cur.month, curMtd);
  const lyGpFull = await sumGp(supabase, propertyUrl, parts.cur.year - 1, parts.cur.month);

  const salesPace = pace(salesTarget, parts.cur.day, parts.cur.daysIn);
  const gpTargetPace = pace(lyGpFull, parts.cur.day, parts.cur.daysIn);

  const erCur = await existingReferralCount(supabase, propertyUrl, parts.cur.year, parts.cur.month, curMtd);
  const erPrev = await existingReferralCount(supabase, propertyUrl, parts.prev.year, parts.prev.month);
  const erPrev2 = await existingReferralCount(supabase, propertyUrl, parts.prev2.year, parts.prev2.month);
  const erLy = await existingReferralCount(supabase, propertyUrl, parts.cur.year - 1, parts.cur.month, curMtd);
  const erPace = pace(cfg.existing_referral_monthly, parts.cur.day, parts.cur.daysIn);

  const hmCur = await highMarginShare(supabase, propertyUrl, parts.cur.year, parts.cur.month);
  const hmPrev = await highMarginShare(supabase, propertyUrl, parts.prev.year, parts.prev.month);
  const hmPrev2 = await highMarginShare(supabase, propertyUrl, parts.prev2.year, parts.prev2.month);

  const brCur = await brandClicks(supabase, propertyUrl, parts.cur.year, parts.cur.month);
  const brPrev = await brandClicks(supabase, propertyUrl, parts.prev.year, parts.prev.month);
  const brPrev2 = await brandClicks(supabase, propertyUrl, parts.prev2.year, parts.prev2.month);

  const ccCur = await commercialClicks(supabase, propertyUrl, parts.cur.year, parts.cur.month, curMtd);
  const ccPrev = await commercialClicks(supabase, propertyUrl, parts.prev.year, parts.prev.month);
  const ccPrev2 = await commercialClicks(supabase, propertyUrl, parts.prev2.year, parts.prev2.month);
  const ccPace = pace(cfg.commercial_clicks_monthly, parts.cur.day, parts.cur.daysIn);

  const gbCur = await googleBookings(supabase, propertyUrl, parts.cur.year, parts.cur.month, curMtd);
  const gbPrev = await googleBookings(supabase, propertyUrl, parts.prev.year, parts.prev.month);
  const gbPrev2 = await googleBookings(supabase, propertyUrl, parts.prev2.year, parts.prev2.month);
  const orgCur = await organicEngagedSessions(supabase, propertyUrl, parts.cur.year, parts.cur.month, curMtd);
  const orgPrev = await organicEngagedSessions(supabase, propertyUrl, parts.prev.year, parts.prev.month);
  const orgPrev2 = await organicEngagedSessions(supabase, propertyUrl, parts.prev2.year, parts.prev2.month);
  const bp1k = (b, v) => (v > 0 ? round2((b / v) * 1000) : null);
  const rateCur = bp1k(gbCur, orgCur.value);
  const ratePrev = bp1k(gbPrev, orgPrev.value);
  const ratePrev2 = bp1k(gbPrev2, orgPrev2.value);

  const aiCur = await aiBookingsAndVisits(supabase, propertyUrl, parts.cur.year, parts.cur.month, curMtd);
  const aiPrev = await aiBookingsAndVisits(supabase, propertyUrl, parts.prev.year, parts.prev.month);
  const aiPrev2 = await aiBookingsAndVisits(supabase, propertyUrl, parts.prev2.year, parts.prev2.month);

  const acCur = await academyPaidConversions(parts.cur.year, parts.cur.month, curMtd);
  const acPrev = await academyPaidConversions(parts.prev.year, parts.prev.month);
  const acPrev2 = await academyPaidConversions(parts.prev2.year, parts.prev2.month);

  const workshops = await workshopLever(supabase, propertyUrl, parts.asOfYmd);
  const resCur = await residentialAverage(supabase, propertyUrl, parts.cur.year, parts.cur.month, parts.asOfYmd);
  const resPrev = await residentialAverage(supabase, propertyUrl, parts.prev.year, parts.prev.month, parts.asOfYmd);
  const resPrev2 = await residentialAverage(supabase, propertyUrl, parts.prev2.year, parts.prev2.month, parts.asOfYmd);
  const dataCheck = await rankingDataCheck(supabase, propertyUrl);
  const mentoringMsg = mentoringPasteDataCheck();
  if (mentoringMsg) {
    dataCheck.ok = false;
    dataCheck.message = `${dataCheck.message || 'Data check'} · ${mentoringMsg}`;
    dataCheck.mentoring_repaste = true;
  }
  const { data: txFresh } = await supabase
    .from('booking_sheet_transactions')
    .select('imported_at')
    .eq('property_url', propertyUrl)
    .order('imported_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const brandPrevStatus = brPrev.value == null ? null
    : (brPrev.value >= cfg.brand_clicks_monthly ? 'on target' : brPrev.value >= 100 ? 'watch' : 'off target');
  const aiPrevStatus = aiPrev.visits > (aiPrev2.visits || 0) ? 'on target' : 'off target';
  const acPrevStatus = acPrev.value >= 2 ? 'on target' : acPrev.value === 1 ? 'watch' : 'off target';

  const rows = [
    {
      group: 'Money', id: 'direct_sales', label: 'Direct sales excl. JLR',
      cur: curSales, curSub: `2025: £${lySales.toLocaleString('en-GB')}`,
      prev: prevSales, prev2: prev2Sales,
      target: salesTarget,
      targetSub: `pace now £${Math.round(salesPace || 0).toLocaleString('en-GB')} · ${gpBundle.derived.sales_needed_label}`,
      sql: 'Full mo: SUM(booking_sheet_monthly_category.revenue_amount) − SUM(txn is_jlr). MTD: SUM(txn.amount) WHERE NOT is_jlr (includes GV Out negatives).',
      ...statusPace(curSales, salesPace)
    },
    {
      group: 'Money', id: 'gross_profit', label: 'Gross profit',
      cur: curGp, curSub: `2025: £${lyGp.toLocaleString('en-GB')}`,
      prev: prevGp, prev2: prev2Gp,
      target: survivalGp,
      targetSub: `pace now £${Math.round(gpTargetPace || 0).toLocaleString('en-GB')} · survival GP £${survivalGp.toLocaleString('en-GB')} this month, seasonal (S1 £${tm.stretch1.toLocaleString('en-GB')} / S2 £${tm.stretch2.toLocaleString('en-GB')}) · bills line £${gpBundle.bills_line.toLocaleString('en-GB')}`,
      sql: 'SUM(category.revenue_amount * gp_rate); MTD prorated by sales MTD/full.',
      ...statusPace(curGp, gpTargetPace)
    },
    residentialRow(resCur, resPrev, resPrev2, cfg.min_clients_residential),
    {
      group: 'Lever 1 — Fill before you run', id: 'events_below_min',
      label: 'Events below minimum, next 60 days',
      cur: null, prev: null, prev2: null, target: 0,
      status: workshops.below.status,
      spanNote: workshops.below.spanNote,
      sql: 'Workshops import + schedule; events <4 paying clients in next 60d'
    },
    {
      group: 'Lever 2 — Sell to people who know you', id: 'existing_referral',
      label: 'Existing and referral bookings',
      cur: erCur, curSub: `2025: ${erLy}`, prev: erPrev, prev2: erPrev2,
      target: cfg.existing_referral_monthly, targetSub: `pace now ${erPace}`,
      sql: "COUNT(txn) amount>0 booking_source IN (Existing,Referral) NOT is_jlr",
      ...statusPace(erCur, erPace)
    },
    {
      group: 'Lever 2 — Sell to people who know you', id: 'brand_clicks',
      label: 'Clicks on searches for your name',
      cur: brCur.value, curSub: dataToNote(brCur.data_to),
      prev: brPrev.value, prev2: brPrev2.value,
      target: cfg.brand_clicks_monthly,
      sql: 'gsc_brand_query_monthly.brand_clicks',
      ...statusPace(brCur.value, null, { tooEarly: true, prevStatus: brandPrevStatus })
    },
    {
      group: 'Lever 3 — Move hours into high-margin work', id: 'high_margin_share',
      label: 'Share of GP from 90%+ margin lines',
      cur: hmCur, prev: hmPrev, prev2: hmPrev2, target: cfg.high_margin_share_pct,
      format: 'pct',
      status: hmCur == null ? '—' : (hmCur >= cfg.high_margin_share_pct ? 'On target' : 'Off target'),
      sql: 'GP where gp_rate>=0.90 / total GP'
    },
    {
      group: 'Lever 4 — Convert the traffic you have', id: 'commercial_clicks',
      label: 'Clicks to commercial pages',
      cur: ccCur.value, curSub: dataToNote(ccCur.data_to),
      prev: ccPrev.value, prev2: ccPrev2.value,
      target: cfg.commercial_clicks_monthly, targetSub: `pace now ${Math.round(ccPace || 0)}`,
      sql: 'SUM(gsc_page_timeseries.clicks) WHERE path in pages_master tier A_landing|B_product|C_event',
      ...statusPace(ccCur.value, ccPace)
    },
    {
      group: 'Lever 4 — Convert the traffic you have', id: 'bookings_per_1k',
      label: 'Bookings per 1,000 engaged search visits',
      cur: rateCur,
      curSub: `${gbCur} bookings · ${orgCur.value} visits`,
      prev: ratePrev, prev2: ratePrev2,
      target: cfg.bookings_per_1k_engaged,
      status: rateCur == null ? '—' : (rateCur >= cfg.bookings_per_1k_engaged ? 'On pace' : rateCur >= 2.0 ? 'Watch' : 'Off pace'),
      sql: "Google bookings / GA4 Organic Search engaged_sessions * 1000"
    },
    {
      group: 'Lever 5 — AI assistants', id: 'ai_bookings_visits',
      label: 'AI-sourced bookings / visits',
      cur: `${aiCur.bookings} / ${aiCur.visits}`,
      curSub: dataToNote(aiCur.data_to),
      prev: `${aiPrev.bookings} / ${aiPrev.visits}`,
      prev2: `${aiPrev2.bookings} / ${aiPrev2.visits}`,
      target: 'Rising',
      sql: "bookings booking_source~AI; GA4 channel_group='AI Assistant' sessions",
      ...statusPace(null, null, { tooEarly: true, prevStatus: aiPrevStatus })
    },
    {
      group: 'Academy', id: 'academy_paid',
      label: 'Paid conversions',
      cur: acCur.value,
      curSub: acCur.trials != null ? `${acCur.trials} trial${acCur.trials === 1 ? '' : 's'} started` : (acCur.error || null),
      prev: acPrev.value, prev2: acPrev2.value,
      target: cfg.academy_paid_monthly,
      sql: 'Academy academy_trial_history.converted_at in calendar month',
      ...statusPace(null, null, { tooEarly: true, prevStatus: acPrevStatus })
    }
  ];

  const weekOneChanged = applyWeekOneRule(rows, parts.asOfYmd);
  const counts = { on_pace: 0, off_pace: 0, too_early: 0 };
  for (const r of rows) {
    if (!r.status || r.status === 'Needs data feed' || r.status === '—') continue;
    if (r.status === 'Too early') counts.too_early += 1;
    else if (/On /i.test(r.status)) counts.on_pace += 1;
    else if (/Off|Watch/i.test(r.status)) counts.off_pace += 1;
  }

  return {
    as_of: parts.asOfYmd,
    periods: { cur: parts.cur, prev: parts.prev, prev2: parts.prev2 },
    tiles: counts,
    week_one_too_early: weekOneChanged,
    data_check: dataCheck,
    booking_sheet_uploaded: txFresh?.imported_at || null,
    gp_bundle: {
      survival_gp: survivalGp,
      stretch1: tm.stretch1,
      stretch2: tm.stretch2,
      bills_line: gpBundle.bills_line,
      derived_sales: derivedSales,
      margin_pct: gpBundle.derived.margin_pct
    },
    rows,
    config: cfg,
    source: 'live'
  };
}

export function renderSectionGHtml(sectionG) {
  if (!sectionG || sectionG.error) {
    return `<tr><td style="padding:16px 28px;color:#667085;font-family:Figtree,Helvetica,Arial,sans-serif;">Profit levers — unavailable${sectionG?.error ? `: ${esc(sectionG.error)}` : ''}</td></tr>`;
  }
  const FF = 'font-family:Figtree,Helvetica,Arial,sans-serif;';
  const tiles = sectionG.tiles || {};
  const dc = sectionG.data_check || {};
  const dcColor = dc.ok ? '#2e7d32' : '#b3261e';
  const tile = (label, n, color) =>
    `<td style="width:22%;background:#fff;border:1px solid #eee3d0;border-radius:8px;padding:10px;text-align:center;">
      <div style="font-size:22px;font-weight:800;color:${color};${FF}">${n ?? 0}</div>
      <div style="font-size:11px;color:#5b524a;${FF}">${label}</div>
    </td>`;

  const heads = [`${shortMonth(sectionG.periods.cur)} so far`, shortMonth(sectionG.periods.prev), shortMonth(sectionG.periods.prev2)];
  let lastGroup = null;
  const body = (sectionG.rows || []).map((r) => {
    const groupRow = r.group !== lastGroup ? leverBanner(r.group, heads) : '';
    lastGroup = r.group;
    return `${groupRow}${leverRow(r)}`;
  }).join('');

  return `
  <tr><td style="padding:16px 28px 4px;"><div style="border-left:4px solid #e8853d;padding-left:10px;color:#111827;font-size:15px;font-weight:700;${FF}">Profit levers scorecard</div>
  <div style="color:#667085;font-size:12px;padding-left:14px;margin-top:2px;${FF}">Calendar months · live · Survival GP £${esc(Number(sectionG.gp_bundle?.survival_gp || 0).toLocaleString('en-GB'))} this month (seasonal)</div></td></tr>
  <tr><td style="padding:8px 28px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      ${tile('On pace', tiles.on_pace, '#2e7d32')}
      <td style="width:4%;"></td>
      ${tile('Off pace', tiles.off_pace, '#b3261e')}
      <td style="width:4%;"></td>
      ${tile('Too early', tiles.too_early, '#5b524a')}
      <td style="width:4%;"></td>
      <td style="width:34%;background:#fff;border:1px solid #eee3d0;border-radius:8px;padding:10px;">
        <div style="font-size:12px;font-weight:700;color:${dcColor};${FF}">${esc(dc.message || 'Data check')}</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:12px 28px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e7ec;border-collapse:collapse">${body}</table>
    <div style="color:#667085;font-size:11px;padding:8px 0;${FF}">
      Booking sheet uploaded ${esc(uploadedLabel(sectionG.booking_sheet_uploaded))}.
      Pace now = monthly target × days elapsed / days in month.
      Direct sales target = derived sales for Survival GP.
    </div>
  </td></tr>`;
}

const AF = 'font-family:Arial,Helvetica,sans-serif;';
const CELL = `padding:9px 10px;border-bottom:1px solid #eef1f5;vertical-align:top;${AF}font-size:13px;`;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function residentialRow(cur, prev, prev2, target) {
  const latest = cur.value != null ? cur : prev;
  let status = '—';
  if (latest.value != null) status = latest.value >= target ? 'On target' : 'Off target';
  return {
    group: 'Lever 1 — Fill before you run', id: 'avg_clients_residential',
    label: 'Average clients per residential',
    cur: cur.value, curSub: cur.events ? `${cur.people} people · ${cur.events} event${cur.events === 1 ? '' : 's'}` : 'none ran yet',
    prev: prev.value, prev2: prev2.value, target,
    status,
    sql: 'booking_sheet_workshop_attendees is_multi_day, event_start in month and ≤ as-of: people ÷ distinct event_start'
  };
}

/** "data to 1 Nov" from the latest row's date. */
function dataToNote(ymd) {
  if (!ymd) return null;
  const [, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return `data to ${d} ${MONTH_SHORT[m - 1]}`;
}

function uploadedLabel(iso) {
  if (!iso) return '—';
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const hm = new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' });
  return `${dayLabel(ymd)} ${hm}`;
}

function shortMonth(period) {
  return MONTH_SHORT[(Number(period?.month) || 1) - 1];
}

/** Section banner with the column headings repeated (one font size, fixed widths). */
function leverBanner(group, heads) {
  const h = (w, label, right) => `<td style="padding:8px 10px;width:${w}%;${AF}font-size:11px;font-weight:700;color:#8a4b08;${right ? 'text-align:right;' : ''}">${esc(label)}</td>`;
  return `<tr style="background:#f3e8d4"><td style="padding:8px 10px;width:30%;${AF}font-size:13px;font-weight:800;color:#8a4b08">${esc(group)}</td>${h(14, heads[0], true)}${h(11, heads[1], true)}${h(11, heads[2], true)}${h(20, 'Target', false)}${h(14, 'Status', false)}</tr>`;
}

function leverFmt(r, v) {
  if (v == null) return '—';
  if (r.format === 'pct') return `${v}%`;
  if (typeof v === 'number' && /sales|profit|Direct|Gross/i.test(r.label)) return `£${Number(v).toLocaleString('en-GB')}`;
  return String(v);
}

function leverStatusColor(status) {
  if (/On /i.test(status || '')) return '#067647';
  return /Off|Needs|Watch/i.test(status || '') ? '#b42318' : '#667085';
}

const sub = (text) => (text ? `<div style="font-size:11px;color:#667085;margin-top:2px;white-space:normal">${esc(text)}</div>` : '');

function leverRow(r) {
  const num = (v, s) => `<td style="${CELL}color:#101828;text-align:right;white-space:nowrap;">${esc(leverFmt(r, v))}${sub(s)}</td>`;
  const figures = r.spanNote
    ? `<td colspan="3" style="${CELL}color:#101828">${esc(r.spanNote)}</td>`
    : `${num(r.cur, r.curSub)}${num(r.prev)}${num(r.prev2)}`;
  return `<tr><td style="${CELL}color:#475467">${esc(r.label)}</td>${figures}<td style="${CELL}color:#101828;">${esc(leverFmt(r, r.target))}${sub(r.targetSub)}</td><td style="${CELL}font-weight:700;color:${leverStatusColor(r.status)}">${esc(r.status || '—')}</td></tr>`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
