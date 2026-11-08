/**
 * Strategy & Actions "Next 4 weeks" rows and "Campaign steps", both built from the same week rows.
 * Row: due day · channel chips · stage (Announce / Main push / Last places / Last chance / Plan) · short name + UK date ·
 * places (Booking Sheet booked of capacity, from the diary) · +£ GP if full · tick. At most 6 rows a week; announcements
 * for events more than a quarter away share one row; the rest go under "+N more" (lowest £ hidden first).
 * Channels (agreed timetable): every commercial lead in that week's Thursday email; Facebook + Instagram for the week's
 * two leads (Tue useful post) and for last places / last chance (Fri offer post); LinkedIn Wed for courses; an Outlook
 * personal note for last places / last chance. Google Business is not a board chip: Viking Local posts automatically;
 * the steps get a weekly "Google Business check" and at most one optional exception update per campaign.
 */
const DAY = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const addDays = (s, n) => iso(Date.parse(`${s}T12:00:00Z`) + n * DAY);
const utc = (s) => new Date(`${s}T12:00:00Z`);
const MON = (s) => utc(s).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
const WD = (s) => utc(s).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
const DOM = (s) => utc(s).getUTCDate();
export const ukDay = (s) => `${WD(s)} ${DOM(s)} ${MON(s)}`;

export const STAGE = { announce: 'Announce', main_push: 'Main push', last_places: 'Last places', last_chance: 'Last chance', weekly: 'Weekly mention', plan: 'Plan' };
const PRIORITY = { last_chance: 0, last_places: 1, main_push: 2, weekly: 3, announce: 4 };
const OFFERISH = new Set(['last_places', 'last_chance']);
const MAX_ROWS = 6;

/* ---------- names and dates ---------- */

const SEASON = /^(winter|spring|summer|autumn|late|nov|dec|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|wales|solihull|warwickshire|landscape photography|sunset|sunrise)$/i;
const TECHNIQUE = /^(long exposure|sunset)$/i;
const clean = (s) => String(s || '').replace(/\b\d{1,2}[-/]\d{1,2}\b/g, '').replace(/\s+/g, ' ').trim();
function segments(title) {
  return String(title || '').split(/\s+[|–-]\s+|\s*\|\s*/).map(clean).filter(Boolean);
}
function headName(seg) {
  let h = seg.replace(/\s*photo(graphy|graphic)?\b.*$/i, '').replace(/,.*$/, '').replace(/\b(landscape|seascape|autumn|winter|spring|summer)\b/gi, '').replace(/\s+and\s+/i, ' & ');
  h = clean(h);
  return h.split(' ').slice(0, 3).join(' ');
}
function placeAfter(segs) {
  return segs.slice(1).map((s) => clean(s.replace(/\b(sunset|sunrise)\b/gi, ''))).find((s) => s && !SEASON.test(s)) || '';
}
function courseName(t) {
  if (/lightroom/i.test(t)) return 'Lightroom course';
  return /beginner/i.test(t) ? 'Beginners course' : `${headName(segments(t)[0])} course`;
}
function walkOrMasterclass(t, segs) {
  if (/\bwalk\b/i.test(t)) return `${[...segs.slice(1)].reverse().find((s) => !SEASON.test(s)) || headName(segs[0])} walk`;
  if (/masterclass/i.test(t)) return `${/woodland/i.test(t) ? 'Woodland' : headName(segs[0])} masterclass`;
  return null;
}
/** "Beginners course", "Hay Woods walk", "Abstract & Macro", "Kenilworth long exposure", "Lake Vyrnwy". */
export function shortName(e) {
  const t = String(e?.title || '');
  if (e?.kind === 'course' || /week\s*\d+\s*of/i.test(t)) return courseName(t);
  const segs = segments(t);
  const special = walkOrMasterclass(t, segs);
  if (special) return special;
  const head = headName(segs[0]);
  if (TECHNIQUE.test(head)) {
    const place = placeAfter(segs);
    return place ? `${place} ${head.toLowerCase()}` : head;
  }
  if (/^wales$/i.test(head)) return clean(t.replace(/^.*workshop\s*/i, '')).split(' ').slice(-2).join(' ') || head;
  return head || clean(t).slice(0, 30);
}
/** "starts Tue 1 Dec" (course), "20–22 Nov" (residential), "Sat 28 Nov" (day). */
export function whenLabel(e) {
  if (e?.kind === 'course') return `starts ${ukDay(e.date)}`;
  if (e?.end && e.end > e.date) return MON(e.date) === MON(e.end) ? `${DOM(e.date)}–${DOM(e.end)} ${MON(e.end)}` : `${DOM(e.date)} ${MON(e.date)}–${DOM(e.end)} ${MON(e.end)}`;
  return ukDay(e.date);
}

/* ---------- places from the diary (Booking Sheet booked, not shop stock) ---------- */

export function placesIndex(diary, keyOf) {
  const m = new Map();
  for (const r of diary || []) {
    if (r.is_subrow || !r.date) continue;
    const k = keyOf({ date: r.date, url: r.url, title: r.title });
    if (m.has(k)) continue;
    const full = r.gp_full_free ?? r.gp_full;
    const now = r.gp_now_free ?? r.gp_now;
    const gain = Number.isFinite(full) && Number.isFinite(now) ? Math.max(0, Math.round(full - now)) : null;
    m.set(k, { booked: Number(r.booked) || 0, cap: Number(r.cap) || null, gain });
  }
  return m;
}

/* ---------- rows ---------- */

function momentRow(m, places) {
  const e = m.event;
  const p = places.get(e.event_key) || null;
  return {
    type: 'moment', moment: m.moment, stage: STAGE[m.moment] || m.label, keys: [m.key], event_key: e.event_key,
    name: shortName(e), when: whenLabel(e), date: e.date, title: e.title, url: e.url, kind: e.kind,
    booked: p?.booked ?? null, cap: p?.cap ?? null, gain: p?.gain ?? null, offer: e.offer || null, promote_mode: e.promote_mode || 'normal'
  };
}
function groupFarAnnouncements(rows, todayIso) {
  const far = addDays(todayIso, 91);
  const farRows = rows.filter((r) => r.moment === 'announce' && r.date > far);
  if (farRows.length < 2) return rows;
  const group = {
    type: 'announce_group', moment: 'announce', stage: 'Announce', keys: farRows.flatMap((r) => r.keys),
    name: farRows.map((r) => `${r.name} ${r.when}`).join(' · '), when: 'next quarter and beyond', date: farRows[0].date,
    items: farRows, gain: farRows.reduce((s, r) => s + (r.gain || 0), 0) || null, kind: 'group'
  };
  return [...rows.filter((r) => !farRows.includes(r)), group];
}
const byLead = (a, b) => (PRIORITY[a.moment] - PRIORITY[b.moment]) || ((b.gain || 0) - (a.gain || 0)) || a.date.localeCompare(b.date);

function channelDays(week, rules, emailDay) {
  return { Email: emailDay(week, rules), 'FB+IG useful': addDays(week, 1), 'FB+IG offer': addDays(week, 4), LinkedIn: addDays(week, 2), Outlook: week };
}
function rowChannels(r, isLead) {
  const ch = ['Email'];
  if (OFFERISH.has(r.moment)) ch.push('FB+IG offer', 'Outlook');
  else if (isLead) ch.push('FB+IG useful');
  if (r.kind === 'course') ch.push('LinkedIn');
  return ch;
}
const clampDay = (d, todayIso, week) => (d < todayIso && todayIso <= addDays(week, 6) ? todayIso : d);
function dueOf(channels, days, todayIso, week) {
  return channels.map((c) => clampDay(days[c], todayIso, week)).sort()[0];
}
const CHIP = { Email: 'Email', 'FB+IG useful': 'FB+IG', 'FB+IG offer': 'FB+IG', LinkedIn: 'LinkedIn', Outlook: 'Outlook' };

function planRows(week, actions, todayIso) {
  const end = addDays(week, 7);
  const thisWeek = week <= todayIso && todayIso < end;
  return (actions || []).filter((a) => !a.is_ticked && a.status !== 'waiting' && a.due_week_start && (a.due_week_start >= week && a.due_week_start < end || (thisWeek && a.due_week_start < week)))
    .map((a) => ({
      type: 'plan', moment: 'plan', stage: 'Plan', id: a.id, name: a.label, when: a.due_week_start < week ? `overdue since ${ukDay(a.due_week_start)}` : 'quarter card',
      overdue: a.due_week_start < week, planned: a.due_week_start, due: clampDay(a.due_week_start < week ? todayIso : a.due_week_start, todayIso, week), chips: [], is_ticked: !!a.is_ticked
    }));
}

/** One week of the board: plan actions first, then up to 6 rows in all, the rest under "+N more". */
export function boardWeek(week, weekMoments, ctx) {
  const { todayIso, rules, emailDay, places, actions } = ctx;
  const days = channelDays(week, rules, emailDay);
  const rows = groupFarAnnouncements(weekMoments.map((m) => momentRow(m, places)), todayIso).sort(byLead);
  const leads = new Set(rows.filter((r) => r.type === 'moment').slice(0, 2));
  for (const r of rows) {
    const ch = r.type === 'announce_group' ? ['Email'] : rowChannels(r, leads.has(r));
    r.channels = ch;
    r.chips = [...new Set(ch.map((c) => CHIP[c]))];
    r.planned = ch.map((c) => days[c]).sort()[0];
    r.due = dueOf(ch, days, todayIso, week);
    r.moved = r.due !== r.planned;
    r.offer = offerOn(r.offer, r.due);
    r.is_lead = leads.has(r);
  }
  const plans = planRows(week, actions, todayIso);
  const room = Math.max(0, MAX_ROWS - plans.length);
  const keep = [...rows].sort((a, b) => (b.gain || 0) - (a.gain || 0) || byLead(a, b)).slice(0, room);
  const order = (a, b) => a.due.localeCompare(b.due) || byLead(a, b);
  return {
    rows: [...plans.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.due.localeCompare(b.due)), ...keep.sort(order)],
    more: rows.filter((r) => !keep.includes(r)).sort((a, b) => (b.gain || 0) - (a.gain || 0)),
    all: rows, days
  };
}

/* ---------- campaign steps from the same rows ---------- */

/** An offer only rides on work dated on or before its end date; after that the event is promoted at full price. */
export const offerOn = (offer, day) => (offer && (!offer.ends || !day || day <= offer.ends) ? offer : null);

function featured(r, day) {
  return { name: r.name, when: r.when, stage: r.stage, moment: r.stage, title: r.title || r.name, date: r.date, url: r.url || null, event_key: r.event_key || null, booked: r.booked, cap: r.cap, offer: offerOn(r.offer, day), promote_mode: r.promote_mode || 'normal', items: r.items || null };
}
/**
 * One step on one day. `scheduled_day` is the planned day from the timetable and never changes; when that day has
 * already passed this week, `day` is the next day left in the week and `moved` says so (shown beside the original).
 */
function step(week, channel, day, text, covers, todayIso, extra = {}) {
  const due = clampDay(day, todayIso, week);
  return { key: `step|${week}|${channel}|${day}`, day: due, scheduled_day: day, moved: due !== day, channel, step: text, covers: covers.flatMap((r) => r.keys || []), featured: covers.map((r) => featured(r, due)), ...extra };
}
const placesLeft = (r) => (r.cap ? Math.max(0, r.cap - (r.booked || 0)) : null);
const lastLine = (r) => {
  const n = placesLeft(r);
  if (n === 1) return 'Last place';
  return n && n <= 4 ? `Last ${n} places` : (r.moment === 'last_chance' ? 'Last chance' : 'Last places');
};
const nameWhen = (r) => `${r.name} ${r.when}`.trim();
const listNames = (rows) => rows.map(nameWhen).join(' · ');
const priceLine = (r, day) => { const o = offerOn(r.offer, day); return o ? `offer: ${o.note}` : 'full price'; };

/** Outlook (BCC): one short personal note covering this week's last places / last chance dates. */
function outlookStep(week, d, offers, todayIso) {
  const lead = offers[0];
  const text = `Personal note to past clients: "${lastLine(lead)} ${nameWhen(lead)}"${offers.length > 1 ? ` + ${offers.length - 1} more` : ''}`;
  return step(week, 'Outlook personal notes', d.Outlook, text, offers, todayIso, { brief: `Short, personal, after you approve the names: ${offers.map((r) => `${lastLine(r).toLowerCase()} ${nameWhen(r)}`).join(' · ')}` });
}
/** Facebook + Instagram direct post per last-places date (at most two), with the kind of image and the link. */
function offerPostSteps(week, d, offers, todayIso) {
  return offers.slice(0, 2).map((r, i) => {
    const s = step(week, 'Facebook + Instagram', d['FB+IG offer'], `Post: "${lastLine(r)}" for ${nameWhen(r)}`, [r], todayIso, { brief: `One image from a past ${r.kind === 'course' ? 'course' : r.name} ${r.kind === 'course' ? 'session' : 'trip'} · ${priceLine(r, d['FB+IG offer'])} · link to the product page` });
    return i ? { ...s, key: `${s.key}|${i}` } : s;
  });
}
/** Facebook + Instagram useful / result-led post for the week's lead date. */
function usefulPostStep(week, d, leads, todayIso) {
  const r = leads.find((x) => !OFFERISH.has(x.moment)) || leads[0];
  if (!r) return step(week, 'Facebook + Instagram', d['FB+IG useful'], 'Post: one useful photography tip (no dated event to promote this week)', [], todayIso, { brief: 'A recent image + the tip in two lines · link to a related blog post or the Pick n Mix plans' });
  const n = placesLeft(r);
  return step(week, 'Facebook + Instagram', d['FB+IG useful'], `Post: ${nameWhen(r)}`, [r], todayIso, { brief: `Carousel of past ${r.name} images${n != null ? ` · "${n} of ${r.cap} places left"` : ''} · link to the product page` });
}
function emailStep(week, d, all, leads, rules, todayIso) {
  const ll = [0, 1, 2, 3, 4, 5, 6].some((i) => DOM(addDays(week, i)) === rules.email.light_and_logic_day) ? ' · Light & Logic folded in (no separate send)' : '';
  const rest = all.filter((r) => !leads.includes(r));
  const by = (m) => rest.filter((r) => r.moment === m || (m === 'announce' && r.type === 'announce_group'));
  const parts = [leads.length ? `Lead: ${listNames(leads)}` : '', by('announce').length ? `then announce ${listNames(by('announce'))}` : '', by('last_places').length ? `last places ${listNames(by('last_places'))}` : ''].filter(Boolean);
  const headline = leads.map((r) => r.name).join(', ') || 'this week\'s dates';
  return step(week, 'Squarespace email', d.Email, `Main email of the week: "${headline}"`, [...leads, ...rest], todayIso, { is_email: true, lead_names: leads.map((r) => r.name), brief: `${parts.join(' · ')}${ll}` });
}
function linkedInStep(week, d, courses, rules, todayIso) {
  const r = courses[0];
  if (!r) return step(week, 'LinkedIn', d.LinkedIn, `Post: ${rules.linkedin.angle.split(' / ')[0]} (no course date this week)`, [], todayIso, { brief: `${rules.linkedin.angle} angle · link to the tuition or Pick n Mix page` });
  return step(week, 'LinkedIn', d.LinkedIn, `Post: ${nameWhen(r)}`, courses.slice(0, 2), todayIso, { brief: `${rules.linkedin.angle} angle · link to the course page` });
}
/** Quarter-card actions due this week (or overdue) appear as their own steps. */
function planSteps(week, board, todayIso) {
  return (board.rows || []).filter((r) => r.type === 'plan').map((r) => ({
    key: `plan|${r.id}`, day: r.due, scheduled_day: r.planned || r.due, moved: !!r.planned && r.planned !== r.due, late: !!r.overdue, channel: 'Quarter action', step: r.name,
    brief: r.overdue ? `Quarter card action, ${r.when}` : 'Quarter card action', covers: [], featured: [], plan_id: r.id
  }));
}

/* ---------- Google Business (Viking Local posts automatically; Alan checks weekly, exceptions only) ---------- */

const DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
export const GBP_FROM = '2026-11-09';
/** Weekly manual check from the week of 9 Nov (decided 8 Nov). Late = amber like any manual step. */
function gbpCheckStep(week, rules, todayIso) {
  const g = rules.google_business || {};
  if (week < (g.from || GBP_FROM)) return null;
  return step(week, 'Google Business', addDays(week, DOW[g.check_day] ?? 0), 'Google Business check (5–10 min)', [], todayIso, {
    gbp: 'check', brief: 'Viking Local posted this week\'s blogs, events and images correctly · live offers, dates and booking links right · new reviews checked (ChatGPT drafts any reply, Alan approves) · nothing is posted from the dashboard'
  });
}
const exceptionRow = (r) => r.type === 'moment' && (OFFERISH.has(r.moment) || !!(r.offer?.code && r.offer?.ends));
function exceptionStep(week, d, r, todayIso) {
  const o = r.offer?.code && r.offer?.ends ? r.offer : null;
  const what = o ? `${o.note} · ${nameWhen(r)}` : `${lastLine(r)} ${nameWhen(r)}`;
  const missing = o ? `the code ${o.code} and the end date ${ukDay(o.ends)}` : 'the places left';
  const s = step(week, 'Google Business', d['FB+IG offer'], `Google Business update: ${what}`, [r], todayIso, {
    gbp: 'exception', optional: true, brief: `Optional: only if Viking Local's post for this date leaves out ${missing} or the booking link · ChatGPT drafts (reuse the campaign image and copy), Alan approves and posts · check it isn't already posted`
  });
  return { ...s, key: `step|gbp|${r.event_key}`, covers: [] };
}
/**
 * At most one optional "Google Business update" per campaign (event), in the first week it has an approved offer
 * (code + end date) or a last places / last chance moment. Never repeated weekly (later weeks skip the event;
 * lib/strategy-step-status.mjs dropRepeats keeps it to its first registered week).
 */
export function googleBusinessExceptions(boards, rules, todayIso) {
  const from = rules.google_business?.from || GBP_FROM;
  const seen = new Set();
  const out = new Map();
  for (const { week, board } of boards) {
    if (week < from) continue;
    const list = board.all.filter((r) => exceptionRow(r) && !seen.has(r.event_key)).sort(byLead);
    list.forEach((r) => seen.add(r.event_key));
    out.set(week, list.map((r) => exceptionStep(week, board.days, r, todayIso)));
  }
  return out;
}

export const byDay = (a, b) => a.day.localeCompare(b.day) || a.scheduled_day.localeCompare(b.scheduled_day);
/** Outlook (last places), FB+IG useful (Tue) + direct posts (Fri), LinkedIn (courses), the week's email, quarter actions, Google Business check. */
export function stepsFromRows(week, board, rules, todayIso) {
  const all = board.all;
  const leads = all.filter((r) => r.is_lead);
  const offers = all.filter((r) => OFFERISH.has(r.moment));
  const courses = all.filter((r) => r.kind === 'course');
  const d = board.days;
  const out = [emailStep(week, d, all, leads, rules, todayIso), ...offerPostSteps(week, d, offers, todayIso), ...planSteps(week, board, todayIso), usefulPostStep(week, d, leads, todayIso), linkedInStep(week, d, courses, rules, todayIso)];
  if (offers.length) out.push(outlookStep(week, d, offers, todayIso));
  const gbp = gbpCheckStep(week, rules, todayIso);
  if (gbp) out.push(gbp);
  return out.sort(byDay);
}
