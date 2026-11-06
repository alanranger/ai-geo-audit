/**
 * Strategy & Actions S3c / S3d.
 * Lead times: days from the Booking Sheet booking (transaction) date to the event start, rolling 24 months, non-JLR —
 * courses = category 1 matched to the course Week 1 date; day workshops & walks / residentials = categories 2 / 3
 * matched to the workshop start. Quartiles: Announce ≈ 75th percentile, Main push ≈ median, Last places ≈ 25th.
 * Moments: every future event on the site gets the three moments; sold-out events drop them; moments already
 * missed collapse into one "Catch-up" in the current week. Campaign weeks apply the agreed channel rules.
 */
const DAY = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (s, n) => iso(Date.parse(`${s}T12:00:00Z`) + n * DAY);
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export const DEFAULT_CAMPAIGN_RULES = {
  email: { per_week: 1, day: 'Thu', list_size: 940, monthly_cap_sends: 5000, light_and_logic_day: 15, christmas_by: '12-23' },
  facebook_instagram: { days: ['Tue', 'Fri'], shared_prep: true },
  linkedin: { days: ['Wed'], angle: 'tuition / mentoring / Pick n Mix / teaching' },
  youtube: 'reuse published videos only — no production tasks',
  google_business_profile: 'none (Viking Local posts events automatically)',
  outlook_notes: 'ad hoc: catch-up / last places only, after Alan approves'
};

export function mondayOf(isoDate) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(isoDate, -dow);
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Latest matching booking transaction on or before the event, per client (lower-cased name) and category. */
function txnIndex(txns, cats) {
  const by = new Map();
  for (const t of txns || []) {
    if (t.is_jlr || !cats.includes(Number(t.category_order)) || !t.txn_date || !t.client_name) continue;
    const k = norm(t.client_name);
    (by.get(k) || by.set(k, []).get(k)).push(String(t.txn_date).slice(0, 10));
  }
  for (const list of by.values()) list.sort();
  return by;
}
function leadDays(index, client, eventIso) {
  const list = index.get(norm(client)) || [];
  let best = null;
  for (const d of list) if (d <= eventIso) best = d;
  return best ? Math.round((Date.parse(eventIso) - Date.parse(best)) / DAY) : null;
}
function summarise(days) {
  const s = days.filter((d) => d != null && d >= 0).sort((a, b) => a - b);
  const w = (q) => (s.length ? Math.max(1, Math.round(quantile(s, q) / 7)) : null);
  return { n: s.length, announce_weeks: w(0.75), main_push_weeks: w(0.5), last_places_weeks: w(0.25) };
}

export function computeLeadTimes({ txns, courses, workshops }, todayIso) {
  const from = addDays(todayIso, -730);
  const inWindow = (d) => d && d >= from && d <= todayIso;
  const c1 = txnIndex(txns, [1]);
  const c23 = txnIndex(txns, [2, 3]);
  const courseDays = (courses || []).filter((a) => a.source_bucket !== 'JLR' && inWindow(String(a.from_date || '').slice(0, 10)))
    .map((a) => leadDays(c1, a.client_name, String(a.from_date).slice(0, 10)));
  const ws = (workshops || []).filter((a) => a.client_name && inWindow(String(a.event_start || '').slice(0, 10)));
  const wDays = (multi) => ws.filter((a) => !!a.is_multi_day === multi).map((a) => leadDays(c23, a.client_name, String(a.event_start).slice(0, 10)));
  return {
    window: { from, to: todayIso, basis: 'booking (transaction) date → event start, non-JLR, rolling 24 months' },
    course: summarise(courseDays), day: summarise(wDays(false)), residential: summarise(wDays(true))
  };
}

function eventKind(e) {
  if (e.source === 'course') return 'course';
  return e.end && e.end > e.date ? 'residential' : 'day';
}

/** Future events from the site feeds: workshops (day / residential) and Week-1 course dates. */
export function siteEvents(feeds, todayIso) {
  const ws = (feeds?.workshops || []).map((e) => ({ ...e, source: 'workshop' }));
  const cs = (feeds?.courses || []).filter((c) => /week\s*1\s*of/i.test(c.title)).map((c) => ({ ...c, source: 'course' }));
  const seen = new Set();
  return [...ws, ...cs].filter((e) => {
    const k = `${e.date}|${norm(e.title).slice(0, 30)}`;
    if (!e.date || e.date < todayIso || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((e) => ({ ...e, kind: eventKind(e) }));
}

const MOMENTS = [['announce', 'Announce', 'announce_weeks'], ['main_push', 'Main push', 'main_push_weeks'], ['last_places', 'Last places', 'last_places_weeks']];

/** Every event's three moments by week; missed ones → one Catch-up row in this week; sold-out events dropped. */
export function buildMoments(events, leadTimes, todayIso) {
  const thisWeek = mondayOf(todayIso);
  const out = [];
  for (const e of events) {
    if (e.places_left === 0) continue;
    const lt = leadTimes[e.kind] || {};
    const missed = [];
    for (const [id, label, key] of MOMENTS) {
      if (!lt[key]) continue;
      const week = mondayOf(addDays(e.date, -7 * lt[key]));
      const m = { key: `moment|${id}|${e.date}|${norm(e.title).slice(0, 40)}`, moment: id, label, week, event: e };
      if (week < thisWeek) missed.push(m);
      else out.push(m);
    }
    if (missed.length) out.push({ ...missed[missed.length - 1], key: `catchup|${e.date}|${norm(e.title).slice(0, 40)}`, moment: 'catch_up', label: `Catch-up (${missed.map((m) => m.label).join(', ')})`, week: thisWeek });
  }
  return out.sort((a, b) => a.week.localeCompare(b.week) || a.event.date.localeCompare(b.event.date));
}

const DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const PRIORITY = { last_places: 0, catch_up: 1, main_push: 2, announce: 3 };

function emailDay(week, rules) {
  let day = addDays(week, DOW[rules.email.day] ?? 3);
  const xmas = `${week.slice(0, 4)}-${rules.email.christmas_by}`;
  if (xmas >= week && xmas <= addDays(week, 6) && day > xmas) day = xmas;
  return day;
}
function containsDay(week, dom) {
  return [0, 1, 2, 3, 4, 5, 6].some((i) => Number(addDays(week, i).slice(8, 10)) === dom);
}
function featured(moments) {
  return [...moments].sort((a, b) => (PRIORITY[a.moment] - PRIORITY[b.moment]) || a.event.date.localeCompare(b.event.date));
}

/** One week's steps: day · channel · step · featured events (top two leads + supporting mentions). */
export function weekSteps(week, moments, rules = DEFAULT_CAMPAIGN_RULES) {
  const ms = featured(moments.filter((m) => m.week === week));
  const leads = ms.slice(0, 2);
  const support = ms.slice(2);
  const lastPlaces = ms.filter((m) => m.moment === 'last_places' || m.moment === 'catch_up');
  const ll = containsDay(week, rules.email.light_and_logic_day) ? ' + Light & Logic (folded in, no separate send)' : '';
  const steps = [
    { day: addDays(week, DOW.Tue), channel: 'Facebook + Instagram', step: 'Prepare both posts (one task); publish the useful / result-led post', covers: leads },
    { day: addDays(week, DOW.Wed), channel: 'LinkedIn', step: `One post: ${rules.linkedin.angle} angle`, covers: leads.slice(0, 1) },
    { day: emailDay(week, rules), channel: 'Squarespace email (full list)', step: `Weekly email: top two leads + supporting mentions${ll}`, covers: [...leads, ...support], is_email: true },
    { day: addDays(week, DOW.Fri), channel: 'Facebook + Instagram', step: 'Publish the direct-offer post', covers: leads }
  ];
  if (lastPlaces.length) steps.push({ day: week, channel: 'Outlook personal notes', step: 'Catch-up / last places notes to past clients (after you approve)', covers: lastPlaces });
  return steps.sort((a, b) => a.day.localeCompare(b.day)).map((s) => ({ ...s, key: `step|${week}|${s.channel}|${s.day}`, covers: s.covers.map((m) => m.key), featured: s.covers.map((m) => ({ title: m.event.title, date: m.event.date, url: m.event.url, places_left: m.event.places_left, moment: m.label })) }));
}

/** Channel rules: Targets panel (business_targets.campaign_targets) over the agreed defaults. */
export function campaignRules(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  return {
    ...DEFAULT_CAMPAIGN_RULES, ...s,
    email: { ...DEFAULT_CAMPAIGN_RULES.email, ...(s.email || {}) },
    facebook_instagram: { ...DEFAULT_CAMPAIGN_RULES.facebook_instagram, ...(s.facebook_instagram || {}) },
    linkedin: { ...DEFAULT_CAMPAIGN_RULES.linkedin, ...(s.linkedin || {}) }
  };
}

export async function loadCampaignTicks(supabase, propertyUrl) {
  const { data, error } = await supabase.from('strategy_campaign_ticks').select('tick_key, is_ticked, ticked_at').eq('property_url', propertyUrl).limit(5000);
  if (error) throw new Error(error.message);
  return Object.fromEntries((data || []).map((r) => [r.tick_key, { is_ticked: r.is_ticked, ticked_at: r.ticked_at }]));
}

/** Full-list sends this calendar month = email steps ticked as sent × list size (vs the plan's monthly cap). */
export function sendsThisMonth(ticks, todayIso, rules) {
  const month = todayIso.slice(0, 7);
  const sent = Object.entries(ticks || {}).filter(([k, v]) => v.is_ticked && k.startsWith('step|') && k.includes('|Squarespace email') && k.slice(-10).startsWith(month)).length;
  return { emails_sent: sent, sends: sent * rules.email.list_size, cap: rules.email.monthly_cap_sends, list_size: rules.email.list_size, month };
}

export async function buildCampaignBlock(supabase, propertyUrl, { txns, courses, workshops, feeds, targets, today }) {
  const rules = campaignRules(targets?.campaign_targets);
  const leadTimes = computeLeadTimes({ txns, courses, workshops }, today);
  const moments = buildMoments(siteEvents(feeds, today), leadTimes, today);
  const ticks = await loadCampaignTicks(supabase, propertyUrl).catch(() => ({}));
  return {
    lead_times: leadTimes, rules, ticks,
    moments: moments.filter((m) => m.week <= addDays(mondayOf(today), 7 * 26)),
    weeks: campaignWeeks(moments, today, 4, rules),
    sends: sendsThisMonth(ticks, today, rules)
  };
}

export function campaignWeeks(moments, todayIso, weeks = 4, rules = DEFAULT_CAMPAIGN_RULES) {
  const start = mondayOf(todayIso);
  return Array.from({ length: weeks }, (_, i) => {
    const week = addDays(start, i * 7);
    return { week, moments: moments.filter((m) => m.week === week), steps: weekSteps(week, moments, rules) };
  });
}
