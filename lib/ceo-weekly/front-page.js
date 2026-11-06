/**
 * Monday brief front page (batch 8 task 15a/15b): 8 headline tiles + cards A · B · C, plus the
 * System health inputs. Pure builders take already-loaded metrics; loaders read Supabase / Academy.
 */
import { createClient } from '@supabase/supabase-js';
import { FRONT_PAGE } from './front-page-config.js';

const DAY_MS = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const monthShort = (m) => MONTHS[(Number(m) + 11) % 12];
export const monthLong = (m) => MONTHS_LONG[(Number(m) + 11) % 12];

/** "Fri 20 Nov" */
export function dayLabel(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** One colour rule for every tile. */
export function tileTone(value, target, { judge = true } = {}) {
  if (!judge || value == null || !target) return 'grey';
  const r = value / target;
  if (r >= FRONT_PAGE.colourBands.green) return 'green';
  return r >= FRONT_PAGE.colourBands.amber ? 'amber' : 'red';
}

const pct = (v, t) => (t ? Math.round((v / t) * 100) : null);
const gbp = (n) => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;

function parseSlash(s) {
  const m = String(s || '').match(/(\d+)\s*\/\s*(\d+)/);
  return m ? { a: Number(m[1]), b: Number(m[2]) } : null;
}

function sgRow(metrics, id) {
  return (metrics.section_g?.rows || []).find((r) => r.id === id) || {};
}

function academyTone(ac, salesTab) {
  if (!salesTab?.on_pace_visible || !salesTab.working_days_month) return 'grey';
  const share = salesTab.working_days_elapsed / salesTab.working_days_month;
  const t = FRONT_PAGE.tiles;
  const worst = Math.min(ac.trials_mtd / (t.academyTrialsMonthly * share), ac.conv_mtd / (t.academyConversionsMonthly * share));
  return tileTone(worst, 1);
}

function periodMonths(metrics) {
  const p = metrics.section_g?.periods || {};
  return { prev: monthShort(Number(p.prev?.month)), prev2: monthShort(Number(p.prev2?.month)) };
}

function moneyTiles(metrics, salesTab) {
  const survival = Number(metrics.section_g?.gp_bundle?.bills_line) || 0;
  const gp3 = Number(metrics.strategy?.trends?.gp_t3);
  return [
    { id: 'gp3', value: gbp(gp3), label: 'GP, 3-month average', sub: `${pct(gp3, survival)}% of ${gbp(survival)} survival (bills) line`, section: 2, tone: tileTone(gp3, survival) },
    { id: 'sales_ytd', value: gbp(salesTab.ytd_actual), label: 'Sales year to date', sub: `${pct(salesTab.ytd_actual, salesTab.ytd_target)}% of ${gbp(salesTab.ytd_target)} target`, section: 2, tone: tileTone(salesTab.ytd_actual, salesTab.ytd_target) }
  ];
}

function peopleTile(pipeline) {
  const t = FRONT_PAGE.tiles;
  const n = pipeline?.next90 || { people: 0, events: 0 };
  const per = n.events ? n.people / n.events : null;
  return { id: 'people_per_event', value: per == null ? '—' : per.toFixed(1), label: 'People per event, next 90 days', sub: `courses + workshops · ${n.people} people / ${n.events} events · target ${t.peoplePerEventTarget}`, section: 1, tone: tileTone(per, t.peoplePerEventTarget) };
}

function rateTile(metrics, months) {
  const t = FRONT_PAGE.tiles;
  const rate = sgRow(metrics, 'bookings_per_1k').prev;
  return { id: 'bookings_per_1k', value: rate == null ? '—' : Number(rate).toFixed(2), label: 'Bookings per 1,000 search visits', sub: `${months.prev} · ${pct(rate, t.bookingsPer1kTarget)}% of ${t.bookingsPer1kTarget} target`, section: 3, tone: tileTone(rate, t.bookingsPer1kTarget) };
}

function academyTile(academy, salesTab) {
  const t = FRONT_PAGE.tiles;
  return { id: 'academy_mtd', valueHtml: `<span style="font-size:15px;white-space:nowrap">Trials ${academy.trials_mtd ?? '—'} / ${t.academyTrialsMonthly}<br>Conv ${academy.conv_mtd ?? '—'} / ${t.academyConversionsMonthly}</span>`, label: `Academy, ${monthLong(salesTab.month)} so far`, sub: salesTab.on_pace_visible ? 'monthly targets · pro rata to working days so far' : 'monthly targets · colour shown from week 2', section: 2, tone: academyTone(academy, salesTab) };
}

function clicksTile(metrics, months) {
  const t = FRONT_PAGE.tiles;
  const clicks = sgRow(metrics, 'commercial_clicks').prev;
  return { id: 'commercial_clicks', value: `${clicks ?? '—'} / ${t.commercialClicksTarget}`, label: 'Google clicks to booking pages', sub: `${months.prev} · people arriving from Google on the pages you sell from (workshops, courses, lessons)`, section: 4, tone: tileTone(clicks, t.commercialClicksTarget) };
}

/** Calendar months (prev vs prev2), never the 28-day figure (task 15g.4). */
function aiVisitsTile(metrics, months) {
  const ai = parseSlash(sgRow(metrics, 'ai_bookings_visits').prev);
  const ai2 = parseSlash(sgRow(metrics, 'ai_bookings_visits').prev2);
  const ok = !!(ai && ai2);
  return { id: 'ai_visits', value: ok ? `${ai.b} / ${ai2.b}` : '—', label: 'Visits from AI assistants', sub: `${months.prev} vs ${months.prev2} · ChatGPT, Perplexity etc. · target: beat last month`, section: 4, tone: ok ? tileTone(ai.b, ai2.b) : 'grey' };
}

function aiAnswersTile(metrics) {
  const t = FRONT_PAGE.tiles;
  const named = metrics.llm?.prompts_named;
  const set = Number(metrics.llm?.prompts_total) === 12 ? '12 strategy questions' : '12 strategy questions (new set from next run)';
  return { id: 'ai_answers', value: `${named ?? '—'} / ${t.aiAnswersTarget}`, label: 'AI answers naming you', sub: `${set} · target ${t.aiAnswersTarget} by ${t.aiAnswersBy}`, section: 4, tone: tileTone(named, t.aiAnswersTarget) };
}

/** 15a — the 8 headline tiles (value, label, sub, section, tone). */
export function buildTiles({ metrics, salesTab, pipeline, academy }) {
  const months = periodMonths(metrics);
  return [
    ...moneyTiles(metrics, salesTab),
    peopleTile(pipeline),
    rateTile(metrics, months),
    academyTile(academy, salesTab),
    clicksTile(metrics, months),
    aiVisitsTile(metrics, months),
    aiAnswersTile(metrics)
  ];
}

function windowSub(w, today) {
  if (!w.people) return { text: `${monthLong(Number(addDays(today, w.min + 15).slice(5, 7)))}: nothing booked`, tone: 'red' };
  if (w.empty) return { text: `${w.empty} event${w.empty === 1 ? '' : 's'} still empty`, tone: 'red' };
  if (w.due) return { text: `${gbp(w.due)} balance still due`, tone: 'grey' };
  return null;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** 15b card A — where you stand. */
export function buildCardA({ salesTab, pipeline, academy, today }) {
  const rows = [
    { label: `${monthLong(salesTab.month)} so far`, value: `${gbp(salesTab.mtd)} of ${gbp(salesTab.month_target)} target`,
      sub: { text: `${salesTab.working_days_left} working days left · ${gbp(salesTab.per_day_needed)} a day needed${salesTab.on_pace_visible ? ` · on pace for ${gbp(salesTab.on_pace_for)}` : ''}`, tone: 'grey' } },
    { label: 'Year to date', value: `${gbp(salesTab.ytd_actual)} of ${gbp(salesTab.ytd_target)}`,
      sub: { text: `${salesTab.ytd_var < 0 ? '−' : '+'}${gbp(Math.abs(salesTab.ytd_var))} (${salesTab.ytd_pct > 0 ? '+' : salesTab.ytd_pct < 0 ? '−' : ''}${Math.abs(salesTab.ytd_pct)}%) ${salesTab.ytd_var < 0 ? 'behind' : 'ahead of'} target`, tone: salesTab.ytd_var < 0 ? 'red' : 'green' } }
  ];
  const names = { w0: 'Booked, next 30 days', w1: 'Booked, 31–60 days', w2: 'Booked, 61–90 days', w3: 'Booked, 90+ days' };
  for (const w of pipeline.windows) {
    rows.push({ label: names[w.key], value: `${plural(w.people, 'person', 'people')} · ${plural(w.events, 'event', 'events')} · ${gbp(w.taken)}`, sub: windowSub(w, today) });
  }
  rows.push({ label: 'Academy', value: `${academy.paid} paid · ${academy.on_trial} on trial`,
    sub: { text: academySubline(academy, today), tone: 'grey' } });
  return { title: 'A · WHERE YOU STAND', right: `as at ${dayLabel(today)} · sales in month booked`, rows };
}

function academySubline(academy, today) {
  const comp = academy.complimentary ? ` · +${academy.complimentary} complimentary` : '';
  const src = academy.cache_refreshed_at
    ? ` · Memberstack, synced ${dayMonth(String(academy.cache_refreshed_at).slice(0, 10))} ${new Date(academy.cache_refreshed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London' })}`
    : ' · Memberstack (via Academy cache)';
  return `Trials started: ${academy.trials_28d} in last 28 days (${dayMonth(academy.from28)} – ${dayMonth(today)}) · ${academy.trials_today} today${comp}${src}`;
}

function dayMonth(ymd) {
  return `${Number(ymd.slice(8, 10))} ${MONTHS[Number(ymd.slice(5, 7)) - 1]}`;
}

/** "8 Nov, 16 Nov and 17 Nov". */
function listAnd(items) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Short sale label: event label tidied, grouped by label. */
export function saleLabel(t) {
  const ev = String(t.event_label || '').trim();
  if (Number(t.category_order) === 8) return 'gift card';
  if (Number(t.category_order) === 6) return 'mentoring';
  if (/product\s*shoot/i.test(ev)) return 'product shoot';
  if (/lighto?o?m/i.test(ev) || /lightroom/i.test(t.canonical_product || '')) return 'Lightroom';
  return ev.replace(/\s+x\s+/i, '×').replace(/\.consultation$/i, '') || String(t.category_label || '').replace(/^\d+\.?\s*/, '');
}

export function weekSalesSummary(txns) {
  const sales = (txns || []).filter((t) => Number(t.amount) > 0);
  const byLabel = new Map();
  for (const t of sales) {
    const g = byLabel.get(saleLabel(t)) || { v: 0, order: Number(t.category_order) || 99 };
    g.v += Number(t.amount);
    byLabel.set(saleLabel(t), g);
  }
  const list = [...byLabel.entries()].sort((a, b) => b[1].v - a[1].v || a[1].order - b[1].order).map(([l, g]) => `${l} ${gbp(g.v)}`);
  return { count: sales.length, total: sales.reduce((a, t) => a + Number(t.amount), 0), list };
}

function bookingsLine(nb) {
  if (!nb.people) return { value: 'none', sub: { text: 'no new bookings for future events', tone: 'grey' } };
  const parts = nb.items.map((i) => `${i.name} ${dayMonth(i.date)}${i.jlr ? ' (JLR)' : ''}`);
  if (!nb.workshop_people) parts.push('no new workshop bookings');
  return { value: `${plural(nb.people, 'person', 'people')} · ${gbp(nb.taken)}`, sub: { text: parts.join(' · '), tone: 'grey' } };
}

function academyWeekRow(ac) {
  const started = Number(ac.trials_started_7d) || 0;
  const ended = (Number(ac.lost_7d) || 0) + (Number(ac.converted_7d) || 0);
  return { label: 'Academy trials', value: `${started} started · ${ended} ended`, sub: { text: 'this 7-day week only — 28-day view is in A', tone: started === 0 ? 'red' : 'grey' } };
}

function organicRow(acq) {
  const org = acq?.google_organic?.wow || {};
  const aiw = acq?.ai_assistant?.wow || {};
  return { label: 'Organic visits', value: org.label || '—', sub: { text: `last 28 days vs prior 28 · AI-assistant visits ${aiw.label || '—'}`, tone: Number(org.pct) < 0 ? 'red' : 'grey' } };
}

function trustRow(gate, note) {
  const trusted = !!gate && !gate.held;
  if (trusted) {
    return { label: 'Can you trust these figures?', valueHtml: '<span style="color:#067647">Yes</span>', sub: { text: note, tone: 'grey' } };
  }
  const failed = (gate?.failures || []).map((f) => f.id).join(', ') || 'checks not run';
  return { label: 'Can you trust these figures?', valueHtml: '<span style="color:#b42318">Not yet</span>', sub: { text: `held: ${failed} (section 5)`, tone: 'red' } };
}

/** 15b card B — what changed since last Monday (Mon–Sun just gone). */
export function buildCardB({ metrics, weekSales, newBookings, gate, trustNote, weekStart }) {
  const nb = bookingsLine(newBookings);
  return {
    title: 'B · WHAT CHANGED SINCE LAST MONDAY',
    right: `${dayMonth(addDays(weekStart, -7))} – ${dayMonth(addDays(weekStart, -1))}`,
    rows: [
      { label: 'New sales', value: `${plural(weekSales.count, 'sale', 'sales')} · ${gbp(weekSales.total)}`, sub: weekSales.list.length ? { text: weekSales.list.join(' · '), tone: 'grey' } : null },
      { label: 'New bookings for future events', value: nb.value, sub: nb.sub },
      academyWeekRow(metrics.academy || {}),
      organicRow(metrics.acquisition),
      trustRow(gate, trustNote)
    ]
  };
}

function fillActions(pipeline) {
  const a = FRONT_PAGE.actions;
  return pipeline.windows.flatMap((w) => w.rows)
    .filter((r) => r.days >= a.fillMinDays && r.days <= a.fillMaxDays && r.booked > 0 && (r.cap == null || r.booked < r.cap))
    .map((r) => {
      const jlr = r.who.some((x) => x.jlr);
      const sub = r.cap == null
        ? `${r.booked} booked${jlr ? ' (JLR)' : ''} · places on course not on sheet · ${r.days} days to go`
        : `${r.booked} / ${r.cap} booked · ${plural(r.cap - r.booked, 'place', 'places')} left · ${r.days} days to go`;
      return { value: `${r.name}, ${dayLabel(r.date)}`, sub: { text: sub, tone: 'amber' } };
    });
}

/** Alan 17e: actions stay while their number holds; show how long they've been raised. */
export function weeksRunning(seen, weekStart) {
  if (!seen || seen.last_seen_week < addDays(weekStart, -7)) return 1;
  return Math.round((Date.parse(`${weekStart}T12:00:00Z`) - Date.parse(`${seen.first_seen_week}T12:00:00Z`)) / (7 * DAY_MS)) + 1;
}

const ageText = (n) => (n > 1 ? `raised ${n} weeks running` : 'raised this week');

/** 15b card C — this week's actions (each with the numbers that triggered it). */
export function buildCardC({ pipeline, triggers, seen = new Map(), weekStart }) {
  const rows = [];
  const fills = fillActions(pipeline);
  fills.forEach((f, i) => rows.push({ ...f, labelHtml: i === 0 ? '<b style="color:#101828">Fill booked events</b><br><span style="font-size:11px;color:#98a2b3">places left · 7–90 days ahead</span>' : '' }));
  for (const t of triggers) {
    const age = ageText(weeksRunning(seen.get(t.key), weekStart));
    rows.push({ labelHtml: `<b style="color:#101828">${t.group}</b><br><span style="font-size:11px;color:#98a2b3">${t.tag}</span>`, value: t.title, sub: { text: `Why: ${t.why} · ${age}`, tone: 'red' } });
  }
  return { title: "C · THIS WEEK'S ACTIONS", right: 'doable this week · each backed by a number', rows, action_keys: triggers.map((t) => t.key) };
}

/** After a REAL send only: first/last seen week per action key (a gap of a week restarts the count). */
export async function recordActionsSeen(supabase, propertyUrl, weekStart, keys) {
  if (!keys?.length) return { written: 0 };
  const { data } = await supabase.from('ceo_brief_action_seen').select('action_key, first_seen_week, last_seen_week')
    .eq('property_url', propertyUrl).in('action_key', keys);
  const prev = new Map((data || []).map((r) => [r.action_key, r]));
  const rows = keys.map((k) => {
    const p = prev.get(k);
    const continuing = p && p.last_seen_week >= addDays(weekStart, -7);
    return { property_url: propertyUrl, action_key: k, first_seen_week: continuing ? p.first_seen_week : weekStart, last_seen_week: weekStart };
  });
  const { error } = await supabase.from('ceo_brief_action_seen').upsert(rows, { onConflict: 'property_url,action_key' });
  if (error) throw new Error(`action_seen:${error.message}`);
  return { written: rows.length };
}

export function lastmodFromSitemap(xml, pagePath) {
  const at = String(xml || '').indexOf(`<loc>https://www.alanranger.com/${pagePath}</loc>`);
  if (at < 0) return null;
  const entry = xml.slice(at, xml.indexOf('</url>', at));
  const m = entry.match(/<lastmod>([^<]+)<\/lastmod>/);
  return m ? m[1].slice(0, 10) : null;
}

/** Q2: a page's change date comes from the Squarespace sitemap lastmod. */
export async function sitemapLastmod(pagePath) {
  try {
    const res = await fetch('https://www.alanranger.com/sitemap.xml', { headers: { 'User-Agent': 'AlanCsvBuilders/1.0 (+https://www.alanranger.com)' } });
    if (!res.ok) return null;
    return lastmodFromSitemap(await res.text(), pagePath);
  } catch {
    return null;
  }
}

/** Gift vouchers: in the Christmas months, when last year's Nov–Dec fell below half the year before. */
function voucherTrigger(asOfYmd, voucherByYear, voucherTarget) {
  const year = Number(asOfYmd.slice(0, 4));
  const month = Number(asOfYmd.slice(5, 7));
  const gv = FRONT_PAGE.actions.giftVoucher;
  const ly = voucherByYear[year - 1] || 0;
  const ly2 = voucherByYear[year - 2] || 0;
  if (!gv.months.includes(month) || !(ly2 > 0) || ly >= ly2 * gv.dropShare) return null;
  return { key: 'gift_vouchers_christmas', group: 'Gift vouchers', tag: month === gv.seasonStartMonth ? 'Christmas season starts now' : 'Christmas season',
    title: 'Launch the Christmas voucher push', why: `Nov–Dec ${year - 2} ${gbp(ly2)} · Nov–Dec ${year - 1} ${gbp(ly)} · voucher target ${gbp(voucherTarget)} this month` };
}

/** Academy: live trials, and none of the trials that ended this week converted. */
function academyTrigger(academy) {
  const ended = (academy.lost_7d || 0) + (academy.converted_7d || 0);
  if (!(academy.on_trial > 0) || ended < FRONT_PAGE.actions.academyNudge.minEnded7d || academy.converted_7d) return null;
  const ends = (academy.trial_ends || []).map(dayMonth);
  return { key: 'academy_trial_nudge', group: 'Academy', tag: 'trials ending soon',
    title: `Personal nudge to the ${academy.on_trial} live trial${academy.on_trial === 1 ? '' : 's'} before they end`,
    why: `0 of the last ${ended} trials converted (7d)${ends.length ? ` · trials end ${listAnd(ends)}` : ''}` };
}

/** Measured comparisons → candidate actions (gift vouchers, Academy trials, watched pages). */
export function buildTriggers({ asOfYmd, voucherByYear, voucherTarget, academy, watched }) {
  const pages = (watched || []).map((w) => ({ key: w.key, group: 'Website', tag: w.tag, title: w.label, why: w.why }));
  return [voucherTrigger(asOfYmd, voucherByYear, voucherTarget), academyTrigger(academy), ...pages].filter(Boolean);
}

/** Watched page: last full month vs same month last year. */
export function watchedPageTrigger(cfg, monthly, lastMonthKey) {
  const cur = monthly.find((m) => m.mon === lastMonthKey);
  const lyKey = `${Number(lastMonthKey.slice(0, 4)) - 1}${lastMonthKey.slice(4)}`;
  const ly = monthly.find((m) => m.mon === lyKey);
  if (!cur || !ly || !(ly.clicks > 0) || cur.clicks >= ly.clicks * (1 - cfg.yoyDropShare)) return null;
  const peak = monthly.filter((m) => m.mon >= lyKey).reduce((a, m) => (m.clicks > a.clicks ? m : a), ly);
  const after = monthly.filter((m) => m.mon > peak.mon && m.mon <= lastMonthKey);
  let since = null;
  for (let i = after.length - 1; i >= 0 && after[i].clicks < peak.clicks / 2; i -= 1) since = after[i].mon;
  const mName = monthShort(Number(lastMonthKey.slice(5, 7)));
  const trend = since ? ` · below half its ${monthShort(Number(peak.mon.slice(5, 7)))} ${peak.mon.slice(0, 4)} peak every month since ${monthShort(Number(since.slice(5, 7)))}` : '';
  return { ...cfg, why: `${mName} clicks ${ly.clicks.toLocaleString('en-GB')} (${lyKey.slice(0, 4)}) → ${cur.clicks.toLocaleString('en-GB')} (${lastMonthKey.slice(0, 4)}) · position ${Math.round(ly.pos)} → ${Math.round(cur.pos)}${trend}${cfg.note ? ` · ${cfg.note}` : ''}` };
}

// ---------------- loaders ----------------

function academyClient() {
  const url = String(process.env.ACADEMY_SUPABASE_URL || '').trim();
  const key = String(process.env.ACADEMY_SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

/** Academy month-so-far, 28-day and today trial counts + live trial end dates (academy_trial_history). */
export async function loadAcademyFront(metrics, asOfYmd) {
  const ac = metrics.academy || {};
  const base = {
    paid: ac.current_annual ?? 0, complimentary: ac.current_complimentary ?? 0, on_trial: ac.current_trials ?? 0,
    cache_refreshed_at: ac.cache_refreshed_at || null,
    lost_7d: ac.lost_7d, converted_7d: ac.converted_7d, trial_ends: []
  };
  const from28 = addDays(asOfYmd, -27);
  const monthStart = `${asOfYmd.slice(0, 7)}-01`;
  const sb = academyClient();
  if (!sb) return { ...base, trials_28d: null, trials_today: null, trials_mtd: null, conv_mtd: null, from28, error: 'academy env missing' };
  const { data, error } = await sb.from('academy_trial_history').select('trial_start_at, trial_end_at, converted_at')
    .or(`trial_start_at.gte.${addDays(from28, -1)},trial_end_at.gte.${asOfYmd},converted_at.gte.${monthStart}`);
  if (error) return { ...base, trials_28d: null, trials_today: null, trials_mtd: null, conv_mtd: null, from28, error: error.message };
  const day = (iso) => String(iso || '').slice(0, 10);
  const started = (from, to) => data.filter((t) => day(t.trial_start_at) >= from && day(t.trial_start_at) <= to).length;
  return {
    ...base,
    from28,
    trials_28d: started(from28, asOfYmd),
    trials_today: started(asOfYmd, asOfYmd),
    trials_mtd: started(monthStart, asOfYmd),
    conv_mtd: data.filter((t) => day(t.converted_at) >= monthStart && day(t.converted_at) <= asOfYmd).length,
    trial_ends: data.filter((t) => !t.converted_at && day(t.trial_end_at) >= asOfYmd).map((t) => day(t.trial_end_at)).sort(),
    source: 'academy_trial_history (Academy Supabase, synced from Memberstack)'
  };
}

async function monthlyClicks(supabase, propertyUrl, page, fromYmd) {
  const { data, error } = await supabase.from('gsc_page_timeseries').select('date, clicks, impressions, position')
    .eq('property_url', propertyUrl).eq('page_url', page).gte('date', fromYmd).limit(1000);
  if (error) throw new Error(`watched_page:${error.message}`);
  const by = new Map();
  for (const r of data || []) {
    const k = String(r.date).slice(0, 7);
    const m = by.get(k) || { mon: k, clicks: 0, imp: 0, posw: 0 };
    m.clicks += Number(r.clicks) || 0;
    m.imp += Number(r.impressions) || 0;
    m.posw += (Number(r.position) || 0) * (Number(r.impressions) || 0);
    by.set(k, m);
  }
  return [...by.values()].map((m) => ({ mon: m.mon, clicks: m.clicks, pos: m.imp ? m.posw / m.imp : 0 })).sort((a, b) => a.mon.localeCompare(b.mon));
}

const courseName = (text) => (/lightr?oom/i.test(String(text || '')) ? 'Lightroom course' : 'Beginners course');

/**
 * Course bookings made this week: sale-only courses, Courses-tab rows matched by their sale date
 * (when the tab's date booked is off), and Courses-tab rows booked this week.
 */
export function courseWeekItems(pipeline, courseRows, from, to) {
  const inWeek = (x) => x.txn_date >= from && x.txn_date <= to;
  const fromSales = [...(pipeline.sale_only_attached || []), ...(pipeline.sale_matched_courses || [])].filter(inWeek)
    .map((s) => ({ name: courseName(s.kind), date: s.event_date, jlr: s.jlr, taken: s.amount, workshop: false }));
  const fromTab = (courseRows || []).map((c) => ({
    name: courseName(c.event_name), date: c.from_date, jlr: /jlr/i.test(c.source_bucket || ''), taken: Number(c.paid) || 0, workshop: false
  }));
  return [...fromSales, ...fromTab];
}

/** Sales + course bookings in the Mon–Sun before weekStart; pipeline gives future-event matches. */
export async function loadWeekActivity(supabase, propertyUrl, weekStart, { pipeline, diary }) {
  const from = addDays(weekStart, -7);
  const to = addDays(weekStart, -1);
  const [tx, cs] = await Promise.all([
    supabase.from('booking_sheet_transactions').select('txn_date, amount, event_label, category_order, category_label, canonical_product, is_jlr')
      .eq('property_url', propertyUrl).gte('txn_date', from).lte('txn_date', to).limit(500),
    supabase.from('booking_sheet_course_attendees').select('from_date, date_booked, event_name, paid, source_bucket')
      .eq('property_url', propertyUrl).eq('is_booking_row', true).gte('date_booked', from).lte('date_booked', to).gte('from_date', weekStart).limit(200)
  ]);
  for (const r of [tx, cs]) if (r.error) throw new Error(`week_activity:${r.error.message}`);
  const items = courseWeekItems(pipeline, cs.data, from, to);
  const workshopPeople = (diary || []).filter((e) => e.kind === 'workshop' && Number(e.pace) > 0).reduce((a, e) => a + Number(e.pace), 0);
  return {
    weekSales: weekSalesSummary(tx.data || []),
    newBookings: {
      people: items.length + workshopPeople,
      workshop_people: workshopPeople,
      taken: items.reduce((a, i) => a + i.taken, 0),
      items
    }
  };
}

export async function loadTriggerInputs(supabase, propertyUrl, asOfYmd, salesTabTargets) {
  const year = Number(asOfYmd.slice(0, 4));
  const gv = FRONT_PAGE.actions.giftVoucher;
  const { data: vrows, error } = await supabase.from('booking_sheet_monthly_category').select('year, month, revenue_amount')
    .eq('property_url', propertyUrl).eq('category_order', gv.category).in('year', [year - 2, year - 1]).in('month', gv.months);
  if (error) throw new Error(`voucher_history:${error.message}`);
  const voucherByYear = {};
  for (const r of vrows || []) voucherByYear[r.year] = (voucherByYear[r.year] || 0) + Number(r.revenue_amount || 0);
  const lastMonth = new Date(Date.UTC(year, Number(asOfYmd.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  const watched = [];
  const skipped = [];
  for (const cfg of FRONT_PAGE.actions.watchedPages) {
    const monthly = await monthlyClicks(supabase, propertyUrl, cfg.page, `${Number(lastMonth.slice(0, 4)) - 1}${lastMonth.slice(4)}-01`);
    const hit = watchedPageTrigger(cfg, monthly, lastMonth);
    if (!hit) continue;
    const changed = await sitemapLastmod(cfg.page);
    if (changed && changed >= addDays(asOfYmd, -FRONT_PAGE.actions.suppressDays)) skipped.push({ key: cfg.key, page_changed: changed });
    else watched.push({ ...hit, page_changed: changed });
  }
  const { data: seenRows } = await supabase.from('ceo_brief_action_seen').select('action_key, first_seen_week, last_seen_week')
    .eq('property_url', propertyUrl);
  return {
    voucherByYear,
    voucherTarget: Number(salesTabTargets?.category_targets?.[String(gv.category)] || 0),
    watched,
    website_skipped: skipped,
    seen: new Map((seenRows || []).map((r) => [r.action_key, r]))
  };
}
