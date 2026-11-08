/**
 * Strategy & Actions S3c / S3d.
 * Lead times: days from the Booking Sheet booking (transaction) date to the event start, rolling 24 months, non-JLR —
 * courses = category 1 matched to the course Week 1 date; day workshops & walks / residentials = categories 2 / 3
 * matched to the workshop start. Quartiles: Announce ≈ 75th percentile, Main push ≈ median, Last places ≈ 25th.
 * Moments: every future event on the site gets the three moments; sold-out events drop them; moments already
 * missed collapse into one "Catch-up" in the current week. Campaign weeks apply the agreed channel rules.
 */
import { applyOverrides, buildCampaignRecords, campaignSheets, emailLinks, eventKeyOf, loadCampaignRows, loadOverrides, loadSqsCampaigns, loadTaggedSessions, sendsFromRecords } from './strategy-campaigns.mjs';
import { boardWeek, byDay, googleBusinessExceptions, placesIndex, stepsFromRows } from './strategy-board-rows.mjs';
import { addTargetedSteps, applyStepStatus, dropRepeats, loadAudienceLists, loadStepRegister, saveStepRegister } from './strategy-step-status.mjs';

const DAY = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (s, n) => iso(Date.parse(`${s}T12:00:00Z`) + n * DAY);
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export const DEFAULT_CAMPAIGN_RULES = {
  email: { per_week: 1, day: 'Thu', list_size: 940, monthly_cap_sends: 5000, light_and_logic_day: 15, christmas_by: '12-23' },
  facebook_instagram: { days: ['Tue', 'Fri'], shared_prep: true },
  linkedin: { days: ['Wed'], angle: 'tuition / mentoring / Pick n Mix / teaching' },
  youtube: 'reuse published videos only — no production tasks',
  google_business_profile: 'Viking Local posts blogs, events and images automatically · weekly 5–10 min check · an exception update only for an approved offer or last places',
  google_business: { check_day: 'Mon', from: '2026-11-09' },
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
  const d = (q) => (s.length ? Math.round(quantile(s, q)) : null);
  return { n: s.length, q25_days: d(0.25), median_days: d(0.5), q75_days: d(0.75), announce_weeks: w(0.75), main_push_weeks: w(0.5), last_places_weeks: w(0.25) };
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
    if (!e.date || e.date <= todayIso || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map((e) => ({ ...e, kind: eventKind(e) }));
}

const MOMENTS = [['announce', 'Announce', 'announce_weeks'], ['main_push', 'Main push', 'main_push_weeks'], ['last_places', 'Last places', 'last_places_weeks']];

/** "Promote every week until the date": one Weekly mention per week with no other moment for the event. */
function weeklyMentions(e, taken, thisWeek) {
  const out = [];
  const last = mondayOf(e.date);
  for (let w = thisWeek, i = 0; w <= last && i < 26; w = addDays(w, 7), i += 1) {
    if (!taken.has(w)) out.push({ key: `moment|weekly|${w}|${e.date}|${norm(e.title).slice(0, 40)}`, moment: 'weekly', label: 'Weekly mention', week: w, event: e });
  }
  return out;
}

const RANK = { last_chance: 0, last_places: 1, main_push: 2, weekly: 3, announce: 4 };

/** Places left: Booking Sheet booked vs capacity (diary) when known; otherwise only an explicit "sold out" on the site. */
function noPlacesLeft(e, places) {
  const p = places?.get?.(e.event_key);
  if (p && p.cap) return p.cap - p.booked <= 0;
  return e.places_left === 0;
}
/** One row per event per week: the most urgent moment wins. */
function onePerWeek(list) {
  const best = new Map();
  for (const m of list) {
    const k = m.week;
    if (!best.has(k) || RANK[m.moment] < RANK[best.get(k).moment]) best.set(k, m);
  }
  return [...best.values()];
}
function eventMoments(e, lt, thisWeek) {
  const all = MOMENTS.filter(([, , key]) => lt[key]).map(([id, label, key]) => ({ key: `moment|${id}|${e.date}|${norm(e.title).slice(0, 40)}`, moment: id, label, week: mondayOf(addDays(e.date, -7 * lt[key])), event: e }));
  const ahead = all.filter((m) => m.week >= thisWeek);
  if (ahead.length || !all.length) return ahead;
  return [{ key: `lastchance|${e.date}|${norm(e.title).slice(0, 40)}`, moment: 'last_chance', label: 'Last chance', week: thisWeek, event: e }];
}

/**
 * Every event's moments by week. A missed moment is dropped when a later one is still to come; only when all are past
 * (event still ahead, places left) does it get one "Last chance" row this week. Never more than one row per event per
 * week. Events dated today or earlier, with no places left, or set to "don't promote" get none.
 */
export function buildMoments(events, leadTimes, todayIso, places = null) {
  const thisWeek = mondayOf(todayIso);
  const out = [];
  for (const e of events) {
    if (e.date <= todayIso || e.promote_mode === 'dont_promote' || noPlacesLeft(e, places)) continue;
    const own = eventMoments(e, leadTimes[e.kind] || {}, thisWeek);
    if (e.promote_mode === 'weekly') own.push(...weeklyMentions(e, new Set(own.map((m) => m.week)), thisWeek));
    out.push(...onePerWeek(own));
  }
  return out.sort((a, b) => a.week.localeCompare(b.week) || a.event.date.localeCompare(b.event.date));
}

const DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export function emailDay(week, rules) {
  let day = addDays(week, DOW[rules.email.day] ?? 3);
  const xmas = `${week.slice(0, 4)}-${rules.email.christmas_by}`;
  if (xmas >= week && xmas <= addDays(week, 6) && day > xmas) day = xmas;
  return day;
}

/** Channel rules: Targets panel (business_targets.campaign_targets) over the agreed defaults. */
export function campaignRules(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  return {
    ...DEFAULT_CAMPAIGN_RULES, ...s,
    email: { ...DEFAULT_CAMPAIGN_RULES.email, ...(s.email || {}) },
    facebook_instagram: { ...DEFAULT_CAMPAIGN_RULES.facebook_instagram, ...(s.facebook_instagram || {}) },
    linkedin: { ...DEFAULT_CAMPAIGN_RULES.linkedin, ...(s.linkedin || {}) },
    google_business: { ...DEFAULT_CAMPAIGN_RULES.google_business, ...(s.google_business || {}) }
  };
}

export async function loadCampaignTicks(supabase, propertyUrl) {
  const { data, error } = await supabase.from('strategy_campaign_ticks').select('tick_key, is_ticked, ticked_at, moved_to, status, reason, set_by, set_at, history').eq('property_url', propertyUrl).limit(5000);
  if (error) throw new Error(error.message);
  return Object.fromEntries((data || []).map((r) => [r.tick_key, {
    is_ticked: r.is_ticked, ticked_at: r.ticked_at, moved_to: r.moved_to || null, status: r.status || null, reason: r.reason || null,
    set_by: r.set_by || null, set_at: r.set_at || null, history: (r.history || []).slice(-10)
  }]));
}

function categoryLabels(txns) {
  const out = {};
  for (const t of txns || []) if (t.category_order && t.category_label && Number(t.category_order) !== 9) out[Number(t.category_order)] = t.category_label;
  return out;
}
const soft = (p, fallback) => p.catch((e) => ({ __error: e?.message || String(e), fallback })).then((v) => (v && v.__error ? { value: v.fallback, error: v.__error } : { value: v }));

/** Evidence the step rules read (lib/strategy-step-status.mjs). `cancelled`: Map event_key → reason (cancellations hook). */
function statusContext({ ticks, records, sqs, audience, rows, events, places, overrides, actions, today, cancelled }) {
  return {
    today, ticks, audience, sqs, places, overrides, cancelled: cancelled || new Map(), checkedAt: new Date().toISOString(),
    recordsByKey: new Map(records.map((r) => [r.campaign_key, r])), sqsById: new Map(sqs.map((c) => [c.email_id, c])),
    listed: new Set(events.map((e) => e.event_key)), zeroLeft: new Set(events.filter((e) => e.places_left === 0).map((e) => e.event_key)),
    actionsById: new Map((actions || []).map((a) => [String(a.id), a])), ...emailLinks(rows)
  };
}

export async function buildCampaignBlock(supabase, propertyUrl, { txns, courses, workshops, feeds, targets, today, diary, actions, cancelled, registerSteps = true }) {
  const rules = campaignRules(targets?.campaign_targets);
  const leadTimes = computeLeadTimes({ txns, courses, workshops }, today);
  const [ticks, overrides, rows, ga4, sqs, register, audience] = await Promise.all([
    soft(loadCampaignTicks(supabase, propertyUrl), {}),
    soft(loadOverrides(supabase, propertyUrl, today), {}),
    soft(loadCampaignRows(supabase, propertyUrl, today), []),
    soft(loadTaggedSessions(supabase, propertyUrl, addDays(today, -200)), []),
    soft(loadSqsCampaigns(supabase), []),
    soft(loadStepRegister(supabase, propertyUrl, today), []),
    soft(loadAudienceLists(supabase), null)
  ]);
  const events = applyOverrides(siteEvents(feeds, today), overrides.value, today);
  const places = placesIndex(diary, eventKeyOf);
  const moments = buildMoments(events, leadTimes, today, places);
  const weeks = campaignWeeks(moments, today, 4, rules, { places, actions });
  dropRepeats(weeks, register.value);
  const saved = registerSteps && weeks[0] ? await soft(saveStepRegister(supabase, propertyUrl, weeks[0]), 0) : { value: 0 };
  const records = buildCampaignRecords({ weeks, moments, events, leadTimes, rows: rows.value, txns, sheets: campaignSheets(txns, courses, workshops), ga4: ga4.value, sqs: sqs.value, audience: audience.value, ticks: ticks.value, today });
  const sctx = statusContext({ ticks: ticks.value, records, sqs: sqs.value, audience: audience.value, rows: rows.value, events, places, overrides: overrides.value, actions, today, cancelled });
  addTargetedSteps(weeks, records, rows.value, sctx.sqsById);
  const { carried, summary } = applyStepStatus(weeks, sctx, register.value);
  return {
    lead_times: leadTimes, rules, ticks: ticks.value, overrides: overrides.value,
    moments: moments.filter((m) => m.week <= addDays(mondayOf(today), 7 * 26)),
    weeks, carried, step_status: { ...summary, registered: saved.value }, campaigns: records, category_labels: categoryLabels(txns),
    sends: sendsFromRecords(records, today, rules),
    load_errors: [ticks, overrides, rows, ga4, sqs, register, audience, saved].map((r) => r.error).filter(Boolean)
  };
}

/** Four weeks from this Monday: board rows (≤6 + "more") and the campaign steps built from the same rows. */
export function campaignWeeks(moments, todayIso, weeks = 4, rules = DEFAULT_CAMPAIGN_RULES, opts = {}) {
  const start = mondayOf(todayIso);
  const ctx = { todayIso, rules, emailDay, places: opts.places || new Map(), actions: opts.actions || [] };
  const boards = Array.from({ length: weeks }, (_, i) => {
    const week = addDays(start, i * 7);
    const ms = moments.filter((m) => m.week === week);
    return { week, ms, board: boardWeek(week, ms, ctx) };
  });
  const gbp = googleBusinessExceptions(boards, rules, todayIso);
  return boards.map(({ week, ms, board }) => ({
    week, moments: ms, rows: board.rows, more: board.more,
    steps: [...stepsFromRows(week, board, rules, todayIso), ...(gbp.get(week) || [])].sort(byDay)
  }));
}
