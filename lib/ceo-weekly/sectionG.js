/**
 * CEO weekly Section G — Profit levers scorecard (live every run).
 * Calendar months: MTD | previous full | month before.
 */
import { createClient } from '@supabase/supabase-js';
import { resolveGpTargetsBundle, DEFAULT_SECTION_G_CONFIG } from '../business-targets.mjs';

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
    ? below.map((e) => `${e.name} ${e.start} (${e.n})`).join(' · ')
    : '0 events below minimum';
  return {
    avg: { status: 'Needs data feed', value: null },
    below: { status: below.length ? 'Off target' : 'On target', spanNote, count: below.length }
  };
}

export async function buildSectionG(supabase, opts = {}) {
  const propertyUrl = opts.propertyUrl || 'https://www.alanranger.com';
  const asOf = opts.asOf ? new Date(opts.asOf) : new Date();
  const parts = monthParts(asOf);
  const gpBundle = await resolveGpTargetsBundle(supabase, propertyUrl, asOf);
  const cfg = { ...DEFAULT_SECTION_G_CONFIG, ...(gpBundle.targets.section_g_config || {}) };
  const survivalGp = Number(gpBundle.targets.survival_gp_monthly) || 3700;
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
  const dataCheck = await rankingDataCheck(supabase, propertyUrl);
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
      targetSub: `pace now £${Math.round(gpTargetPace || 0).toLocaleString('en-GB')} · Survival GP £${survivalGp.toLocaleString('en-GB')} (S1 £${Number(gpBundle.targets.stretch1_gp_monthly).toLocaleString('en-GB')} / S2 £${Number(gpBundle.targets.stretch2_gp_monthly).toLocaleString('en-GB')})`,
      sql: 'SUM(category.revenue_amount * gp_rate); MTD prorated by sales MTD/full.',
      ...statusPace(curGp, gpTargetPace)
    },
    {
      group: 'Lever 1 — Fill before you run', id: 'avg_clients_residential',
      label: 'Average clients per residential',
      cur: workshops.avg.value, curSub: workshops.avg.status === 'Needs data feed' ? 'Needs data feed' : null,
      prev: null, prev2: null, target: cfg.min_clients_residential,
      status: workshops.avg.status,
      sql: 'booking_sheet_workshop_attendees multi-day paying client avg'
    },
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
      cur: brCur.value, curSub: brCur.data_to ? `data to ${brCur.data_to}` : null,
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
      cur: ccCur.value, curSub: ccCur.data_to ? `data to ${ccCur.data_to}` : null,
      prev: ccPrev.value, prev2: ccPrev2.value,
      target: cfg.commercial_clicks_monthly, targetSub: `pace now ${Math.round(ccPace || 0)}`,
      sql: 'SUM(gsc_page_timeseries.clicks) WHERE path in pages_master tier A_landing|B_product|C_event',
      ...statusPace(ccCur.value, ccPace)
    },
    {
      group: 'Lever 4 — Convert the traffic you have', id: 'bookings_per_1k',
      label: 'Bookings per 1,000 engaged search visits',
      cur: rateCur,
      curSub: `${gbCur} bookings, ${orgCur.value} visits`,
      prev: ratePrev, prev2: ratePrev2,
      target: cfg.bookings_per_1k_engaged,
      status: rateCur == null ? '—' : (rateCur >= cfg.bookings_per_1k_engaged ? 'On pace' : rateCur >= 2.0 ? 'Watch' : 'Off pace'),
      sql: "Google bookings / GA4 Organic Search engaged_sessions * 1000"
    },
    {
      group: 'Lever 5 — AI assistants', id: 'ai_bookings_visits',
      label: 'AI-sourced bookings / visits',
      cur: `${aiCur.bookings} / ${aiCur.visits}`,
      curSub: aiCur.data_to ? `data to ${aiCur.data_to}` : null,
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
      curSub: acCur.trials != null ? `${acCur.trials} trials started` : (acCur.error || null),
      prev: acPrev.value, prev2: acPrev2.value,
      target: cfg.academy_paid_monthly,
      sql: 'Academy academy_trial_history.converted_at in calendar month',
      ...statusPace(null, null, { tooEarly: true, prevStatus: acPrevStatus })
    }
  ];

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
    data_check: dataCheck,
    booking_sheet_uploaded: txFresh?.imported_at || null,
    gp_bundle: {
      survival_gp: survivalGp,
      stretch1: Number(gpBundle.targets.stretch1_gp_monthly),
      stretch2: Number(gpBundle.targets.stretch2_gp_monthly),
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
    return `<tr><td style="padding:16px 28px;color:#667085;font-family:Figtree,Helvetica,Arial,sans-serif;">G · Profit levers — unavailable${sectionG?.error ? `: ${esc(sectionG.error)}` : ''}</td></tr>`;
  }
  const FF = 'font-family:Figtree,Helvetica,Arial,sans-serif;';
  const curL = sectionG.periods.cur.label;
  const pL = sectionG.periods.prev.label;
  const p2L = sectionG.periods.prev2.label;
  const tiles = sectionG.tiles || {};
  const dc = sectionG.data_check || {};
  const dcColor = dc.ok ? '#2e7d32' : '#b3261e';
  const tile = (label, n, color) =>
    `<td style="width:22%;background:#fff;border:1px solid #eee3d0;border-radius:8px;padding:10px;text-align:center;">
      <div style="font-size:22px;font-weight:800;color:${color};${FF}">${n ?? 0}</div>
      <div style="font-size:11px;color:#5b524a;${FF}">${label}</div>
    </td>`;

  let lastGroup = null;
  const body = (sectionG.rows || []).map((r) => {
    let groupRow = '';
    if (r.group !== lastGroup) {
      lastGroup = r.group;
      groupRow = `<tr><td colspan="6" style="background:#f1e6d2;color:#8a4300;font-weight:700;padding:8px 10px;${FF}">${esc(r.group)}</td></tr>`;
    }
    const fmt = (v) => {
      if (v == null) return '—';
      if (r.format === 'pct') return `${v}%`;
      if (typeof v === 'number' && /sales|profit|Direct|Gross/i.test(r.label)) return `£${Number(v).toLocaleString('en-GB')}`;
      return String(v);
    };
    const statusColor = /On /i.test(r.status || '') ? '#2e7d32' : /Off|Needs|Watch/i.test(r.status || '') ? '#b3261e' : '#5b524a';
    const curCell = r.spanNote
      ? `<td colspan="3" style="padding:8px 10px;background:#fff;border-bottom:1px solid #eee3d0;${FF}">${esc(r.spanNote)}</td>`
      : `<td style="padding:8px 10px;background:#fff;border-bottom:1px solid #eee3d0;${FF}">${esc(fmt(r.cur))}${r.curSub ? `<div style="color:#8a837a;font-size:11px;">${esc(r.curSub)}</div>` : ''}</td>
         <td style="padding:8px 10px;background:#fff;border-bottom:1px solid #eee3d0;${FF}">${esc(fmt(r.prev))}</td>
         <td style="padding:8px 10px;background:#fff;border-bottom:1px solid #eee3d0;${FF}">${esc(fmt(r.prev2))}</td>`;
    return `${groupRow}<tr>
      <td style="padding:8px 10px;background:#fff;border-bottom:1px solid #eee3d0;${FF}">${esc(r.label)}</td>
      ${curCell}
      <td style="padding:8px 10px;background:#fff;border-bottom:1px solid #eee3d0;${FF}">${esc(fmt(r.target))}${r.targetSub ? `<div style="color:#8a837a;font-size:11px;">${esc(r.targetSub)}</div>` : ''}</td>
      <td style="padding:8px 10px;background:#fff;border-bottom:1px solid #eee3d0;color:${statusColor};font-weight:700;${FF}">${esc(r.status || '—')}</td>
    </tr>`;
  }).join('');

  return `
  <tr><td style="padding:16px 28px 4px;"><div style="border-left:4px solid #e8853d;padding-left:10px;color:#111827;font-size:15px;font-weight:700;${FF}">G · Profit levers scorecard</div>
  <div style="color:#667085;font-size:12px;padding-left:14px;margin-top:2px;${FF}">Calendar months · live · Survival GP £${esc(String(sectionG.gp_bundle?.survival_gp || 3700))}</div></td></tr>
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
  <tr><td style="padding:12px 28px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;${FF}">
      <tr>
        <th align="left" style="background:#2b2622;color:#fff;padding:8px 10px;">Measure</th>
        <th align="left" style="background:#2b2622;color:#fff;padding:8px 10px;">${esc(curL)} so far</th>
        <th align="left" style="background:#2b2622;color:#fff;padding:8px 10px;">${esc(pL)}</th>
        <th align="left" style="background:#2b2622;color:#fff;padding:8px 10px;">${esc(p2L)}</th>
        <th align="left" style="background:#2b2622;color:#fff;padding:8px 10px;">Target</th>
        <th align="left" style="background:#2b2622;color:#fff;padding:8px 10px;">Status</th>
      </tr>
      ${body}
    </table>
    <div style="color:#667085;font-size:11px;padding:8px 0;${FF}">
      Booking sheet uploaded ${esc(sectionG.booking_sheet_uploaded || '—')}.
      Pace now = monthly target × days elapsed / days in month.
      Direct sales target = derived sales for Survival GP.
    </div>
  </td></tr>`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
